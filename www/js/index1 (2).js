/* =========================================================
   CONFIGURATION ET ÉTAT GLOBAL
========================================================= */

const SIGNALING_SERVER_URL = "wss://node-b44u.onrender.com";
const HTTP_SERVER_URL = "https://node-b44u.onrender.com";
const RECONNECT_DELAY = 5000;

const rtcConfig = {
  iceServers: [
    {
      urls: "stun:socialstatus.furthermarket.com:443",
      username: "fmturn57",
      credential: "fmturn57",
    },
    {
      urls: "turn:socialstatus.furthermarket.com:80",
      username: "fmturn57",
      credential: "fmturn57",
    },
  ],
};

let myId = null;
let targetUserId = null;
let ws = null;
let reconnectTimer = null;
let manuallyClosed = false;
let deviceToken = null;
let voipToken = null; // Token APNs VoIP iOS
let push = null;

let peerConnection = null;
let localStream = null;
let pendingCandidates = [];
let pendingOffer = null;
let currentCallId = null;
let currentNotId = null; // iOS notification ID
let autoAcceptOnOffer = false;

// Implémentation WebRTC spécifique à la plateforme
let activeRTC = null;

let isMuted = false;
let isRestartingIce = false;
let timerInterval = null;

let vibrationTimer = null;
let isVibrating = false;

let isVideoCall = false;
let isCameraOff = false;
let isSpeakerOn = true; // iOS: haut-parleur par défaut
let isRenegotiating = false;
let currentFacingMode = "user"; // "user" = caméra avant, "environment" = caméra arrière

let interfaceReceiver = null;
let interfaceSender = null;
let interfaceVideo = null;

let appReady = false;
let pendingNativeCall = null;

// Détection de plateforme dynamique (après deviceready)
function getPlatform() {
  if (!window.cordova) return 'web';
  return cordova.platformId || 'web';
}

function isIOS() {
  return getPlatform() === 'ios';
}

function isAndroid() {
  return getPlatform() === 'android';
}

/* =========================================================
   INITIALISATION ET AUTORISATIONS
========================================================= */

document.addEventListener("deviceready", function () {
  // iOS: Configuration iosrtc
  if (isIOS() && cordova.plugins && cordova.plugins.iosrtc) {
    cordova.plugins.iosrtc.registerGlobals();
    console.log("✅ [iOS] iosrtc activé - WebRTC natif iOS");
  } else if (isIOS()) {
    console.error("❌ [iOS] iosrtc non disponible");
  }
}, false);

document.addEventListener("deviceready", onDeviceReady, false);

// Récupération des interfaces du DOM dès le chargement
interfaceReceiver = document.getElementById("interface-2");
interfaceSender = document.getElementById("interface-1");
interfaceVideo = document.getElementById("interface-3");

async function onDeviceReady() {
  console.log("🚀 Initialisation de l'application WebRTC...");
  console.log("📱 Plateforme détectée:", getPlatform());
  console.log("🔍 isIOS():", isIOS());
  console.log("🔍 isAndroid():", isAndroid());

  try {
    // Permissions communes
    await requestMicrophonePermission();
    await requestCameraPermission();

    // Permissions spécifiques Android
    if (isAndroid()) {
      await requestBluetoothPermission();
      await requestNotificationPermission();
    }

    // Permissions spécifiques iOS
    if (isIOS()) {
      await ensureMediaAuthorizedIOS();
    }

    initializeUserId();
    initPushNotifications();

    const idElement = document.getElementById("my-id-display");
    if (idElement) idElement.innerText = myId;

    await connectWebSocket();

    appReady = true;
    if (pendingNativeCall) {
      const call = pendingNativeCall;
      pendingNativeCall = null;
      processIncomingCall(call.callId, call.from, call.isVideo, call.autoAnswer);
    }
  } catch (error) {
    console.error("❌ Erreur au démarrage :", error);
    updateStatus("Erreur d'initialisation");
  }
}

// Permissions Android
function requestCameraPermission() {
  return new Promise((resolve) => {
    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
      const permissions = cordova.plugins.permissions;
      permissions.requestPermission(
        permissions.CAMERA,
        (status) => resolve(),
        (error) => resolve(),
      );
    } else {
      resolve();
    }
  });
}

function requestNotificationPermission() {
  return new Promise((resolve) => {
    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
      const permissions = cordova.plugins.permissions;
      const perm =
        permissions.POST_NOTIFICATIONS || "android.permission.POST_NOTIFICATIONS";
      permissions.requestPermission(
        perm,
        () => resolve(),
        () => resolve(),
      );
    } else {
      resolve();
    }
  });
}

function requestMicrophonePermission() {
  return new Promise((resolve) => {
    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
      const permissions = cordova.plugins.permissions;
      permissions.requestPermission(
        permissions.RECORD_AUDIO,
        (status) => resolve(),
        (error) => resolve(),
      );
    } else {
      resolve();
    }
  });
}

function requestBluetoothPermission() {
  return new Promise((resolve) => {
    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
      const permissions = cordova.plugins.permissions;
      const perm =
        permissions.BLUETOOTH_CONNECT || "android.permission.BLUETOOTH_CONNECT";
      permissions.requestPermission(
        perm,
        () => resolve(),
        () => resolve(),
      );
    } else {
      resolve();
    }
  });
}

// Permissions iOS spécifiques
function waitForAppActive() {
  return new Promise((resolve) => {
    if (document.visibilityState === "visible" && !document.hidden) {
      resolve();
      return;
    }

    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("resume", finish);
      resolve();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") finish();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("resume", finish, false);
    setTimeout(finish, 3000);
  });
}

