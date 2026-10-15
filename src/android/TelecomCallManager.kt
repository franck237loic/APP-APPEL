package com.callapp.terminal

import android.content.Context
import android.net.Uri
import android.telecom.DisconnectCause
import android.util.Log
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallsManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Pont Kotlin entre l'API Jetpack core-telecom (coroutines) et le code Java existant.
 *
 * Sur Android 14+, le système exige que les applications d'appel soient enregistrées
 * auprès du framework Telecom afin de :
 *   - Déverrouiller la permission restreinte USE_FULL_SCREEN_INTENT
 *   - Réveiller l'écran et afficher l'interface par-dessus l'écran de verrouillage
 *   - Permettre la notification prioritaire de type CallStyle
 */
object TelecomCallManager {

    private const val TAG = "TelecomCallManager"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private var callsManager: CallsManager? = null
    private var currentCallControl: CallControlScope? = null

    /**
     * À appeler au démarrage (CallMessagingService ou MainActivity).
     */
    @JvmStatic
    fun initialize(context: Context) {
        if (callsManager != null) return

        try {
            val manager = CallsManager(context.applicationContext)
            val capabilities = (CallsManager.CAPABILITY_BASELINE
                    or CallsManager.CAPABILITY_SUPPORTS_VIDEO_CALLING)
            manager.registerAppWithTelecom(capabilities)
            callsManager = manager
            Log.d(TAG, "✅ Application enregistrée auprès du Telecom framework")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Échec de l'enregistrement Telecom", e)
        }
    }

    /**
     * Déclare un appel entrant auprès du système. Cela permet à Android 14+
     * d'autoriser le full-screen intent et le réveil d'écran.
     *
     * @param callerName Nom affiché pour l'appelant
     * @param callerId   Identifiant de l'appelant
     * @param isVideo    true si c'est un appel vidéo
     * @param onAnswer   Callback optionnel
     * @param onReject   Callback optionnel
     */
    @JvmStatic
    fun reportIncomingCall(
        callerName: String,
        callerId: String,
        isVideo: Boolean,
        onAnswer: Runnable?,
        onReject: Runnable?
    ) {
        val manager = callsManager
        if (manager == null) {
            Log.w(TAG, "CallsManager non initialisé, appel non signalé au Telecom")
            return
        }

        val callType = if (isVideo)
            CallAttributesCompat.CALL_TYPE_VIDEO_CALL
        else
            CallAttributesCompat.CALL_TYPE_AUDIO_CALL

        val attributes = CallAttributesCompat(
            displayName = callerName.ifEmpty { callerId },
            address = Uri.parse("tel:$callerId"),
            direction = CallAttributesCompat.DIRECTION_INCOMING,
            callType = callType
        )

        scope.launch {
            try {
                manager.addCall(
                    attributes,
                    onAnswer = { _ ->
                        Log.d(TAG, "Telecom onAnswer déclenché")
                        onAnswer?.run()
                    },
                    onDisconnect = { cause ->
                        Log.d(TAG, "Telecom onDisconnect: $cause")
                        onReject?.run()
                        currentCallControl = null
                    },
                    onSetActive = {
                        Log.d(TAG, "Telecom onSetActive")
                    },
                    onSetInactive = {
                        Log.d(TAG, "Telecom onSetInactive")
                    }
                ) {
                    // Ici 'this' est le CallControlScope
                    currentCallControl = this
                    Log.d(TAG, "✅ Appel entrant enregistré avec succès dans Telecom")
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ Impossible de déclarer l'appel entrant dans Telecom", e)
            }
        }
    }

    /**
     * Informe le framework Telecom que l'appel en cours est terminé.
     */
    @JvmStatic
    fun reportCallEnded() {
        val control = currentCallControl
        if (control == null) return

        scope.launch {
            try {
                control.disconnect(DisconnectCause(DisconnectCause.LOCAL))
                Log.d(TAG, "Appel déconnecté dans Telecom")
            } catch (e: Exception) {
                Log.w(TAG, "Erreur lors de la déconnexion Telecom", e)
            } finally {
                currentCallControl = null
            }
        }
    }
}
