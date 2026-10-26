#import "ScreenShareLivePlugin.h"
#import <UIKit/UIKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <ImageIO/ImageIO.h>

// Identifiant App Group — DOIT être identique dans l'extension et dans Xcode (Signing & Capabilities)
static NSString * const kAppGroupId = @"group.com.callapp.terminal.screenshare";
static NSString * const kFrameFileName = @"latest_frame.jpg";
static NSString * const kMetaFileName = @"frame_meta.plist";
static NSString * const kDarwinNotificationName = @"com.callapp.terminal.screenshare.frame";
// Fichier déposé par l'app pour demander à l'extension de terminer la diffusion
static NSString * const kStopRequestFileName = @"stop_request";

@interface ScreenShareLivePlugin ()

@property (nonatomic, strong) CDVInvokedUrlCommand *startCommand;
@property (nonatomic, strong) RPScreenRecorder *screenRecorder;
@property (nonatomic, strong) NSOperationQueue *processQueue;
@property (nonatomic, assign) CGFloat maxWidth;
@property (nonatomic, assign) NSInteger maxFps;
@property (nonatomic, assign) CGFloat jpegQuality;
@property (nonatomic, strong) NSDate *lastFrameTime;
@property (nonatomic, assign) BOOL isCapturing;
@property (nonatomic, strong) NSTimer *pollTimer;
@property (nonatomic, assign) NSInteger lastFrameSequence;
@property (nonatomic, strong) UIView *broadcastPickerContainer;
@property (nonatomic, assign) BOOL useBroadcastExtension;
@property (nonatomic, assign) BOOL didSendStarted;

@end

@implementation ScreenShareLivePlugin

- (void)pluginInitialize {
    [super pluginInitialize];
    self.processQueue = [[NSOperationQueue alloc] init];
    self.processQueue.maxConcurrentOperationCount = 1;
    self.processQueue.name = @"ScreenShareLive.process";
    self.maxWidth = 720.0;
    self.maxFps = 10;
    self.jpegQuality = 0.55;
    self.lastFrameTime = [NSDate date];
    self.isCapturing = NO;
    self.lastFrameSequence = 0;
    // Mode WhatsApp (écran système complet) par défaut
    self.useBroadcastExtension = YES;
}

#pragma mark - Public API

- (void)isAvailable:(CDVInvokedUrlCommand*)command {
    BOOL available = NO;
    if (@available(iOS 11.0, *)) {
        available = [RPScreenRecorder sharedRecorder].isAvailable;
    }
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsBool:available];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)start:(CDVInvokedUrlCommand*)command {
    if (self.isCapturing || self.startCommand) {
        CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR
                                                    messageAsString:@"Screen share already started"];
        [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
        return;
    }

    self.startCommand = command;

    NSDictionary *options = nil;
    if (command.arguments.count > 0) {
        id arg = [command.arguments objectAtIndex:0];
        if ([arg isKindOfClass:[NSDictionary class]]) options = arg;
    }
    if (options) {
        if (options[@"maxWidth"]) self.maxWidth = [options[@"maxWidth"] floatValue];
        if (options[@"maxFps"]) self.maxFps = [options[@"maxFps"] integerValue];
        if (options[@"jpegQuality"]) {
            CGFloat q = [options[@"jpegQuality"] floatValue];
            self.jpegQuality = (q > 1.0) ? (q / 100.0) : q;
        }
        if (options[@"useBroadcast"] != nil) {
            self.useBroadcastExtension = [options[@"useBroadcast"] boolValue];
        }
    }

    if (@available(iOS 11.0, *)) {
        if (self.useBroadcastExtension) {
            [self startBroadcastMode];
        } else {
            [self startInAppCaptureMode];
        }
    } else {
        [self sendError:@"iOS 11.0+ required for screen sharing"];
    }
}

- (void)stop:(CDVInvokedUrlCommand*)command {
    [self stopCaptureInternal];
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:@"stopped"];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

#pragma mark - Mode Broadcast Extension (WhatsApp style — écran complet du téléphone)

- (void)startBroadcastMode {
    // Repartir d'un état propre : sinon le « stop » et le numéro de frame de la session
    // précédente font arrêter tout de suite / ignorer les frames de la nouvelle diffusion.
    self.lastFrameSequence = 0;
    self.didSendStarted = NO;
    NSURL *groupURL = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:kAppGroupId];
    if (!groupURL) {
        [self sendError:@"App Group group.com.callapp.terminal.screenshare non configuré (voir README_IOS.md)"];
        return;
    }
    [[NSFileManager defaultManager] removeItemAtURL:[groupURL URLByAppendingPathComponent:kStopRequestFileName] error:nil];
    [@{@"seq": @0, @"stop": @NO} writeToURL:[groupURL URLByAppendingPathComponent:kMetaFileName] atomically:YES];

    self.isCapturing = YES;
    dispatch_async(dispatch_get_main_queue(), ^{
        [self showBroadcastPicker];
        [self startListeningForExtensionFrames];
    });
    // « started » est envoyé à la première frame reçue (après le choix dans le sheet système)
}

