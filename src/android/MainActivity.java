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
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface; 

import androidx.core.app.NotificationManagerCompat;

import org.apache.cordova.*;

import java.lang.ref.WeakReference;

public class MainActivity extends CordovaActivity
{
    private static WeakReference<MainActivity> instanceRef = null;

    private String pendingCallId = null;
    private String pendingFrom = null;
    private boolean pendingIsVideo = false;
    private boolean pendingAutoAnswer = false;
    private int pendingNotId = 0;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private int deliveryAttempts = 0;

    
    public static MainActivity getInstance()
    {
        return instanceRef != null ? instanceRef.get() : null;
    }

    
    @Override
    public void onCreate(Bundle savedInstanceState)
    {
        super.onCreate(savedInstanceState);
        instanceRef = new WeakReference<>(this);
        android.util.Log.d("CallApp", "onCreate, extras=" + (getIntent().getExtras() != null ? getIntent().getExtras().toString() : "null"));

        TelecomCallManager.initialize(this);
        checkFullScreenIntentPermission();

        // Charge index.html
        loadUrl(launchUrl);

        // Lecture des extras d'appel
        readCallExtras(getIntent());

        if (pendingCallId != null) {
            // Un appel est présent : réveiller et afficher par-dessus l'écran de verrouillage
            enableShowWhenLocked(true);
            scheduleDelivery(500);
        } else {
            // Démarrage normal hors appel : S'ASSURER que l'app ne s'affiche PAS sur le lockscreen
            enableShowWhenLocked(false);
        }
    }

    
    @Override
    public void onNewIntent(Intent intent)
    {
        super.onNewIntent(intent);
        setIntent(intent);
        android.util.Log.d("CallApp", "onNewIntent, extras=" + (intent.getExtras() != null ? intent.getExtras().toString() : "null"));

        readCallExtras(intent);

        if (pendingCallId != null) {
            enableShowWhenLocked(true);
            scheduleDelivery(0);
        } else {
            enableShowWhenLocked(false);
        }
    }

    
    @JavascriptInterface
    public void dismissCallNotification(int notId) {
        android.util.Log.d("CallApp", "dismissCallNotification called with notId=" + notId);
        
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                CallMessagingService.cancelNotification(MainActivity.this, notId);
                // Libérer le framework Telecom si configuré
                TelecomCallManager.reportCallEnded();
            }
        });
    }

    
    /**
     * Active ou désactive dynamiquement l'affichage par-dessus l'écran de verrouillage.
     * Activé UNIQUEMENT quand un appel entrant sonne.
     * Dès que l'appel se termine ou hors appel, remis à false pour que l'écran verrouillé fonctionne normalement.
     */
    public void enableShowWhenLocked(final boolean enable)
    {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                android.util.Log.d("CallApp", "enableShowWhenLocked: " + enable);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    setShowWhenLocked(enable);
                    setTurnScreenOn(enable);
                    if (enable) {
                        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                        if (km != null) {
                            km.requestDismissKeyguard(MainActivity.this, null);
                        }
                    }
                }

                if (enable) {
                    getWindow().addFlags(
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                      | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                      | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                      | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD); // Requis pour contourner la demande de code/schéma
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

    
    /**
     * Vérifie si l'application a l'autorisation USE_FULL_SCREEN_INTENT sur Android 14+ (API 34).
     */
    private void checkFullScreenIntentPermission()
    {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && !nm.canUseFullScreenIntent()) {
                android.util.Log.w("CallApp", "Permission USE_FULL_SCREEN_INTENT non accordée. Ouverture des paramètres.");
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception e) {
                    android.util.Log.e("CallApp", "Impossible d'ouvrir les paramètres plein écran", e);
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
        pendingAutoAnswer = intent.getBooleanExtra("autoAnswer", false);
        pendingNotId = intent.getIntExtra("notId", 0);

        // Dès qu'on prend en charge l'appel dans l'application, on efface la notification de la barre d'état
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

    /**
     * Appelé par CallNotificationReceiver si l'utilisateur a cliqué sur "Refuser"
     * sur la notification alors que l'application était active.
     */
    
    public void onCallDeclinedFromNotification()
    {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                enableShowWhenLocked(false);
                dismissNotification();
                if (appView != null) {
                    appView.getEngine().evaluateJavascript(
                        "if (typeof window.rejectCall === 'function') { window.rejectCall(); }", null);
                }
            }
        });
    }

    
    /**
     * Tente de livrer l'appel en attente au JS.
     */
    private void scheduleDelivery(long delayMs)
    {
        if (pendingCallId == null) return;
        android.util.Log.d("CallApp", "scheduleDelivery lancé, delayMs=" + delayMs + " pendingCallId=" + pendingCallId);
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
                + pendingIsVideo + ","
                + pendingAutoAnswer + ")";

        appView.getEngine().evaluateJavascript(js, null);

        // Une fois l'appel affiché/démarré dans l'UI, on peut désactiver le maintien de l'écran par-dessus le verrouillage
        // afin que si l'utilisateur verrouille son téléphone pendant l'appel, la sécurité du téléphone soit respectée.
        pendingCallId = null;
        pendingFrom = null;
        pendingIsVideo = false;
        pendingAutoAnswer = false;
    }


    @Override
    public void onDestroy()
    {
        super.onDestroy();
        enableShowWhenLocked(false);
        dismissNotification();
        TelecomCallManager.reportCallEnded();
        if (instanceRef != null && instanceRef.get() == this) {
            instanceRef = null;
        }
    }


    @Override
    protected void onPause() {
        super.onPause();
        // Ne désactiver le mode verrouillé que si aucun appel n'est actif/en attente
        if (pendingCallId == null) {
            enableShowWhenLocked(false);
        }
    }


    private String escape(String s)
    {
        return s == null ? "" : s.replace("\\", "\\\\").replace("'", "\\'");
    }


}