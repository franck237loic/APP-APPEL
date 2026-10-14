package com.furthermarket.terminal;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import androidx.core.app.NotificationManagerCompat;

import org.apache.cordova.*;

import java.lang.ref.WeakReference;

public class IncomingCallActivity extends CordovaActivity
{
    private static final String DEFAULT_INCOMING_CALL_PAGE = "appel_entrant.html";
    private static WeakReference<IncomingCallActivity> instanceRef = null;

    private String pendingCallId = null;
    private String pendingFrom = null;
    private boolean pendingIsVideo = false;
    private int pendingNotId = 0;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private int deliveryAttempts = 0;

    public static IncomingCallActivity getInstance()
    {
        return instanceRef != null ? instanceRef.get() : null;
    }

    @Override
    public void onCreate(Bundle savedInstanceState)
    {
        super.onCreate(savedInstanceState);
        instanceRef = new WeakReference<>(this);

        TelecomCallManager.initialize(this);
        enableShowWhenLocked(true);
        checkFullScreenIntentPermission();

        String targetUrl = (launchUrl != null)
                ? launchUrl.replace("index.html", DEFAULT_INCOMING_CALL_PAGE)
                : "https://localhost/" + DEFAULT_INCOMING_CALL_PAGE;

        loadUrl(targetUrl);

        readCallExtras(getIntent());
        scheduleDelivery(500);
        attachJsBridge();
    }

    @Override
    public void onNewIntent(Intent intent)
    {
        super.onNewIntent(intent);
        setIntent(intent);

        readCallExtras(intent);
        scheduleDelivery(0);
    }

    public void enableShowWhenLocked(final boolean enable)
    {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    setShowWhenLocked(enable);
                    setTurnScreenOn(enable);
                    if (enable) {
                        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                        if (km != null) {
                            km.requestDismissKeyguard(IncomingCallActivity.this, null);
                        }
                    }
                }

                if (enable) {
                    getWindow().addFlags(
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                      | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                      | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                      | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
                } else {
                    getWindow().clearFlags(
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                      | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                      | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                      | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
                }
            }
        });
    }

    private void checkFullScreenIntentPermission()
    {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && !nm.canUseFullScreenIntent()) {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception e) {
                    android.util.Log.e("CallApp", "Erreur ouverture paramètres plein écran", e);
                }
            }
        }
    }

    private void readCallExtras(Intent intent)
    {
        if (intent == null) return;
        String callId = intent.getStringExtra("callId");
        if (callId == null) return;

        pendingCallId = callId;
        pendingFrom = intent.getStringExtra("from");
        pendingIsVideo = "true".equals(intent.getStringExtra("isVideo"));
        pendingNotId = intent.getIntExtra("notId", 0);

        dismissNotification();
    }

    public void dismissNotification()
    {
        try {
            if (pendingNotId != 0) {
                NotificationManagerCompat.from(this).cancel(pendingNotId);
            } else {
                NotificationManagerCompat.from(this).cancelAll();
            }
        } catch (Exception e) {
            android.util.Log.w("CallApp", "Erreur dismissNotification", e);
        }
    }



    public void onCallDeclinedFromNotification()
    {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (appView != null) {
                    appView.getEngine().evaluateJavascript(
                        "if (typeof window.rejectCall === 'function') { window.rejectCall(); }", null);
                }
                closeCallScreen();
            }
        });
    }

    private void scheduleDelivery(long delayMs)
    {
        if (pendingCallId == null) return;
        deliveryAttempts = 0;
        handler.postDelayed(deliveryRunnable, delayMs);
    }

    private final Runnable deliveryRunnable = new Runnable() {
        @Override
        public void run() {
            if (pendingCallId == null || appView == null) return;

            final String probe = "typeof window.onNativeIncomingCall === 'function'";
            appView.getEngine().evaluateJavascript(probe, new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String result) {
                    if ("true".equals(result)) {
                        deliverPendingCallToWebView();
                    } else if (deliveryAttempts < 20) {
                        deliveryAttempts++;
                        handler.postDelayed(deliveryRunnable, 300);
                    }
                }
            });
        }
    };

    private void deliverPendingCallToWebView()
    {
        final String js = "window.onNativeIncomingCall("
                + "'" + escape(pendingCallId) + "',"
                + "'" + escape(pendingFrom) + "',"
                + pendingIsVideo + ")";

        appView.getEngine().evaluateJavascript(js, null);
    }

    private void attachJsBridge()
    {
        try {
            View view = appView.getEngine().getView();
            if (view instanceof WebView) {
                ((WebView) view).addJavascriptInterface(new JsBridge(), "AndroidCall");
            }
        } catch (Exception e) {
            android.util.Log.w("CallApp", "Erreur lors de l'attachement du pont JS", e);
        }
    }

    public class JsBridge
    {
        @JavascriptInterface
        public void closeCallScreen()
        {
            IncomingCallActivity.this.closeCallScreen();
        }
    }

    public void closeCallScreen()
    {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                enableShowWhenLocked(false);
                dismissNotification();
                finish();
            }
        });
    }

    @Override
    public void onDestroy()
    {
        super.onDestroy();
        enableShowWhenLocked(false);
        TelecomCallManager.reportCallEnded();
        if (instanceRef != null && instanceRef.get() == this) {
            instanceRef = null;
        }
    }

    private String escape(String s)
    {
        return s == null ? "" : s.replace("\\", "\\\\").replace("'", "\\'");
    }
}