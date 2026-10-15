package com.callapp.terminal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.app.NotificationManagerCompat;

/**
 * Récepteur pour les actions de notification d'appel :
 * - Clic sur le bouton "Refuser"
 * - Balayage / Effacement de la notification par l'utilisateur (deleteIntent)
 */
public class CallNotificationReceiver extends BroadcastReceiver
{
    public static final String ACTION_DECLINE_CALL = "com.callapp.terminal.ACTION_DECLINE_CALL";
    public static final String ACTION_DISMISS_CALL = "com.callapp.terminal.ACTION_DISMISS_CALL";

    private static final String TAG = "CallNotifReceiver";

    @Override
    public void onReceive(Context context, Intent intent)
    {
        if (intent == null) return;
        String action = intent.getAction();
        int notId = intent.getIntExtra("notId", 0);

        Log.d(TAG, "Notification action reçue : " + action + ", notId=" + notId);

        // 1. Annuler la notification dans la barre de notifications
        if (notId != 0) {
            NotificationManagerCompat.from(context).cancel(notId);
        } else {
            NotificationManagerCompat.from(context).cancelAll();
        }

        // 2. Libérer le framework Telecom
        TelecomCallManager.reportCallEnded();

        // 3. Informer MainActivity si elle est active
        MainActivity mainActivity = MainActivity.getInstance();
        if (mainActivity != null) {
            mainActivity.onCallDeclinedFromNotification();
        }
    }
}