- (void)showBroadcastPicker {
    if (self.broadcastPickerContainer) {
        [self.broadcastPickerContainer removeFromSuperview];
    }

    UIView *parent = self.viewController.view;
    UIView *container = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 44, 44)];
    container.center = CGPointMake(parent.bounds.size.width / 2.0, parent.bounds.size.height / 2.0);
    container.backgroundColor = [UIColor clearColor];
    container.userInteractionEnabled = YES;
    [parent addSubview:container];
    self.broadcastPickerContainer = container;

    if (@available(iOS 12.0, *)) {
        RPSystemBroadcastPickerView *picker = [[RPSystemBroadcastPickerView alloc] initWithFrame:container.bounds];
        // Bundle Identifier de l'extension (à adapter si tu changes le nom)
        picker.preferredExtension = @"com.callapp.terminal.ScreenShareBroadcast";
        picker.showsMicrophoneButton = NO;
        [container addSubview:picker];

        // Auto-déclenchement du sheet système (expérience fluide comme WhatsApp)
        for (UIView *sub in picker.subviews) {
            if ([sub isKindOfClass:[UIButton class]]) {
                [(UIButton *)sub sendActionsForControlEvents:UIControlEventTouchUpInside];
                break;
            }
        }

        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [container removeFromSuperview];
            self.broadcastPickerContainer = nil;
        });
    } else {
        // iOS 11 : fallback in-app
        [self startInAppCaptureMode];
    }
}

- (void)startListeningForExtensionFrames {
    CFNotificationCenterRef center = CFNotificationCenterGetDarwinNotifyCenter();
    CFNotificationCenterAddObserver(center,
                                    (__bridge const void *)(self),
                                    onFrameNotification,
                                    (__bridge CFStringRef)kDarwinNotificationName,
                                    NULL,
                                    CFNotificationSuspensionBehaviorDeliverImmediately);

    self.pollTimer = [NSTimer scheduledTimerWithTimeInterval:0.08
                                                      target:self
                                                    selector:@selector(pollLatestFrame)
                                                    userInfo:nil
                                                     repeats:YES];
}

static void onFrameNotification(CFNotificationCenterRef center, void *observer, CFStringRef name, const void *object, CFDictionaryRef userInfo) {
    ScreenShareLivePlugin *plugin = (__bridge ScreenShareLivePlugin *)observer;
    dispatch_async(dispatch_get_main_queue(), ^{
        [plugin pollLatestFrame];
    });
}

- (void)pollLatestFrame {
    if (!self.isCapturing || !self.startCommand) return;

    NSURL *groupURL = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:kAppGroupId];
    if (!groupURL) return;

    NSURL *metaURL = [groupURL URLByAppendingPathComponent:kMetaFileName];
    NSURL *frameURL = [groupURL URLByAppendingPathComponent:kFrameFileName];

    NSDictionary *meta = [NSDictionary dictionaryWithContentsOfURL:metaURL];
    if (!meta) return;

    // Si l'extension a signalé un arrêt
    if ([meta[@"stop"] boolValue]) {
        [self sendSuccess:@"stopped"];
        [self stopCaptureInternal];
        return;
    }

    NSInteger seq = [meta[@"seq"] integerValue];
    if (seq <= self.lastFrameSequence) return;
    self.lastFrameSequence = seq;

    if (!self.didSendStarted) {
        self.didSendStarted = YES;
        [self sendSuccess:@"started"];
    }

    NSData *jpegData = [NSData dataWithContentsOfURL:frameURL];
    if (!jpegData || jpegData.length < 100) return;

    NSDate *now = [NSDate date];
    NSTimeInterval minInterval = 1.0 / MAX(1, self.maxFps);
    if ([now timeIntervalSinceDate:self.lastFrameTime] < minInterval) return;
    self.lastFrameTime = now;

    NSString *base64 = [jpegData base64EncodedStringWithOptions:0];
    [self sendFrame:base64];
}

#pragma mark - Mode In-App (fallback)

- (void)startInAppCaptureMode {
    RPScreenRecorder *recorder = [RPScreenRecorder sharedRecorder];
    if (!recorder.isAvailable) {
        [self sendError:@"Screen recording not available on this device"];
        return;
    }

    recorder.delegate = self;
    self.screenRecorder = recorder;

    __weak typeof(self) weakSelf = self;
    [recorder startCaptureWithHandler:^(CMSampleBufferRef sampleBuffer, RPSampleBufferType bufferType, NSError *error) {
        if (error || !sampleBuffer) return;
        if (bufferType == RPSampleBufferTypeVideo) {
            [weakSelf processVideoSampleBuffer:sampleBuffer];
        }
    } completionHandler:^(NSError *error) {
        if (error) {
            [weakSelf sendError:[NSString stringWithFormat:@"Failed to start: %@", error.localizedDescription]];
        } else {
            weakSelf.isCapturing = YES;
            [weakSelf sendSuccess:@"started"];
        }
    }];
}

