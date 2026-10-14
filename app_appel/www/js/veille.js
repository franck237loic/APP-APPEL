/* =========================================================
   CONFIGURATION ET ÉTAT GLOBAL
========================================================= */

const SIGNALING_SERVER_URL = "wss://node-b44u.onrender.com";
const HTTP_SERVER_URL = "https://node-b44u.onrender.com";
const RECONNECT_DELAY = 5000;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

let myId = null;
let targetUserId = null;
let ws = null;
let reconnectTimer = null;
let manuallyClosed = false;
let deviceToken = null;
let push = null;

let peerConnection = null;
let localStream = null;
let pendingCandidates = [];
let pendingOffer = null;
let currentCallId = null;
let autoAcceptOnOffer = false; // Flag pour lancer l'appel dès qu'on reçoit l'offre

let isMuted = false;
let isRestartingIce = false;
let timerInterval = null;

let vibrationTimer = null;
let isVibrating = false;

let isVideoCall = false;
let isCameraOff = false;

let interfaceSender = null;
let interfaceReceiver = null;
let interfaceVideo = null;

// Passe à true seulement une fois onDeviceReady totalement terminé
// (permissions accordées + WebSocket connecté). Tant que ce n'est pas
// le cas, un appel natif entrant est mis en attente plutôt que perdu.
let appReady = false;
let pendingNativeCall = null;

/* =========================================================
   INITIALISATION ET AUTORISATIONS
========================================================= */

document.addEventListener("deviceready", onDeviceReady, false);

// Récupération des interfaces du DOM dès le chargement du script (le DOM
// est déjà prêt à ce stade, pas besoin d'attendre deviceready pour ça) —
// évite que showInterface() reçoive null si un appel natif arrive tôt.
interfaceSender = document.getElementById("interface-1");
interfaceReceiver = document.getElementById("interface-2");
interfaceVideo = document.getElementById("interface-3");

async function onDeviceReady() {
  console.log("🚀 Initialisation de l'application WebRTC...");

  try {
    await requestMicrophonePermission();
    await requestCameraPermission();
    await requestNotificationPermission();
    await connectWebSocket();
  } catch (error) {
    console.error("❌ Erreur au démarrage :", error);
    updateStatus("Erreur d'initialisation");
  }
}