function ensureMediaAuthorizedIOS() {
  if (!isIOS() || !(window.cordova && cordova.plugins && cordova.plugins.diagnostic)) {
    return Promise.resolve();
  }
  const diagnostic = cordova.plugins.diagnostic;

  function ensureAuthorized(getStatus, requestAuth, label) {
    return new Promise((resolve) => {
      getStatus(
        async (status) => {
          console.log(`🔎 [iOS] Statut ${label} :`, status);

          if (status !== diagnostic.permissionStatus.NOT_REQUESTED) {
            resolve();
            return;
          }

          console.log(`⏳ [iOS] ${label} jamais demandé, attente du premier plan...`);
          await waitForAppActive();

          requestAuth(
            (newStatus) => {
              console.log(`✅ [iOS] ${label} ->`, newStatus);
              resolve();
            },
            (error) => {
              console.warn(`⚠️ [iOS] Erreur demande ${label} :`, error);
              resolve();
            }
          );
        },
        (error) => {
          console.warn(`⚠️ [iOS] Erreur lecture statut ${label} :`, error);
          resolve();
        }
      );
    });
  }

  return Promise.all([
    ensureAuthorized(
      diagnostic.getMicrophoneAuthorizationStatus,
      diagnostic.requestMicrophoneAuthorization,
      "microphone"
    ),
    ensureAuthorized(
      diagnostic.getCameraAuthorizationStatus,
      diagnostic.requestCameraAuthorization,
      "caméra"
    ),
  ]);
}

function initializeUserId() {
  myId = localStorage.getItem("app_user_id");
  if (!myId) {
    myId = "ID-" + Math.floor(100000 + Math.random() * 900000);
    localStorage.setItem("app_user_id", myId);
  }
  console.log("👤 Mon ID local :", myId);
}

/* =========================================================
   GESTION PUSH NOTIFICATIONS
========================================================= */

function initPushNotifications() {
  console.log("🔔 ===== INITIALISATION PUSH =====");

  if (typeof PushNotification === "undefined") {
    console.error("❌ PushNotification est undefined");
    return;
  }

  try {
    push = PushNotification.init({
      android: {
        channelDescription: "Notifications d'appels",
        forceShow: true,
      },
      ios: {
        alert: "true",
        badge: "true",
        sound: "true",
        void: "true",
      },
    });

    push.on("registration", function (data) {
      console.log("✅ ENREGISTREMENT PUSH RÉUSSI :", data.registrationId);
      deviceToken = data.registrationId;

      if (ws && ws.readyState === WebSocket.OPEN) {
        sendSignal({
          type: "register-user",
          userId: myId,
          pushToken: deviceToken,
        });
      }
    });

    // Action: Accepter depuis notification
    push.on("accept", async function (data) {
      console.log("📞 ACCEPTER DEPUIS PUSH");
      const additionalData = data.additionalData || {};

      extractPushData(additionalData);
      autoAcceptOnOffer = true;

      if (peerConnection) {
        console.log("Appel déjà en cours, acceptation ignorée");
        return;
      }
      showInterface(isVideoCall ? interfaceVideo : interfaceSender);
      updateStatus("Connexion à l'appel...");

      await ensureConnectedAndFetchOffer();
    });

    // Action: Refuser
    push.on("reject", async function (data) {
      console.log("📵 REFUSER APPEL");
      const additionalData = data.additionalData || {};

      extractPushData(additionalData);

      await ensureSocketReady();
      rejectCall();

      if (push && additionalData.notId) {
        push.finish(() => console.log("✅ Notification refusée terminée"));
      }
    });

    // Action: Clic sur notification
    push.on("notification", async function (data) {
      console.log("🔔 Notification cliquée :", JSON.stringify(data));
      const additionalData = data.additionalData || {};

      if (additionalData.type === "incoming-call") {
        extractPushData(additionalData);
        autoAcceptOnOffer = false;

        showInterface(interfaceReceiver);
        updateStatus(isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...");
        startVibration();

        await ensureConnectedAndFetchOffer();
      }

      push.finish(() => console.log("✅ Notification terminée"));
    });

    push.on("error", (error) => console.error("❌ ERREUR PUSH :", error));
  } catch (error) {
    console.error("❌ Exception Push :", error);
  }
}

function extractPushData(data) {
  if (data.callerId) targetUserId = data.callerId;
  if (data.callId) {
    currentCallId = data.callId;
    localStorage.setItem("pending_call_id", data.callId);
  }
  if (data.isVideo !== undefined) {
    isVideoCall = data.isVideo === "true" || data.isVideo === true;
  }
  if (data.notId) currentNotId = data.notId;
}

async function ensureConnectedAndFetchOffer() {
  if (!currentCallId) {
    currentCallId = localStorage.getItem("pending_call_id");
  }

  await ensureSocketReady();

  if (currentCallId) {
    console.log("📩 Demande de l'offre SDP pour callId :", currentCallId);
    sendSignal({
      type: "get-offer",
      callId: currentCallId,
    });
  }
}

function ensureSocketReady() {
  return new Promise((resolve) => {
    const enregistrerEtValider = () => {
      sendSignal({ type: "register-user", userId: myId, pushToken: deviceToken });
      if (isIOS() && voipToken) {
        sendSignal({ type: "register-voip-token", userId: myId, voipToken: voipToken });
      }
      setTimeout(resolve, 400);
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      enregistrerEtValider();
      return;
    }

    connectWebSocket().then(() => {
      let settled = false;
      const checkInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          if (settled) return;
          settled = true;
          clearInterval(checkInterval);
          enregistrerEtValider();
        }
      }, 100);
      setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });
  });
}

/* =========================================================
   SIGNALISATION WEBSOCKET
========================================================= */

async function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  updateStatus("Connexion au serveur...");

  try {
    await fetch(HTTP_SERVER_URL, { method: "GET", cache: "no-cache" });
  } catch (err) {
    console.warn("⚠️ HTTP Ping échoué :", err);
  }

  return new Promise((resolve) => {
    let settled = false;
    const settleOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    setTimeout(settleOnce, 15000);
    createWebSocket(settleOnce);
  });
}

