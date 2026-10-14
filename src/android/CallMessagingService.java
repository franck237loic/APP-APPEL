package com.furthermarket.terminal;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.app.ActivityManager;
import java.util.List;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class CallMessagingService extends FirebaseMessagingService
{
    private static final String CHANNEL_ID = "incoming_calls";

    @Override
    public void onCreate()
    {
        super.onCreate();
        // Enregistre l'application auprès du framework Telecom dès que le
        // service FCM démarre — indispensable sur Android 14+ pour que le
        // système autorise le full-screen intent.
        TelecomCallManager.initialize(this);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage)
    {
        android.util.Log.d("CallApp", "onMessageReceived, data=" + remoteMessage.getData());
        Map<String, String> data = remoteMessage.getData();
        if (data == null) return;

        String type = data.get("type");
        int requestCode = safeInt(data.get("notId"), (int) System.currentTimeMillis());

        // ---------------------------------------------------------------
        // 1. TRAITEMENT DE L'APPEL MANQUÉ / ANNULÉ (Priorité absolue)
        // ---------------------------------------------------------------
        // if ("missed-call".equals(type)) {
        //     // Annule immédiatement la notification de sonnerie d'appel entrant
        //     cancelNotification(this, 0);
        //     // Signale la fin d'appel au framework Telecom
        //     TelecomCallManager.reportCallEnded();
        //     // On quitte ici pour laisser le serveur FCM afficher sa notification propre
        //     return; 
        // }

        // ---------------------------------------------------------------
        // 2. VERIFICATION DU PREMIER PLAN (Pour les appels entrants uniquement)
        // ---------------------------------------------------------------
        if (isAppInForeground(this)) {
            android.util.Log.d("CallApp", "L'application est au premier plan, la notification d'appel entrant est ignorée.");
            return;
        }

        // ---------------------------------------------------------------
        // 3. SEULS LES APPELS ENTRANTS POUVANT CONTINUER
        // ---------------------------------------------------------------
        if (!"incoming-call".equals(type)) {
            return;
        }

        createChannelIfNeeded();   

        // ---------------------------------------------------------------
        // 4. Réveiller temporairement l'écran (WakeLock partiel)
        // ---------------------------------------------------------------
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = null;
        if (pm != null) {
            wl = pm.newWakeLock(
                    PowerManager.FULL_WAKE_LOCK
                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                | PowerManager.ON_AFTER_RELEASE,
                    "CallApp:IncomingCall");
            wl.acquire(15_000); // 15s max
        }

        // ---------------------------------------------------------------
        // 5. Déclarer l'appel entrant via core-telecom
        // ---------------------------------------------------------------
        String callerName = data.get("callerName") != null
                ? data.get("callerName")
                : data.get("callerId");
        String callerId   = data.get("callerId");
        boolean isVideo   = "true".equals(data.get("isVideo"));

        TelecomCallManager.reportIncomingCall(
                callerName != null ? callerName : "Inconnu",
                callerId  != null ? callerId  : "unknown",
                isVideo,
                null,
                null
        );

        // ---------------------------------------------------------------
        // 6. PendingIntents
        // ---------------------------------------------------------------
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        // INTENT FULLSCREEN
        Intent fullScreenIntent = new Intent(this, IncomingCallActivity.class);
        fullScreenIntent.putExtra("callId", data.get("callId"));
        fullScreenIntent.putExtra("from", data.get("callerId"));
        fullScreenIntent.putExtra("isVideo", data.get("isVideo"));
        fullScreenIntent.putExtra("notId", requestCode);
        fullScreenIntent.putExtra("source", "fullscreen_lockscreen");
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK 
                | Intent.FLAG_ACTIVITY_CLEAR_TOP 
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                this, requestCode, fullScreenIntent, piFlags);

        // INTENT CONTENT
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.putExtra("callId", data.get("callId"));
        contentIntent.putExtra("from", data.get("callerId"));
        contentIntent.putExtra("isVideo", data.get("isVideo"));
        contentIntent.putExtra("notId", requestCode);
        contentIntent.putExtra("source", "notification_click");
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK 
                | Intent.FLAG_ACTIVITY_CLEAR_TOP 
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent contentPendingIntent = PendingIntent.getActivity(
                this, requestCode + 4, contentIntent, piFlags);

        // ACTION DECROCHER
        Intent answerIntent = new Intent(this, MainActivity.class);
        answerIntent.putExtra("callId", data.get("callId"));
        answerIntent.putExtra("from", data.get("callerId"));
        answerIntent.putExtra("isVideo", data.get("isVideo"));
        answerIntent.putExtra("notId", requestCode);
        answerIntent.putExtra("autoAnswer", true);
        answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent answerPendingIntent = PendingIntent.getActivity(
                this, requestCode + 1, answerIntent, piFlags);

        // ACTION REFUSER
        Intent declineIntent = new Intent(this, CallNotificationReceiver.class);
        declineIntent.setAction(CallNotificationReceiver.ACTION_DECLINE_CALL);
        declineIntent.putExtra("notId", requestCode);
        declineIntent.putExtra("callId", data.get("callId"));
        PendingIntent declinePendingIntent = PendingIntent.getBroadcast(
                this, requestCode + 2, declineIntent, piFlags);

        // ACTION SWIPE (DELETE)
        Intent dismissIntent = new Intent(this, CallNotificationReceiver.class);
        dismissIntent.setAction(CallNotificationReceiver.ACTION_DISMISS_CALL);
        dismissIntent.putExtra("notId", requestCode);
        dismissIntent.putExtra("callId", data.get("callId"));
        PendingIntent dismissPendingIntent = PendingIntent.getBroadcast(
                this, requestCode + 3, dismissIntent, piFlags);

        // ---------------------------------------------------------------
        // 7. Construire la notification CallStyle
        // ---------------------------------------------------------------
        Person caller = new Person.Builder()
                .setName(callerName != null ? callerName : "Inconnu")
                .setImportant(true)
                .build();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_call)
                .setContentTitle(isVideo ? "Appel vidéo entrant" : "Appel entrant")
                .setContentText(callerName)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(false)
                .setAutoCancel(true)
                .setDeleteIntent(null) // Corrigé (au lieu de null)
                .setStyle(NotificationCompat.CallStyle.forIncomingCall(
                        caller, declinePendingIntent, answerPendingIntent))
                .setContentIntent(contentPendingIntent);

        // ---------------------------------------------------------------
        // 8. Full-screen intent sur Android 14+
        // ---------------------------------------------------------------
        boolean canUseFSI = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            canUseFSI = nm != null && nm.canUseFullScreenIntent();
        }

        if (canUseFSI) {
            builder.setFullScreenIntent(fullScreenPendingIntent, true);
        }

        // ---------------------------------------------------------------
        // 9. Publier la notification
        // ---------------------------------------------------------------
        NotificationManagerCompat.from(this).notify(requestCode, builder.build());

        if (wl != null && wl.isHeld()) {
            wl.release();
        }
    }

    public static void cancelNotification(Context context, int notId)
    {
        try {
            if (notId != 0) {
                NotificationManagerCompat.from(context).cancel(notId);
            } else {
                NotificationManagerCompat.from(context).cancelAll();
            }
        } catch (Exception e) {
            android.util.Log.w("CallApp", "Erreur lors de l'annulation de la notification", e);
        }
    }

    private int safeInt(String value, int fallback)
    {
        try {
            return Integer.parseInt(value);
        } catch (Exception e) {
            return fallback;
        }
    }

    /**
     * Vérifie si l'application est actuellement au premier plan
     */
    private boolean isAppInForeground(Context context) {
        ActivityManager activityManager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (activityManager == null) return false;

        List<ActivityManager.RunningAppProcessInfo> appProcesses = activityManager.getRunningAppProcesses();
        if (appProcesses == null) return false;

        final String packageName = context.getPackageName();
        for (ActivityManager.RunningAppProcessInfo appProcess : appProcesses) {
            if (appProcess.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND 
                && appProcess.processName.equals(packageName)) {
                return true;
            }
        }
        return false;
    }

    private void createChannelIfNeeded()
    {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;

            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Appels entrants", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Notifications d'appels entrants");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 1000, 500, 1000});
            channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);

            Uri ringtone = Settings.System.DEFAULT_RINGTONE_URI;
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            channel.setSound(ringtone, attrs);

            nm.createNotificationChannel(channel);
        }
    }
}