- (void)processVideoSampleBuffer:(CMSampleBufferRef)sampleBuffer {
    NSDate *now = [NSDate date];
    NSTimeInterval minInterval = 1.0 / MAX(1, self.maxFps);
    if ([now timeIntervalSinceDate:self.lastFrameTime] < minInterval) return;
    self.lastFrameTime = now;

    CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!imageBuffer) return;

    CVPixelBufferLockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);

    size_t width = CVPixelBufferGetWidth(imageBuffer);
    size_t height = CVPixelBufferGetHeight(imageBuffer);
    if (width == 0 || height == 0) {
        CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
        return;
    }

    CIImage *ciImage = [CIImage imageWithCVPixelBuffer:imageBuffer];
    CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);

    CGFloat scale = 1.0;
    if ((CGFloat)width > self.maxWidth) {
        scale = self.maxWidth / (CGFloat)width;
    }

    CIContext *context = [CIContext contextWithOptions:@{kCIContextUseSoftwareRenderer: @NO}];
    CGImageRef cgImage = [context createCGImage:ciImage fromRect:ciImage.extent];
    if (!cgImage) return;

    UIImage *image = [UIImage imageWithCGImage:cgImage scale:1.0 orientation:UIImageOrientationUp];
    CGImageRelease(cgImage);

    if (scale < 1.0 - 0.001) {
        CGSize newSize = CGSizeMake(image.size.width * scale, image.size.height * scale);
        image = [self resizeImage:image toSize:newSize];
    }

    NSData *jpegData = UIImageJPEGRepresentation(image, self.jpegQuality);
    if (!jpegData) return;

    NSString *base64 = [jpegData base64EncodedStringWithOptions:0];
    [self sendFrame:base64];
}

- (UIImage *)resizeImage:(UIImage *)image toSize:(CGSize)newSize {
    UIGraphicsBeginImageContextWithOptions(newSize, YES, 1.0);
    [image drawInRect:CGRectMake(0, 0, newSize.width, newSize.height)];
    UIImage *resized = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    return resized ?: image;
}

#pragma mark - Stop

- (void)stopCaptureInternal {
    self.isCapturing = NO;

    [self.pollTimer invalidate];
    self.pollTimer = nil;

    CFNotificationCenterRef center = CFNotificationCenterGetDarwinNotifyCenter();
    CFNotificationCenterRemoveObserver(center, (__bridge const void *)(self), (__bridge CFStringRef)kDarwinNotificationName, NULL);

    if (self.screenRecorder && [self.screenRecorder isRecording]) {
        [self.screenRecorder stopCaptureWithHandler:nil];
    }
    self.screenRecorder = nil;

    if (self.broadcastPickerContainer) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self.broadcastPickerContainer removeFromSuperview];
            self.broadcastPickerContainer = nil;
        });
    }

    // Demander à l'extension de terminer la diffusion (fait disparaître la barre rouge)
    NSURL *groupURL = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:kAppGroupId];
    if (groupURL && self.useBroadcastExtension) {
        [[NSData data] writeToURL:[groupURL URLByAppendingPathComponent:kStopRequestFileName] atomically:YES];
    }
    self.didSendStarted = NO;

    self.startCommand = nil;
}

#pragma mark - Send to JS

- (void)sendFrame:(NSString *)jpegBase64 {
    if (!self.startCommand || !jpegBase64) return;
    NSDictionary *payload = @{@"type": @"frame", @"jpeg": jpegBase64};
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:payload];
    [result setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:result callbackId:self.startCommand.callbackId];
}

- (void)sendSuccess:(NSString *)message {
    if (!self.startCommand) return;
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:message];
    [result setKeepCallbackAsBool:YES];
    [self.commandDelegate sendPluginResult:result callbackId:self.startCommand.callbackId];
}

- (void)sendError:(NSString *)message {
    if (!self.startCommand) return;
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:message];
    [self.commandDelegate sendPluginResult:result callbackId:self.startCommand.callbackId];
    self.startCommand = nil;
    self.isCapturing = NO;
}

#pragma mark - RPScreenRecorderDelegate

- (void)screenRecorderDidChangeAvailability:(RPScreenRecorder *)screenRecorder {
    NSLog(@"ScreenShareLive: availability changed → %@", screenRecorder.isAvailable ? @"YES" : @"NO");
}

- (void)screenRecorder:(RPScreenRecorder *)screenRecorder
didStopRecordingWithError:(NSError *)error
 previewViewController:(UIViewController *)previewViewController {
    NSLog(@"ScreenShareLive: recording stopped: %@", error.localizedDescription);
    [self sendSuccess:@"stopped"];
    [self stopCaptureInternal];
}

@end