function createWebSocket(onSettle) {
  if (ws) {
    try { ws.close(); } catch (e) { }
    ws = null;
  }

  try {
    ws = new WebSocket(SIGNALING_SERVER_URL);
  } catch (error) {
    console.error("❌ Erreur création WebSocket :", error);
    scheduleReconnect();
    if (typeof onSettle === "function") onSettle();
    return;
  }

  ws.onopen = () => {
    console.log("✅ WebSocket Connecté");
    updateStatus("En ligne");
    sendSignal({ type: "register-user", userId: myId, pushToken: deviceToken });
    if (isIOS() && voipToken) {
      sendSignal({ type: "register-voip-token", userId: myId, voipToken: voipToken });
    }
    if (typeof onSettle === "function") onSettle();
  };

  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }

    if (data.type === "ping") {
      sendSignal({ type: "pong" });
      console.log("🏓 Pong envoyé");
      return;
    }

    console.log("📦 Signal reçu :", data.type);

    switch (data.type) {
      case "incoming-call":
        handleIncomingCall(data);
        break;

      case "call-offer-details":
        handleCallOfferDetails(data);
        break;

      case "call-expired":
        alert("L'appel a expiré ou a été annulé.");
        hangUp(false);
        break;

      case "restart-offer":
        if (data.isVideoUpgrade) {
          handleVideoUpgradeOffer(data);
        } else {
          handleRestartOffer(data);
        }
        break;

      case "call-answered":
        handleCallAnswered(data);
        break;

      case "ice-candidate":
        handleNewICECandidate(data);
        break;

      case "call-refused":
      case "call-end":
        hangUp(false);
        break;

      case "video-upgrade-offer":
        handleVideoUpgradeOffer(data);
        break;
    }
  };

  ws.onerror = (error) => {
    console.error("❌ Erreur WebSocket :", error);
    updateStatus("Erreur réseau WebSocket");
  };

  ws.onclose = () => {
    ws = null;
    if (!manuallyClosed) {
      updateStatus("Hors ligne");
      scheduleReconnect();
    }
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connectWebSocket(), RECONNECT_DELAY);
}

function sendSignal(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  } else {
    console.warn("⚠️ Impossible d'envoyer le signal (Socket non prêt), nouvelle tentative dans 500ms:", data.type);
    setTimeout(() => sendSignal(data), 500);
    return false;
  }
}

/* =========================================================
   1. PARTIE ÉMETTEUR (OUTGOING CALL)
========================================================= */

async function makeCall(video = false) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert("Vous n'êtes pas connecté au serveur.");
    return;
  }

  const input = document.getElementById("target-id-input");
  const targetId = input ? input.value.trim() : "";

  if (!targetId || targetId === myId) {
    alert("Veuillez saisir un ID valide.");
    return;
  }

  cleanCallState();
  targetUserId = targetId;
  isVideoCall = video;

  updateStatus("Initialisation média...");

  try {
    await initMediaAndPeer();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    sendSignal({
      type: "call-user",
      targetId: targetUserId,
      offer: offer,
      isVideo: isVideoCall,
    });

    updateStatus("Appel en cours...");
    toggleCallButtons(true);
    showInterface(isVideoCall ? interfaceVideo : interfaceSender);
  } catch (error) {
    console.error("❌ Erreur lancement appel :", error);
    hangUp(false);
  }
}

function makeVideoCall() {
  makeCall(true);
}

async function handleCallAnswered(data) {
  console.log("📞 Appel accepté par le destinataire");
  if (!peerConnection) return;

  try {
    const SessionDescription = activeRTC ? activeRTC.SessionDescription : RTCSessionDescription;
    await peerConnection.setRemoteDescription(new SessionDescription(data.answer));
    await processPendingCandidates();
    startTimer();
    updateStatus("Appel connecté");
  } catch (error) {
    console.error("❌ Erreur réponse :", error);
    hangUp(false);
  } finally {
    isRenegotiating = false;
  }
}

/* =========================================================
   TRANSFORMER UN APPEL AUDIO EN APPEL VIDÉO
========================================================= */

async function upgradeToVideo() {
  if (!peerConnection || !localStream || isVideoCall) {
    console.log("⛔ upgradeToVideo() annulé");
    return;
  }

  const confirmed = window.confirm("Voulez-vous passer en appel vidéo ?");
  if (!confirmed) {
    console.log("📹 Passage en vidéo annulé par l'appelant");
    return;
  }

  console.log("📹 upgradeToVideo() démarré");

  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode },
    });
    const videoTrack = videoStream.getVideoTracks()[0];
    if (!videoTrack) return;

    isRenegotiating = true;

    localStream.addTrack(videoTrack);
    peerConnection.addTrack(videoTrack, localStream);

    isVideoCall = true;

    const localVideo = document.getElementById("local-video");
    if (localVideo) localVideo.srcObject = localStream;
    showInterface(interfaceVideo);
    showLocalVideoPlaceholder(false);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    sendSignal({
      type: "restart-offer",
      targetId: targetUserId,
      offer: offer,
      isVideo: true,
    });
    updateStatus("Passage en appel vidéo...");
  } catch (error) {
    isRenegotiating = false;
    console.error("❌ Erreur passage en vidéo :", error);
  }
}

async function performVideoUpgrade() {
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode },
    });
    const videoTrack = videoStream.getVideoTracks()[0];
    if (!videoTrack) return;

    isRenegotiating = true;

    localStream.addTrack(videoTrack);
    peerConnection.addTrack(videoTrack, localStream);

    isVideoCall = true;

    const localVideo = document.getElementById("local-video");
    if (localVideo) localVideo.srcObject = localStream;
    showInterface(interfaceVideo);
    showLocalVideoPlaceholder(false);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    sendSignal({
      type: "restart-offer",
      targetId: targetUserId,
      offer: offer,
      isVideo: true,
    });
    updateStatus("Passage en appel vidéo...");
  } catch (error) {
    isRenegotiating = false;
    console.error("❌ Erreur passage en vidéo :", error);
  }
}