function requestNotificationPermission() {
  // Nécessaire sur Android 13+ (API 33) sinon aucune notification,
  // donc aucun réveil d'écran, ne peut être affichée.
  return new Promise((resolve) => {
    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
      const permissions = cordova.plugins.permissions;
      const perm =
        permissions.POST_NOTIFICATIONS ||
        "android.permission.POST_NOTIFICATIONS";
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

// S'assure que le WebSocket est totalement authentifié avant de demander l'offre
async function ensureConnectedAndFetchOffer() {
  if (!currentCallId) {
    currentCallId = localStorage.getItem("pending_call_id");
  }

  if (currentCallId) {
    console.log("📩 Demande de l'offre SDP pour callId :", currentCallId);
    sendSignal({
      type: "get-offer",
      callId: currentCallId,
    });
  }
}

/* =========================================================
   SIGNALISATION WEBSOCKET (COMMUN)
========================================================= */

async function connectWebSocket() {
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  updateStatus("Connexion au serveur...");

  try {
    await fetch(HTTP_SERVER_URL, { method: "GET", cache: "no-cache" });
  } catch (err) {
    console.warn("⚠️ HTTP Ping échoué :", err);
  }

  return new Promise((resolve) => {
    createWebSocket(resolve);
  });
}

function createWebSocket(onOpenCallback) {
  if (ws) {
    try {
      ws.close();
    } catch (e) {}
    ws = null;
  }

  try {
    ws = new WebSocket(SIGNALING_SERVER_URL);
  } catch (error) {
    console.error("❌ Erreur création WebSocket :", error);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log("✅ WebSocket Connecté");
    updateStatus("En ligne");
    sendSignal({ type: "register-user", userId: myId, pushToken: deviceToken });
    if (typeof onOpenCallback === "function") onOpenCallback();
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    if (data.type === "ping") {
      sendSignal({ type: "pong" });
      console.log("🏓 Pong envoyé");
      return;
    }

    console.log("📦 Signal reçu :", data.type);

    switch (data.type) {
      case "call-offer-details":
        handleCallOfferDetails(data);
        break;

      case "call-expired":
        alert("L'appel a expiré ou a été annulé.");
        hangUp(false);
        break;

      case "restart-offer":
        handleRestartOffer(data);
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
    console.warn(
      "⚠️ Impossible d'envoyer le signal (Socket non prêt), nouvelle tentative dans 500ms:",
      data.type,
    );
    setTimeout(() => sendSignal(data), 500);
    return false;
  }
}

/* =========================================================
   2. PARTIE RÉCEPTEUR (INCOMING CALL)
========================================================= */

/* =========================================================
   RÉCEPTION DE L'OFFRE DEPUIS LE SERVEUR NODE.JS
========================================================= */
async function handleCallOfferDetails(data) {
  console.log("📦 Offre SDP reçue du serveur pour :", data.callId);

  targetUserId = data.from;
  pendingOffer = data.offer;
  currentCallId = data.callId;
  isVideoCall = (data.isVideo === "true" || data.isVideo === true);

  updateStatus(isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...");

  // FIX : Si l'utilisateur a déjà cliqué sur Décrocher, on finalise la connexion maintenant !
  if (autoAcceptOnOffer) {
    autoAcceptOnOffer = false;
    acceptCall();
  }
}

/* =========================================================
   ACCEPTATION DE L'APPEL
========================================================= */
async function acceptCall() {
  stopVibration();

  // FIX : Si l'offre SDP n'est pas encore arrivée via le WebSocket
  if (!pendingOffer) {
    console.log("⏳ Offre non disponible. Activation de autoAcceptOnOffer...");
    autoAcceptOnOffer = true;
    updateStatus("Récupération de l'appel...");
    await ensureConnectedAndFetchOffer();
    return; // S'arrête ici et reprendra automatiquement dans handleCallOfferDetails
  }

  try {
    updateStatus("Connexion à l'appel...");
    await initMediaAndPeer();

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(pendingOffer)
    );
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

    // Affiche l'interface 1 (audio) ou 3 (vidéo)
    showInterface(isVideoCall ? interfaceVideo : interfaceSender);
    updateStatus("Appel connecté");
  } catch (error) {
    console.error("❌ Erreur acceptation appel :", error);
    hangUp(false);
  }
}

// async function acceptCall() {
//   stopVibration();

//   if (!pendingOffer) {
//     if (currentCallId) {
//       autoAcceptOnOffer = true;
//       await ensureConnectedAndFetchOffer();
//       return;
//     }
//     console.warn("⚠️ Aucune offre SDP disponible pour répondre.");
//     return;
//   }

//   try {
//     updateStatus("Connexion à l'appel...");
//     await initMediaAndPeer();

//     await peerConnection.setRemoteDescription(
//       new RTCSessionDescription(pendingOffer),
//     );
//     await processPendingCandidates();

//     const answer = await peerConnection.createAnswer();
//     await peerConnection.setLocalDescription(answer);

//     sendSignal({
//       type: "answer-call",
//       targetId: targetUserId,
//       answer: answer,
//     });

//     startTimer();
//     pendingOffer = null;

//     showInterface(isVideoCall ? interfaceVideo : interfaceSender);
//     updateStatus("Appel connecté");
//   } catch (error) {
//     console.error("❌ Erreur acceptation appel :", error);
//     hangUp(false);
//   }
// }

function rejectCall() {
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
  notifyNativeCallClosed();
}

/* =========================================================
   3. FLUX MEDIA & WEBRTC
========================================================= */

async function initMediaAndPeer() {
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: isVideoCall ? { facingMode: "user" } : false,
  });

  if (isVideoCall) {
    const localVideo = document.getElementById("local-video");
    if (localVideo) localVideo.srcObject = localStream;
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

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
    console.log("🔊/📹 Flux distant reçu");

    if (isVideoCall) {
      const remoteVideo = document.getElementById("remote-video");
      if (remoteVideo) {
        if (remoteVideo.srcObject !== event.streams[0]) {
          remoteVideo.srcObject = event.streams[0];
        }
        try {
          await remoteVideo.play();
        } catch (e) {}
      }
    } else {
      const remoteAudio =
        document.getElementById("remoteAudio") ||
        document.getElementById("remote-audio");
      if (remoteAudio) {
        if (remoteAudio.srcObject !== event.streams[0]) {
          remoteAudio.srcObject = event.streams[0];
        }
        try {
          await remoteAudio.play();
        } catch (e) {}
      }
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log("🔗 État WebRTC :", state);

    if ((state === "failed" || state === "disconnected") && !isRestartingIce) {
      restartIceSession();
    }

    if (state === "connected") {
      isRestartingIce = false;
      updateStatus("Appel connecté");
    }
  };
}

async function handleNewICECandidate(data) {
  if (!data.candidate) return;

  if (!peerConnection || !peerConnection.remoteDescription) {
    pendingCandidates.push(data.candidate);
    return;
  }

  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (error) {
    console.error("❌ Erreur ICE candidate :", error);
  }
}

async function processPendingCandidates() {
  if (pendingCandidates.length > 0) {
    for (const candidate of pendingCandidates) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
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
    peerConnection.restartIce();

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
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.offer),
    );
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
  notifyNativeCallClosed();
}

function cleanCallState() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  const localVideo = document.getElementById("local-video");
  const remoteVideo = document.getElementById("remote-video");
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;

  if (peerConnection) {
    try {
      peerConnection.close();
    } catch (e) {}
    peerConnection = null;
  }

  stopTimer();
  stopVibration();

  pendingOffer = null;
  currentCallId = null;
  targetUserId = null;
  pendingCandidates = [];
  autoAcceptOnOffer = false;
  isRestartingIce = false;
  isVideoCall = false;
  isCameraOff = false;

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
}

function closeInterfaces() {
  if (interfaceReceiver) interfaceReceiver.classList.remove("active");
  if (interfaceSender) interfaceSender.classList.remove("active");
  if (interfaceVideo) interfaceVideo.classList.remove("active");
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

function toggleCamera() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  isCameraOff = !isCameraOff;
  videoTrack.enabled = !isCameraOff;

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

/* =========================================================
   APPEL ENTRANT DÉCLENCHÉ NATIVEMENT (écran verrouillé / app tuée)
========================================================= */

// Appelée par MainActivity.java (evaluateJavascript) quand l'appli a été
// réveillée par la notification plein écran du service FCM natif.

function onNativeIncomingCall(callId, from, isVideo, autoAnswer = false) {
  console.log("📲 Appel entrant natif :", callId, from, isVideo, "autoAnswer:", autoAnswer);

  // 1. Initialiser les variables globales de l'appel
  currentCallId = callId;
  targetUserId = from;
  isVideoCall = (isVideo === true || isVideo === "true");

  // 2. Si le WebSocket est déjà prêt, demander tout de suite l'offre SDP au serveur
  if (ws && ws.readyState === WebSocket.OPEN) {
    ensureConnectedAndFetchOffer();
  }

  // 3. Si l'utilisateur a appuyé sur "Décrocher" depuis la notification native
  if (autoAnswer) {
    acceptCall();
  }
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

function notifyNativeCallClosed() {
  if (
    window.AndroidCall &&
    typeof window.AndroidCall.closeCallScreen === "function"
  ) {
    window.AndroidCall.closeCallScreen();
  }
}

/* =========================================================
   EXPOSITIONS GLOBALES
========================================================= */


window.acceptCall = acceptCall;
window.rejectCall = rejectCall;
window.hangUp = hangUp;
window.connectWebSocket = connectWebSocket;
window.toggleMicrophone = toggleMicrophone;
window.makeVideoCall = makeVideoCall;
window.toggleCamera = toggleCamera;
window.onNativeIncomingCall = onNativeIncomingCall;
