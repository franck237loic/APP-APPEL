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

let interfaceReceiver = null;
let interfaceSender = null;
let interfaceVideo = null;

// Passe à true seulement une fois onDeviceReady totalement terminé
// (permissions accordées + WebSocket connecté). Tant que ce n'est pas
// le cas, un appel natif entrant est mis en attente plutôt que perdu.
let appReady = false;
let pendingNativeCall = null;

// Empêche restartIceSession() de se déclencher pendant qu'on renégocie
// la connexion pour passer d'un appel audio à un appel vidéo (les deux
// négociations SDP en même temps cassent l'échange).
let isRenegotiating = false;

/* =========================================================
   INITIALISATION ET AUTORISATIONS
========================================================= */

document.addEventListener("deviceready", onDeviceReady, false);

// Récupération des interfaces du DOM dès le chargement du script (le DOM
// est déjà prêt à ce stade, pas besoin d'attendre deviceready pour ça) —
// évite que showInterface() reçoive null si un appel natif arrive tôt.
interfaceReceiver = document.getElementById("interface-2");
interfaceSender = document.getElementById("interface-1");
interfaceVideo = document.getElementById("interface-3");

async function onDeviceReady() {
  console.log("🚀 Initialisation de l'application WebRTC...");

  try {
    await requestMicrophonePermission();
    await requestCameraPermission();
    await requestBluetoothPermission();
    await requestNotificationPermission();
    initializeUserId();
    initPushNotifications();

    const idElement = document.getElementById("my-id-display");
    if (idElement) idElement.innerText = myId;

    await connectWebSocket();

    appReady = true;
    if (pendingNativeCall) {
      const call = pendingNativeCall;
      pendingNativeCall = null;
      processIncomingCall(call.callId, call.from, call.isVideo);
    }
  } catch (error) {
    console.error("❌ Erreur au démarrage :", error);
    updateStatus("Erreur d'initialisation");
  }
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

function initializeUserId() {
  myId = localStorage.getItem("app_user_id");
  if (!myId) {
    myId = "ID-" + Math.floor(100000 + Math.random() * 900000);
    localStorage.setItem("app_user_id", myId);
  }
  console.log("👤 Mon ID local :", myId);
}

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
      },
    });

    push.on("registration", function (data) {
      console.log("✅ ENREGISTREMENT FCM RÉUSSI :", data.registrationId);
      deviceToken = data.registrationId;

      if (ws && ws.readyState === WebSocket.OPEN) {
        sendSignal({
          type: "register-user",
          userId: myId,
          pushToken: deviceToken,
        });
      }
    });

    // =========================================================
    // ACTION : ACCEPTER (Bouton de la notification native)
    // =========================================================
    push.on("accept", async function (data) {
      console.log("📞 ===== ACCEPTER DEPUIS PUSH (BACKGROUND/CLOSED) =====");
      const additionalData = data.additionalData || {};

      extractPushData(additionalData);
      console.log("additionalData call", additionalData);
      autoAcceptOnOffer = true;
      //ici si l' appel est deja en cours on l'accepte pas
      if (peerConnection) {
        console.log("Appel déjà en cours, acceptation ignorée");
        return;
      }
      showInterface(isVideoCall ? interfaceVideo : interfaceSender);
      updateStatus("Connexion à l'appel...");

      await ensureConnectedAndFetchOffer();
    });

    // =========================================================
    // ACTION : REFUSER
    // =========================================================
    push.on("reject", async function (data) {
      console.log("📵 BOUTON REFUSER CLIQUÉ");
      const additionalData = data.additionalData || {};

      extractPushData(additionalData);

      await ensureSocketReady();
      rejectCall();

      if (push && additionalData.notId) {
        push.finish(() => console.log("✅ Notification refusée terminée"));
      }
    });

    // =========================================================
    // ACTION : CLIC SUR LA NOTIFICATION
    // =========================================================
    push.on("notification", async function (data) {
      console.log("🔔 Notification cliquée/reçue :", JSON.stringify(data));
      const additionalData = data.additionalData || {};

      if (additionalData.type === "incoming-call") {
        extractPushData(additionalData);
        autoAcceptOnOffer = false; // L'utilisateur doit cliquer sur "Accepter" dans l'UI

        showInterface(interfaceReceiver);
        updateStatus(
          isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...",
        );
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

// Extraire et formater les données reçues de FCM
function extractPushData(data) {
  if (data.callerId) targetUserId = data.callerId;
  if (data.callId) {
    currentCallId = data.callId;
    localStorage.setItem("pending_call_id", data.callId);
  }
  if (data.isVideo !== undefined) {
    isVideoCall = data.isVideo === "true" || data.isVideo === true;
  }
}

// S'assure que le WebSocket est totalement authentifié avant de demander l'offre
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

// Attend que la connexion WebSocket soit établie et enregistrée
function ensureSocketReady() {
  return new Promise((resolve) => {
    // Si déjà connecté, on enregistre et on valide
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendSignal({
        type: "register-user",
        userId: myId,
        pushToken: deviceToken,
      });
      setTimeout(resolve, 200);
      return;
    }

    // Sinon, on initie la connexion et on attend l'événement WS OPEN réel
    connectWebSocket().then(() => {
      const checkInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          clearInterval(checkInterval);
          sendSignal({
            type: "register-user",
            userId: myId,
            pushToken: deviceToken,
          });
          setTimeout(resolve, 200); // Petit délai post-enregistrement
        }
      }, 100);
    });
  });
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
    console.warn(
      "⚠️ Impossible d'envoyer le signal (Socket non prêt), nouvelle tentative dans 500ms:",
      data.type,
    );
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
  console.log(
    "📞 Appel accepté par le destinataire (ou réponse d'upgrade vidéo reçue)",
  );
  if (!peerConnection) return;

  try {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.answer),
    );
    console.log(
      "📹 setRemoteDescription(answer) OK — transceivers :",
      peerConnection
        .getTransceivers()
        .map((t) => `${t.mid}:${t.direction}`)
        .join(", "),
    );
    await processPendingCandidates();
    startTimer();
    updateStatus("Appel connecté");
  } catch (error) {
    console.error("❌ Erreur réponse :", error);
    hangUp(false);
  } finally {
    // Referme la garde de renégociation, que ce soit une réponse d'appel
    // classique ou la réponse au passage audio -> vidéo.
    isRenegotiating = false;
  }
}