function handleVideoUpgradeRequest(data) {
  console.log("📹 Demande de passage en vidéo reçue de :", data.from);

  const accept = window.confirm("Voulez-vous passer en appel vidéo ?");

  sendSignal({
    type: "video-upgrade-response",
    targetId: targetUserId,
    accepted: accept,
  });

  if (!accept) {
    console.log("📹 Passage en vidéo refusé");
  }
}

function handleVideoUpgradeResponse(data) {
  if (data.accepted) {
    console.log("📹 Passage en vidéo accepté par le destinataire");
    performVideoUpgrade();
  } else {
    console.log("📹 Passage en vidéo refusé par le destinataire");
    updateStatus("Appel connecté");
    alert("L'autre personne a refusé de passer en appel vidéo.");
  }
}

async function handleVideoUpgradeOffer(data) {
  if (!peerConnection) {
    console.log("⛔ handleVideoUpgradeOffer() ignoré — pas de peerConnection");
    return;
  }
  console.log("📹 handleVideoUpgradeOffer() reçu — isVideoCall avant:", isVideoCall);
  isRenegotiating = true;

  try {
    if (!isVideoCall) {
      isVideoCall = true;
      showInterface(interfaceVideo);
      showLocalVideoPlaceholder(true);
      isCameraOff = true;
      updateCameraIcon();
    }

    const SessionDescription = activeRTC ? activeRTC.SessionDescription : RTCSessionDescription;
    await peerConnection.setRemoteDescription(new SessionDescription(data.offer));
    console.log("📹 setRemoteDescription(offer) OK");
    await processPendingCandidates();

    const videoTransceiver = peerConnection
      .getTransceivers()
      .find(
        (t) =>
          t.receiver && t.receiver.track && t.receiver.track.kind === "video",
      );

    if (
      videoTransceiver &&
      !(localStream && localStream.getVideoTracks().length > 0)
    ) {
      videoTransceiver.direction = "recvonly";
    }

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log("📹 Réponse créée (recvonly si pas encore de caméra locale)");

    sendSignal({ type: "answer-call", targetId: targetUserId, answer: answer });
    updateStatus("Appel vidéo connecté");
  } catch (error) {
    console.error("❌ Erreur réception passage vidéo :", error);
  } finally {
    isRenegotiating = false;
  }
}

/* =========================================================
   2. PARTIE RÉCEPTEUR (INCOMING CALL)
========================================================= */

function handleIncomingCall(data) {
  console.log("📞 Appel entrant reçu de :", data.from);

  cleanCallState();
  targetUserId = data.from;
  pendingOffer = data.offer;
  currentCallId = data.callId;
  isVideoCall = data.isVideo === "true" || data.isVideo === true;
  if (data.notId) currentNotId = data.notId;

  updateStatus(isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...");
  showInterface(interfaceReceiver);
  startVibration();
}

async function handleCallOfferDetails(data) {
  console.log("📦 Offre SDP reçue du serveur pour :", data.callId);

  targetUserId = data.from;
  pendingOffer = data.offer;
  isVideoCall = data.isVideo === "true" || data.isVideo === true;

  if (autoAcceptOnOffer && pendingOffer) {
    autoAcceptOnOffer = false;
    await acceptCall();
  }
}

async function acceptCall() {
  // iOS: réponse forcée via CallKit
  if (isIOS()) {
    console.log("ℹ️ [iOS] Réponse forcée via l'écran d'appel natif CallKit.");
    updateStatus("Décrochez depuis l'écran d'appel");
    return answerIncomingCall();
  }

  stopVibration();

  if (!pendingOffer) {
    if (currentCallId) {
      autoAcceptOnOffer = true;
      await ensureConnectedAndFetchOffer();
      return;
    }
    console.warn("⚠️ Aucune offre SDP disponible pour répondre.");
    return;
  }

  try {
    updateStatus("Connexion à l'appel...");
    await initMediaAndPeer();

    const SessionDescription = activeRTC ? activeRTC.SessionDescription : RTCSessionDescription;
    await peerConnection.setRemoteDescription(new SessionDescription(pendingOffer));
    await processPendingCandidates();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    sendSignal({
      type: "answer-call",
      targetId: targetUserId,
      answer: answer,
    });

    startTimer();
    pendingOffer = null;

    showInterface(isVideoCall ? interfaceVideo : interfaceSender);
    updateStatus("Appel connecté");
  } catch (error) {
    console.error("❌ Erreur acceptation appel :", error);
    hangUp(false);
  }
}

// iOS: Version spécifique pour answerIncomingCall
async function answerIncomingCall() {
  console.log("🚀 [iOS] answerIncomingCall() démarre");
  stopVibration();

  if (!pendingOffer) {
    if (currentCallId) {
      console.log("⏳ [iOS] Pas encore d'offre — nouvelle demande get-offer");
      autoAcceptOnOffer = true;
      await ensureConnectedAndFetchOffer();
      return;
    }
    console.warn("⚠️ [iOS] Aucune offre SDP disponible");
    return;
  }

  try {
    updateStatus("Connexion à l'appel...");

    // iOS: Activation audio AVANT getUserMedia
    if (isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
      console.log("🔊 [iOS] activateAudio() natif démarre...");
      await new Promise((resolve) => {
        try {
          cordova.plugins.CordovaCall.activateAudio(
            () => { console.log("✅ [iOS] AVAudioSession activée."); resolve(); },
            (err) => { console.warn("⚠️ [iOS] activateAudio erreur:", err); resolve(); }
          );
        } catch (e) {
          console.warn("⚠️ [iOS] activateAudio exception:", e);
          resolve();
        }
      });
    }

    await initMediaAndPeer(false); // false: attacher pistes après setRemoteDescription

    if (isVideoCall) {
      showInterface(interfaceVideo);
    }

    const SessionDescription = activeRTC ? activeRTC.SessionDescription : RTCSessionDescription;
    await peerConnection.setRemoteDescription(new SessionDescription(pendingOffer));

    attachLocalTracksToPeer();

    await processPendingCandidates();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    sendSignal({
      type: "answer-call",
      targetId: targetUserId,
      answer: answer,
    });

    startTimer();
    pendingOffer = null;

    showInterface(isVideoCall ? interfaceVideo : interfaceSender);
    updateStatus("Appel connecté");
  } catch (error) {
    console.error("❌ [iOS] Erreur acceptation appel :", error);
    hangUp(false);
  }
}

function rejectCall() {
  // iOS: Terminer appel CallKit
  if (isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
    try { cordova.plugins.CordovaCall.endCall(); } catch (e) {}
  }

  if (targetUserId) {
    sendSignal({
      type: "call-refused",
      targetId: targetUserId,
    });
  }
  stopVibration();
  cleanCallState();
  closeInterfaces();
  updateStatus("En ligne");
}

/* =========================================================
   3. FLUX MEDIA & WEBRTC
========================================================= */

function attachLocalTracksToPeer() {
  if (!peerConnection || !localStream) return;
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });
  console.log("✅ Pistes locales attachées au peerConnection");
}

