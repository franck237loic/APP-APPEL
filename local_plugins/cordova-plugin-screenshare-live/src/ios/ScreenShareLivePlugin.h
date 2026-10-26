#import <Cordova/CDV.h>
#import <ReplayKit/ReplayKit.h>

@interface ScreenShareLivePlugin : CDVPlugin <RPScreenRecorderDelegate>

- (void)start:(CDVInvokedUrlCommand*)command;
- (void)stop:(CDVInvokedUrlCommand*)command;
- (void)isAvailable:(CDVInvokedUrlCommand*)command;

@end