/* =========================================================
   TRANSFORMER UN APPEL AUDIO EN APPEL VIDÉO
========================================================= */

async function upgradeToVideo() {
  if (!peerConnection || !localStream || isVideoCall) {
    console.log(
      "⛔ upgradeToVideo() annulé — peerConnection:",
      !!peerConnection,
      "localStream:",
      !!localStream,
      "isVideoCall:",
      isVideoCall,
    );
    return;
  }
  console.log("📹 upgradeToVideo() démarré");

  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
    });
    const videoTrack = videoStream.getVideoTracks()[0];
    if (!videoTrack) {
      console.error("❌ Aucune piste vidéo obtenue via getUserMedia");
      return;
    }
    console.log("📹 Track vidéo local obtenu :", videoTrack.label);

    // Active la garde AVANT toute étape de renégociation, pour bloquer
    // restartIceSession() dès que l'état de connexion se met à fluctuer.
    isRenegotiating = true;

    localStream.addTrack(videoTrack);
    peerConnection.addTrack(videoTrack, localStream);
    console.log(
      "📹 Transceivers après addTrack :",
      peerConnection
        .getTransceivers()
        .map((t) => `${t.mid}:${t.direction}`)
        .join(", "),
    );

    isVideoCall = true;

    const localVideo = document.getElementById("local-video");
    if (localVideo) localVideo.srcObject = localStream;
    showInterface(interfaceVideo);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log(
      "📹 Offre créée — contient m=video :",
      offer.sdp.includes("m=video"),
    );

    sendSignal({
      type: "restart-offer",
      targetId: targetUserId,
      offer: offer,
      isVideoUpgrade: true,
    });
    console.log("📹 Offre envoyée à :", targetUserId);

    updateStatus("Passage en appel vidéo...");
    // isRenegotiating repasse à false dans handleCallAnswered() quand la
    // réponse SDP de l'autre côté arrive (ou en cas d'erreur ci-dessous).
  } catch (error) {
    isRenegotiating = false;
    console.error("❌ Erreur passage en vidéo :", error);
  }
}