async function initMediaAndPeer(attachTracksNow = true) {
  try {
    // Configuration de l'implémentation WebRTC
    activeRTC = {
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
      PeerConnection: window.RTCPeerConnection,
      SessionDescription: window.RTCSessionDescription,
      IceCandidate: window.RTCIceCandidate,
    };

    // iOS: Vérifier autorisations médias
    if (isIOS()) {
      await ensureMediaAuthorizedIOS();
    }

    localStream = await activeRTC.getUserMedia({
      audio: true,
      video: isVideoCall ? { facingMode: currentFacingMode } : false,
    });

    if (isVideoCall) {
      const localVideo = document.getElementById("local-video");
      if (localVideo) localVideo.srcObject = localStream;
    }

    // iOS: Activer haut-parleur par défaut
    if (isIOS() && typeof activerAudioSessionIOS === "function") {
      activerAudioSessionIOS(isSpeakerOn ? "speaker" : "receiver");
    }

    peerConnection = new activeRTC.PeerConnection(rtcConfig);

    if (attachTracksNow) {
      attachLocalTracksToPeer();
    }

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && targetUserId) {
        sendSignal({
          type: "ice-candidate",
          targetId: targetUserId,
          candidate: event.candidate,
        });
      }
    };

    peerConnection.ontrack = async (event) => {
      console.log("🔊/📹 ontrack déclenché — kind:", event.track.kind);

      const stream =
        event.streams && event.streams[0]
          ? event.streams[0]
          : new MediaStream([event.track]);

      if (event.track.kind === "video") {
        const remoteVideo = document.getElementById("remote-video");
        if (remoteVideo) {
          if (remoteVideo.srcObject !== stream) {
            remoteVideo.srcObject = stream;
          }
          try {
            await remoteVideo.play();
          } catch (e) {
            console.error("❌ Erreur play remote-video :", e);
          }
        }
      } else {
        const remoteAudio =
          document.getElementById("remoteAudio") ||
          document.getElementById("remote-audio");
        if (remoteAudio) {
          if (remoteAudio.srcObject !== stream) {
            remoteAudio.srcObject = stream;
          }
          try {
            await remoteAudio.play();
          } catch (e) {}
        }
      }
    };

    // iOS: Utiliser oniceconnectionstatechange au lieu de onconnectionstatechange
    const stateChangeEvent = isIOS() ? "oniceconnectionstatechange" : "onconnectionstatechange";
    const stateProperty = isIOS() ? "iceConnectionState" : "connectionState";

    peerConnection[stateChangeEvent] = () => {
      const state = peerConnection[stateProperty];
      console.log("🔗 État WebRTC :", state);

      if ((state === "failed" || state === "disconnected") && !isRestartingIce && !isRenegotiating) {
        console.log("⚠️ Déclenchement restartIceSession()");
        restartIceSession();
      }

      if (state === "connected") {
        isRestartingIce = false;
        updateStatus("Appel connecté");

        // iOS: Activer haut-parleur à la connexion
        if (isIOS() && typeof activerAudioSessionIOS === "function") {
          activerAudioSessionIOS(isSpeakerOn ? "speaker" : "receiver");
        }
      }
    };
  } catch (error) {
    console.error("❌ Erreur dans initMediaAndPeer() :", error);
  }
}

async function handleNewICECandidate(data) {
  if (!data.candidate) return;

  if (!peerConnection || !peerConnection.remoteDescription) {
    pendingCandidates.push(data.candidate);
    return;
  }

  try {
    const IceCandidate = activeRTC ? activeRTC.IceCandidate : RTCIceCandidate;
    await peerConnection.addIceCandidate(new IceCandidate(data.candidate));
  } catch (error) {
    console.error("❌ Erreur ICE candidate :", error);
  }
}

async function processPendingCandidates() {
  if (pendingCandidates.length > 0) {
    const IceCandidate = activeRTC ? activeRTC.IceCandidate : RTCIceCandidate;
    for (const candidate of pendingCandidates) {
      try {
        await peerConnection.addIceCandidate(new IceCandidate(candidate));
      } catch (e) {}
    }
    pendingCandidates = [];
  }
}

/* =========================================================
   4. RECONNEXION ICE
========================================================= */

async function restartIceSession() {
  if (!peerConnection || !targetUserId) return;

  try {
    isRestartingIce = true;
    if (typeof peerConnection.restartIce === "function") {
      peerConnection.restartIce();
    }

    const offer = await peerConnection.createOffer({ iceRestart: true });
    await peerConnection.setLocalDescription(offer);

    sendSignal({
      type: "restart-offer",
      targetId: targetUserId,
      offer: offer,
    });
  } catch (error) {
    isRestartingIce = false;
  }
}

async function handleRestartOffer(data) {
  if (!peerConnection) return;

  try {
    const SessionDescription = activeRTC ? activeRTC.SessionDescription : RTCSessionDescription;
    await peerConnection.setRemoteDescription(new SessionDescription(data.offer));
    await processPendingCandidates();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    sendSignal({
      type: "answer-call",
      targetId: targetUserId,
      answer: answer,
    });
  } catch (e) {}
}

/* =========================================================
   5. NETTOYAGE
========================================================= */

function clearNativeCallNotification() {
  if (!currentNotId) return;
  if (!(isIOS() && push && typeof push.clearNotification === "function")) {
    return;
  }
  const notIdToClear = currentNotId;
  push.clearNotification(
    Number(notIdToClear),
    () => console.log("✅ Notification native supprimée"),
    (err) => console.warn("⚠️ Échec suppression notification native :", err)
  );
}

function hangUp(sendSignalToPeer = true) {
  if (sendSignalToPeer && targetUserId) {
    sendSignal({
      type: "call-end",
      targetId: targetUserId,
    });
  }

  cleanCallState();
  closeInterfaces();
  toggleCallButtons(false);
  updateStatus("En ligne");
}

function cleanCallState() {
  clearNativeCallNotification();

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  const localVideo = document.getElementById("local-video");
  const remoteVideo = document.getElementById("remote-video");
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;

  if (peerConnection) {
    try { peerConnection.close(); } catch (e) {}
    peerConnection = null;
  }
  activeRTC = null;

  stopTimer();
  stopVibration();

  pendingOffer = null;
  currentCallId = null;
  currentNotId = null;
  targetUserId = null;
  pendingCandidates = [];
  autoAcceptOnOffer = false;
  isRestartingIce = false;
  isVideoCall = false;
  isCameraOff = false;
  isRenegotiating = false;
  isSpeakerOn = true;

  localStorage.removeItem("pending_call_id");
}

function toggleMicrophone() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;

  isMuted = !isMuted;
  audioTrack.enabled = !isMuted;

  const micBtn = document.getElementById("btn-toggle-mic");
  const micIcon = document.getElementById("mic-icon");
  const micLabel = document.getElementById("mic-label");

  if (isMuted) {
    if (micIcon) micIcon.className = "fa-solid fa-microphone-slash";
    if (micLabel) micLabel.textContent = "Activer le micro";
    if (micBtn) micBtn.classList.add("active-mute");
  } else {
    if (micIcon) micIcon.className = "fa-solid fa-microphone";
    if (micLabel) micLabel.textContent = "Désactiver le micro";
    if (micBtn) micBtn.classList.remove("active-mute");
  }
}

// Android: Gestion AudioRoute
let currentAudioRoute = "earpiece";

const ROUTE_LABELS = {
  earpiece: "Téléphone",
  speaker: "Haut-parleur",
  bluetooth: "Bluetooth",
};
const ROUTE_ICONS = {
  earpiece: "fa-solid fa-phone-volume",
  speaker: "fa-solid fa-volume-high",
  bluetooth: "fa-brands fa-bluetooth-b",
};

function getAudioRoutes() {
  return new Promise((resolve) => {
    if (!window.cordova || !cordova.exec) {
      resolve({ routes: ["earpiece", "speaker"], current: "earpiece" });
      return;
    }
    cordova.exec(
      resolve,
      () => resolve({ routes: ["earpiece", "speaker"], current: "earpiece" }),
      "AudioRoutePlugin",
      "getRoutes",
      [],
    );
  });
}

function setAudioRoute(route) {
  return new Promise((resolve) => {
    if (!window.cordova || !cordova.exec) {
      resolve(route);
      return;
    }
    cordova.exec(
      resolve,
      () => resolve(route),
      "AudioRoutePlugin",
      "setRoute",
      [route],
    );
  });
}

async function toggleAudioRouteMenu() {
  const menu = document.getElementById("audio-route-menu");
  if (!menu) return;

  if (menu.classList.contains("open")) {
    menu.classList.remove("open");
    return;
  }

  const { routes, current } = await getAudioRoutes();
  currentAudioRoute = current || "earpiece";

  menu.innerHTML = "";
  routes.forEach((route) => {
    const item = document.createElement("div");
    item.className =
      "audio-route-item" + (route === currentAudioRoute ? " active" : "");
    item.innerHTML = `<i class="${ROUTE_ICONS[route] || "fa-solid fa-volume-high"}"></i><span>${ROUTE_LABELS[route] || route}</span>`;
    item.onclick = async () => {
      await setAudioRoute(route);
      currentAudioRoute = route;
      updateAudioRouteIcon();
      menu.classList.remove("open");
    };
    menu.appendChild(item);
  });

  menu.classList.add("open");
}

function updateAudioRouteIcon() {
  const icon = document.getElementById("audio-route-icon");
  if (icon)
    icon.className =
      ROUTE_ICONS[currentAudioRoute] || "fa-brands fa-bluetooth-b";
}

// iOS: Gestion haut-parleur
function toggleSpeaker() {
  isSpeakerOn = !isSpeakerOn;

  if (isIOS() && typeof activerAudioSessionIOS === "function") {
    activerAudioSessionIOS(isSpeakerOn ? "speaker" : "receiver");
  }

  const speakerIcon = document.getElementById("speaker-icon");
  const btn = document.getElementById("btn-toggle-speaker");

  if (isSpeakerOn) {
    if (speakerIcon) speakerIcon.className = "fa-solid fa-volume-high";
    if (btn) btn.classList.remove("disabled");
  } else {
    if (speakerIcon) speakerIcon.className = "fa-solid fa-volume-low";
    if (btn) btn.classList.add("disabled");
  }
}

/* =========================================================
   6. UI & TIMERS
========================================================= */