async function handleVideoUpgradeOffer(data) {
  if (!peerConnection) {
    console.log("⛔ handleVideoUpgradeOffer() ignoré — pas de peerConnection");
    return;
  }
  console.log(
    "📹 handleVideoUpgradeOffer() reçu — isVideoCall avant:",
    isVideoCall,
  );
  isRenegotiating = true;

  try {
    if (!isVideoCall) {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (videoTrack) {
        localStream.addTrack(videoTrack);
        peerConnection.addTrack(videoTrack, localStream);
        console.log(
          "📹 Track vidéo local (récepteur) ajouté :",
          videoTrack.label,
        );
      } else {
        console.error("❌ Aucune piste vidéo obtenue (récepteur)");
      }

      isVideoCall = true;

      const localVideo = document.getElementById("local-video");
      if (localVideo) localVideo.srcObject = localStream;
      showInterface(interfaceVideo);
    }

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.offer),
    );
    console.log(
      "📹 setRemoteDescription(offer) OK — transceivers :",
      peerConnection
        .getTransceivers()
        .map((t) => `${t.mid}:${t.direction}`)
        .join(", "),
    );
    await processPendingCandidates();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log(
      "📹 Réponse créée — contient m=video :",
      answer.sdp.includes("m=video"),
    );

    sendSignal({ type: "answer-call", targetId: targetUserId, answer: answer });
    console.log("📹 Réponse envoyée à :", targetUserId);

    updateStatus("Appel vidéo connecté");
  } catch (error) {
    console.error("❌ Erreur réception passage vidéo :", error);
  } finally {
    // Referme la garde côté récepteur une fois sa réponse SDP envoyée.
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

  updateStatus(isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...");
  showInterface(interfaceReceiver);
  startVibration();
}

async function handleCallOfferDetails(data) {
  console.log("📦 Offre SDP reçue du serveur pour :", data.callId);

  targetUserId = data.from;
  pendingOffer = data.offer;
  isVideoCall = data.isVideo === "true" || data.isVideo === true;

  // Si l'utilisateur avait cliqué sur "Accepter" depuis la notification native
  if (autoAcceptOnOffer && pendingOffer) {
    autoAcceptOnOffer = false;
    await acceptCall();
  }
}

async function acceptCall() {
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

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(pendingOffer),
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

    showInterface(isVideoCall ? interfaceVideo : interfaceSender);
    updateStatus("Appel connecté");
  } catch (error) {
    console.error("❌ Erreur acceptation appel :", error);
    hangUp(false);
  }
}

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

  // IMPORTANT : le routage se fait sur event.track.kind (fiable, propre à
  // la piste reçue), pas sur la variable globale isVideoCall — celle-ci
  // peut ne pas encore être à jour au moment précis où ontrack se déclenche
  // pendant un passage audio -> vidéo, ce qui envoyait la piste vidéo
  // distante vers l'élément audio caché.
  peerConnection.ontrack = async (event) => {
    console.log(
      "🔊/📹 ontrack déclenché — kind:",
      event.track.kind,
      "streams:",
      event.streams.length,
      "isVideoCall:",
      isVideoCall,
    );

    const stream =
      event.streams && event.streams[0]
        ? event.streams[0]
        : new MediaStream([event.track]);

    if (event.track.kind === "video") {
      console.log("📹 Piste VIDEO distante -> routage vers #remote-video");
      const remoteVideo = document.getElementById("remote-video");
      if (remoteVideo) {
        if (remoteVideo.srcObject !== stream) {
          remoteVideo.srcObject = stream;
          console.log("📹 srcObject assigné à remote-video");
        }
        try {
          await remoteVideo.play();
          console.log("✅ remote-video.play() OK");
        } catch (e) {
          console.error("❌ Erreur play remote-video :", e);
        }
      } else {
        console.error("❌ Élément #remote-video introuvable dans le DOM");
      }
    } else {
      console.log(
        "🔊 Piste AUDIO distante -> routage vers #remoteAudio/#remote-audio",
      );
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

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log(
      "🔗 État WebRTC :",
      state,
      "| isRestartingIce:",
      isRestartingIce,
      "| isRenegotiating:",
      isRenegotiating,
    );

    if (
      (state === "failed" || state === "disconnected") &&
      !isRestartingIce &&
      !isRenegotiating
    ) {
      console.log(
        "⚠️ Déclenchement restartIceSession() suite à l'état :",
        state,
      );
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
  isRenegotiating = false;

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
  console.log(
    "📲 Appel entrant natif :",
    callId,
    from,
    isVideo,
    "autoAnswer:",
    autoAnswer,
  );

  if (!appReady) {
    // onDeviceReady n'a pas fini (permissions/WS en cours) : on met
    // l'appel de côté, il sera traité dès que l'app sera prête.
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

  // Récupération défensive au cas où les variables globales n'auraient
  // pas encore été assignées pour une raison quelconque.
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
   option iterface appel
========================================================= */
// === Rendre la mini-vidéo locale déplaçable (façon WhatsApp) ===
// === Mini-vidéo déplaçable + tap pour échanger grand/petit écran ===
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

  // Un seul système d'événements : Pointer Events (souris + tactile unifiés, pas de doublon)
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