function updateStatus(message) {
  const statusElement = document.querySelectorAll(".status-bar");
  for (let i = 0; i < statusElement.length; i++) {
    statusElement[i].innerText = message;
  }
}

function toggleCallButtons(inCall) {
  const callButton = document.getElementById("btn-call");
  if (callButton) callButton.disabled = inCall;

  const hangupButton = document.getElementById("btn-hangup");
  if (hangupButton) hangupButton.disabled = !inCall;
}

function showInterface(activeInterface) {
  closeInterfaces();
  if (activeInterface) activeInterface.classList.add("active");

  // iOS: Configuration pour vidéo native
  if (activeInterface === interfaceVideo) {
    document.body.classList.add("video-call-active");
  } else {
    document.body.classList.remove("video-call-active");
  }

  // iOS: Refresh vidéos natives
  if (activeInterface === interfaceVideo && isIOS() && cordova.plugins && cordova.plugins.iosrtc) {
    cordova.plugins.iosrtc.refreshVideos();
    setTimeout(() => cordova.plugins.iosrtc.refreshVideos(), 300);
  }
}

function closeInterfaces() {
  if (interfaceReceiver) interfaceReceiver.classList.remove("active");
  if (interfaceSender) interfaceSender.classList.remove("active");
  if (interfaceVideo) interfaceVideo.classList.remove("active");
  document.body.classList.remove("video-call-active");
}

function startTimer() {
  let secondes = 0;
  if (timerInterval) return;

  timerInterval = setInterval(() => {
    secondes++;
    const h = String(Math.floor(secondes / 3600)).padStart(2, "0");
    const m = String(Math.floor((secondes % 3600) / 60)).padStart(2, "0");
    const s = String(secondes % 60).padStart(2, "0");

    const timerElement = document.getElementById("timer");
    const timerVideo = document.getElementById("timer-video");
    if (timerElement) timerElement.textContent = `${h}:${m}:${s}`;
    if (timerVideo) timerVideo.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  const timerElement = document.getElementById("timer");
  const timerVideo = document.getElementById("timer-video");
  if (timerElement) timerElement.textContent = "00:00:00";
  if (timerVideo) timerVideo.textContent = "00:00:00";
}

async function toggleCamera() {
  // Cas 1: on a déjà une piste vidéo locale
  if (localStream && localStream.getVideoTracks().length > 0) {
    const videoTrack = localStream.getVideoTracks()[0];
    isCameraOff = !isCameraOff;
    videoTrack.enabled = !isCameraOff;
    updateCameraIcon();
    return;
  }

  // Cas 2: pas encore de caméra locale
  if (!peerConnection || !localStream) return;

  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode },
    });
    const videoTrack = videoStream.getVideoTracks()[0];
    if (!videoTrack) return;

    localStream.addTrack(videoTrack);

    const videoTransceiver = peerConnection
      .getTransceivers()
      .find(
        (t) =>
          t.receiver && t.receiver.track && t.receiver.track.kind === "video",
      );

    if (videoTransceiver) {
      await videoTransceiver.sender.replaceTrack(videoTrack);
      videoTransceiver.direction = "sendrecv";
    } else {
      peerConnection.addTrack(videoTrack, localStream);
    }

    const localVideo = document.getElementById("local-video");
    if (localVideo) localVideo.srcObject = localStream;

    showLocalVideoPlaceholder(false);
    isRenegotiating = true;
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal({
      type: "restart-offer",
      targetId: targetUserId,
      offer: offer,
      isVideo: true,
    });
    console.log("📹 Caméra activée manuellement, renégociation envoyée");

    isCameraOff = false;
    updateCameraIcon();
  } catch (error) {
    console.error("❌ Erreur activation caméra :", error);
    isRenegotiating = false;
  }
}

function updateCameraIcon() {
  const cameraIcon = document.getElementById("camera-icon");
  const btn = document.getElementById("btn-toggle-camera");

  if (isCameraOff) {
    if (cameraIcon) cameraIcon.className = "fa-solid fa-video-slash";
    if (btn) btn.classList.add("disabled");
  } else {
    if (cameraIcon) cameraIcon.className = "fa-solid fa-video";
    if (btn) btn.classList.remove("disabled");
  }
}

function showLocalVideoPlaceholder(show) {
  const placeholder = document.getElementById("local-video-placeholder");
  if (placeholder) placeholder.style.display = show ? "flex" : "none";
}

/* =========================================================
   CHANGEMENT DE CAMÉRA (AVANT/ARRIÈRE)
========================================================= */

async function switchCamera() {
  if (!isVideoCall || !peerConnection || !localStream) {
    console.log("⛔ switchCamera() impossible - pas d'appel vidéo en cours");
    return;
  }

  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) {
    console.log("⛔ switchCamera() impossible - pas de piste vidéo");
    return;
  }

  try {
    // Changer le facing mode
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    console.log("📷 Changement de caméra:", currentFacingMode === "user" ? "avant" : "arrière");

    // Arrêter l'ancienne piste vidéo
    videoTrack.stop();

    // Obtenir un nouveau flux avec la nouvelle caméra
    const newVideoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode },
    });

    const newVideoTrack = newVideoStream.getVideoTracks()[0];
    if (!newVideoTrack) {
      console.error("❌ Impossible d'obtenir la nouvelle piste vidéo");
      return;
    }

    // Remplacer la piste dans le stream local
    const oldTrack = localStream.getVideoTracks()[0];
    localStream.removeTrack(oldTrack);
    localStream.addTrack(newVideoTrack);

    // Remplacer la piste dans le peer connection
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      await sender.replaceTrack(newVideoTrack);
    } else {
      peerConnection.addTrack(newVideoTrack, localStream);
    }

    // Mettre à jour l'élément vidéo local
    const localVideo = document.getElementById("local-video");
    if (localVideo) {
      localVideo.srcObject = localStream;
    }

    // Nettoyer l'ancien stream
    newVideoStream.getAudioTracks().forEach(track => track.stop());

    console.log("✅ Caméra changée avec succès");

  } catch (error) {
    console.error("❌ Erreur lors du changement de caméra:", error);
    // Revenir à l'ancienne caméra en cas d'erreur
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
  }
}

/* =========================================================
   APPEL ENTRANT DÉCLENCHÉ NATIVEMENT
========================================================= */

function onNativeIncomingCall(callId, from, isVideo, autoAnswer = false) {
  console.log("📲 Appel entrant natif :", callId, from, isVideo, "autoAnswer:", autoAnswer);

  if (!appReady) {
    console.log("⏳ App pas encore prête, appel natif mis en attente");
    pendingNativeCall = { callId, from, isVideo, autoAnswer };
    return;
  }

  processIncomingCall(callId, from, isVideo, autoAnswer);
}

function processIncomingCall(callId, from, isVideo, autoAnswer = false) {
  if (peerConnection) {
    console.log("Appel déjà en cours, appel natif ignoré");
    return;
  }

  if (!interfaceReceiver)
    interfaceReceiver = document.getElementById("interface-2");
  if (!interfaceSender)
    interfaceSender = document.getElementById("interface-1");
  if (!interfaceVideo) interfaceVideo = document.getElementById("interface-3");

  currentCallId = callId;
  targetUserId = from;
  isVideoCall = !!isVideo;
  autoAcceptOnOffer = !!autoAnswer;

  if (autoAcceptOnOffer) {
    showInterface(isVideoCall ? interfaceVideo : interfaceSender);
    updateStatus("Connexion à l'appel...");
  } else {
    showInterface(interfaceReceiver);
    updateStatus(isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...");
    startVibration();
  }

  ensureConnectedAndFetchOffer();
}

/* =========================================================
   VIBRATION
========================================================= */

function startVibration() {
  if (!("vibrate" in navigator)) return;

  isVibrating = true;
  const triggerContinuousVibration = () => {
    if (!isVibrating) return;
    navigator.vibrate([1000, 1000]);
    vibrationTimer = setTimeout(triggerContinuousVibration, 2000);
  };
  triggerContinuousVibration();
}

function stopVibration() {
  isVibrating = false;
  if (vibrationTimer) {
    clearTimeout(vibrationTimer);
    vibrationTimer = null;
  }
  if ("vibrate" in navigator) {
    navigator.vibrate(0);
  }
}

/* =========================================================
   OPTION INTERFACE APPEL (VIDÉO DÉPLAÇABLE)
========================================================= */

(function makeLocalVideoDraggable() {
  const wrapper = document.querySelector(".local-video-wrapper");
  const localVideo = document.getElementById("local-video");
  const remoteVideo = document.getElementById("remote-video");
  if (!wrapper) return;

  wrapper.style.position = "fixed";
  wrapper.style.zIndex = "9999";
  wrapper.style.touchAction = "none";

  let offsetX = 0,
    offsetY = 0,
    isDragging = false;
  let startX = 0,
    startY = 0,
    moved = 0,
    startTime = 0;
  let activePointerId = null;

  function start(x, y) {
    isDragging = true;
    moved = 0;
    startTime = Date.now();
    startX = x;
    startY = y;
    const rect = wrapper.getBoundingClientRect();
    offsetX = x - rect.left;
    offsetY = y - rect.top;
    wrapper.style.transition = "none";
  }

  function move(x, y) {
    if (!isDragging) return;
    moved += Math.abs(x - startX) + Math.abs(y - startY);
    startX = x;
    startY = y;

    let newX = x - offsetX;
    let newY = y - offsetY;
    const maxX = window.innerWidth - wrapper.offsetWidth;
    const maxY = window.innerHeight - wrapper.offsetHeight;
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    wrapper.style.left = newX + "px";
    wrapper.style.top = newY + "px";
    wrapper.style.right = "auto";
    wrapper.style.bottom = "auto";
  }

  function end() {
    if (!isDragging) return;
    isDragging = false;
    wrapper.style.transition = "left 0.2s ease, top 0.2s ease";

    const elapsed = Date.now() - startTime;

    if (moved < 15 && elapsed < 300) {
      swapVideos();
      return;
    }

    const rect = wrapper.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const snapLeft = centerX < window.innerWidth / 2;
    wrapper.style.left = snapLeft
      ? "10px"
      : window.innerWidth - rect.width - 10 + "px";
  }

  function swapVideos() {
    if (!localVideo || !remoteVideo) return;
    const tmp = localVideo.srcObject;
    localVideo.srcObject = remoteVideo.srcObject;
    remoteVideo.srcObject = tmp;
    localVideo.play().catch(() => {});
    remoteVideo.play().catch(() => {});
  }

  wrapper.addEventListener("pointerdown", (e) => {
    activePointerId = e.pointerId;
    wrapper.setPointerCapture(e.pointerId);
    start(e.clientX, e.clientY);
  });

  wrapper.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activePointerId) return;
    move(e.clientX, e.clientY);
  });

  wrapper.addEventListener("pointerup", (e) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    end();
  });

  wrapper.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    isDragging = false;
  });
})();

/* =========================================================
   EXPOSITIONS GLOBALES
========================================================= */

window.makeCall = makeCall;
window.acceptCall = acceptCall;
window.rejectCall = rejectCall;
window.hangUp = hangUp;
window.connectWebSocket = connectWebSocket;
window.toggleMicrophone = toggleMicrophone;
window.makeVideoCall = makeVideoCall;
window.toggleCamera = toggleCamera;
window.onNativeIncomingCall = onNativeIncomingCall;
window.upgradeToVideo = upgradeToVideo;
window.toggleAudioRouteMenu = toggleAudioRouteMenu;
window.toggleSpeaker = toggleSpeaker;
window.switchCamera = switchCamera;