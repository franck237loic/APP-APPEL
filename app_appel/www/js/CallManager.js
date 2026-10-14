/* =========================================================
   CallManager — une seule classe : HTML + CSS + WebRTC + UI
========================================================= */

class CallManager {
  static SIGNALING_SERVER_URL = 'wss://api.furthermarket.com:8088';
  // static SIGNALING_SERVER_URL = "wss://node-b44u.onrender.com";
  static HTTP_SERVER_URL = "https://api.furthermarket.com";
  static RECONNECT_DELAY = 5000;

  static RTC_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      {
        urls: [
          "turn:socialstatus.furthermarket.com:80?transport=udp",
          "turn:socialstatus.furthermarket.com:80?transport=tcp",
          "turn:socialstatus.furthermarket.com:443?transport=tcp",
          "turns:socialstatus.furthermarket.com:443?transport=tcp",
        ],
        username: "fmturn57",
        credential: "fmturn57",
      },
    ],
  };

  static ROUTE_LABELS = {
    earpiece: "Téléphone",
    speaker: "Haut-parleur",
    bluetooth: "Bluetooth",
  };

  static ROUTE_ICONS = {
    earpiece: "fa-solid fa-phone-volume",
    speaker: "fa-solid fa-volume-high",
    bluetooth: "fa-brands fa-bluetooth-b",
  };

  static get CSS() {
    return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}


/* STYLE DE CONSOLE */

#log-debug-box {
    position: fixed;
    bottom: 10px;
    left: 10px;
    right: 10px;
    max-height: 35vh;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.85);
    color: #0f0;
    font-size: 12px;
    font-family: monospace;
    padding: 8px;
    border-radius: 8px;
    z-index: 9999;
    white-space: pre-wrap;
    display: none;
}
#log-debug-box.show { display: block; }
#log-toggle-btn {
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 10000;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(17, 27, 33, 0.9);
    color: #0f0;
    border: 1px solid rgba(0, 255, 0, 0.4);
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}


/* Barre de sélection des interfaces */
.switcher-bar {
    background-color: #111b21;
    padding: 10px;
    display: flex;
    justify-content: center;
    gap: 10px;
    z-index: 100;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.switch-btn {
    background-color: #222d34;
    color: #8696a0;
    border: none;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}

.switch-btn.active {
    background-color: #00a884;
    color: #ffffff;
}

/* Modal Overlay fixe pour chaque vue */
.view-container {   
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(11, 20, 26, 0.95);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 999;
    padding: 0;
}

.view-container.active {
    display: flex;
}

/* Application Container */
.app-container {
    width: 100%;
    max-width: 480px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: max(20px, 4vh) 16px 20px 16px;
    background-color: #0b141a;
    color: #ffffff;
}

/* En-têtes */
.header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 5px;
    z-index: 10;
}

.icon-btn-top {
    flex: initial;
    background: none;
    border: none;
    color: #ffffff;
    font-size: 20px;
    cursor: pointer;
    padding: 8px;
}

.contact-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    flex-grow: 1;
}

.contact-name {
    font-size: clamp(16px, 4.5vw, 20px);
    font-weight: 500;
}

.encryption-status, .phone-number, .call-status {
    font-size: clamp(11px, 3vw, 13px);
    color: #8696a0;
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 2px;
}

/* Centre Avatar */
.center-avatar {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-grow: 1;
    width: 100%;
    padding: 20px 0;
}

.avatar-container {
    width: clamp(160px, 45vw, 240px);
    height: clamp(160px, 45vw, 240px);
    border-radius: 50%;
    overflow: hidden;
    background: linear-gradient(160deg, #2a3942, #1f2c33);
    display: flex;
    justify-content: center;
    align-items: center;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

/* Panels & Boutons d'Appel */
.control-panel {
    background-color: #111b21;
    width: 100%;
    border-radius: 28px;
    padding: clamp(20px, 4vh, 28px) 15px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: clamp(12px, 3vh, 20px) 10px;
    justify-items: center;
    align-items: center;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
}

.btn-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
}

.control-btn {
    flex: initial;
    background-color: #222d34;
    border: none;
    width: clamp(50px, 14vw, 64px);
    height: clamp(50px, 14vw, 64px);
    border-radius: 50%;
    color: #ffffff;
    font-size: clamp(18px, 5vw, 22px);
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.1s;
}

.control-btn:active {
    transform: scale(0.95);
}

.control-btn.hangup {
    background-color: #ea0038;
    color: #ffffff;
}

.btn-label {
    font-size: clamp(10px, 2.8vw, 12px);
    color: #8696a0;
    margin-top: 6px;
    text-align: center;
    width: 100%;
}

.incoming-actions {
    width: 100%;
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 10px 0;
}

.incoming-btn-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    position: relative;
}

.incoming-btn {
    border: none;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    color: #ffffff;
    font-size: 22px;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    box-shadow: 0 5px 15px rgba(0,0,0,0.3);
}

.incoming-btn.refuse {
    background-color: #ea0038;
}

.incoming-btn.accept {
    background-color: #00a884;
    position: relative;
    z-index: 5;
    touch-action: none; /* Empêche le défilement tactile pendant le swipe */
    transition: transform 0.3s ease;
}

.incoming-btn.accept:active {
    cursor: grabbing;
}

.incoming-btn.message {
    background-color: #222d34;
    color: #8696a0;
}

.incoming-label {
    font-size: 12px;
    color: #8696a0;
    text-align: center;
    max-width: 100px;
}

/* Flèches de swipe vers le haut */
.swipe-arrows {
    position: absolute;
    top: -55px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    pointer-events: none;
}

.swipe-arrows i {
    font-size: 13px;
    color: #00a884;
    opacity: 0;
    animation: slideUpArrows 1.5s infinite ease-in-out;
}

.swipe-arrows i:nth-child(1) { animation-delay: 0s; }
.swipe-arrows i:nth-child(2) { animation-delay: 0.3s; }
.swipe-arrows i:nth-child(3) { animation-delay: 0.6s; }

/* Animations */
@keyframes slideUpArrows {
    0% { transform: translateY(12px); opacity: 0; }
    50% { opacity: 1; }
    100% { transform: translateY(-12px); opacity: 0; }
}

@keyframes vibrate {
    0% { transform: translate(0, 0) rotate(0deg); }
    20% { transform: translate(-3px, 2px) rotate(-1deg); }
    40% { transform: translate(3px, -2px) rotate(1deg); }
    60% { transform: translate(-2px, -2px) rotate(0deg); }
    80% { transform: translate(2px, 3px) rotate(1deg); }
    100% { transform: translate(0, 0) rotate(0deg); }
}

.vibrating {
    animation: vibrate 0.3s infinite ease-in-out;
}

/* =========================================================
   INTERFACE 3 : APPEL VIDEO
========================================================= */
/* =========================================================
   INTERFACE APPEL VIDEO
========================================================= */

.video-call-view {
    background: #000;
    padding: 0;
    z-index: 2000;
}

.video-call-container {
    position: relative;
    width: 100%;
    height: 100%;
    max-width: 900px;
    background: #000;
    overflow: hidden;
}


/* =========================================================
   VIDEO DISTANTE
========================================================= */

.remote-video {
    position: absolute;
    inset: 0;

    width: 100%;
    height: 100%;

    object-fit: cover;

    background: #111;

    z-index: 1;
}


/* =========================================================
   PLACEHOLDER VIDEO DISTANTE
========================================================= */

.remote-video-placeholder {
    position: absolute;
    inset: 0;

    z-index: 2;

    display: flex;
    flex-direction: column;

    justify-content: center;
    align-items: center;

    background:
        radial-gradient(
            circle at center,
            #26343d 0%,
            #111b21 45%,
            #05090c 100%
        );

    color: white;
}

.remote-video-placeholder.hidden {
    display: none;
}

.video-avatar {
    width: 140px;
    height: 140px;

    border-radius: 50%;

    background: linear-gradient(
        145deg,
        #354650,
        #1f2c33
    );

    display: flex;
    justify-content: center;
    align-items: center;

    box-shadow:
        0 10px 40px rgba(0, 0, 0, .5);
}

.video-avatar span {
    font-size: 60px;
    font-weight: 600;
    color: #d8e0e4;
}

.video-contact-name {
    margin-top: 25px;

    font-size: 22px;
    font-weight: 500;
}

.video-call-status {
    margin-top: 8px;

    color: #aebbc2;
    font-size: 14px;
}


/* =========================================================
   HEADER
========================================================= */

.video-header {
    position: absolute;

    top: 0;
    left: 0;
    right: 0;

    z-index: 10;

    display: flex;
    align-items: center;

    padding: 18px 15px 35px;

    background: linear-gradient(
        to bottom,
        rgba(0, 0, 0, .75),
        transparent
    );
}

.video-header-btn {
    width: 42px;
    height: 42px;

    flex: none;

    border: none;
    border-radius: 50%;

    background: rgba(0, 0, 0, .4);

    color: white;

    display: flex;
    align-items: center;
    justify-content: center;

    font-size: 18px;

    cursor: pointer;
}

.video-header-info {
    margin-left: 12px;
}

.video-header-name {
    color: white;

    font-size: 17px;
    font-weight: 600;
}

.video-header-status {
    margin-top: 3px;

    color: #d2d9dd;

    font-size: 12px;
}


/* =========================================================
   MA VIDEO
========================================================= */

.local-video-wrapper {
    position: absolute;

    top: 75px;
    right: 15px;

    width: clamp(110px, 28vw, 180px);
    height: clamp(150px, 35vw, 240px);

    z-index: 20;

    border-radius: 15px;

    overflow: hidden;

    background: #1a242a;

    border: 2px solid rgba(255,255,255,.8);

    box-shadow:
        0 5px 20px rgba(0,0,0,.5);
}

.local-video {
    width: 100%;
    height: 100%;

    object-fit: cover;

    background: #111;
}

.local-video-placeholder {
    position: absolute;

    inset: 0;

    display: none;

    align-items: center;
    justify-content: center;

    background: #26343d;

    color: #d5dde1;

    font-size: 35px;
}

.local-video-placeholder.active {
    display: flex;
}


/* =========================================================
   INFORMATIONS APPEL
========================================================= */

.video-call-info {
    position: absolute;

    top: 125px;
    left: 0;
    right: 0;

    z-index: 5;

    text-align: center;

    pointer-events: none;
}

#video-timer {
    display: inline-block;

    padding: 6px 12px;

    border-radius: 15px;

    background: rgba(0,0,0,.45);

    color: white;

    font-size: 13px;
}


/* =========================================================
   PANNEAU DE CONTROLE
========================================================= */

.video-control-panel {
    position: absolute;

    left: 50%;
    bottom: 20px;

    transform: translateX(-50%);

    z-index: 30;

    width: calc(100% - 25px);

    max-width: 560px;

    padding: 15px 10px;

    border-radius: 28px;

    background: rgba(17,27,33,.92);

    backdrop-filter: blur(12px);

    display: grid;

    grid-template-columns:
        repeat(3, 1fr);

    gap: 15px 8px;

    justify-items: center;

    box-shadow:
        0 10px 35px rgba(0,0,0,.5);
}

.video-control-wrapper {
    display: flex;

    flex-direction: column;

    align-items: center;

    gap: 5px;
}

.video-control-wrapper span {
    color: #c6d0d5;

    font-size: 10px;

    text-align: center;
}

.video-control-btn {
    width: 52px;
    height: 52px;

    border: none;

    border-radius: 50%;

    background: #26343b;

    color: white;

    display: flex;

    align-items: center;
    justify-content: center;

    font-size: 19px;

    cursor: pointer;

    transition:
        transform .15s,
        background-color .2s;
}

.video-control-btn:active {
    transform: scale(.92);
}

.video-control-btn.active {
    background: #00a884;
}

.video-control-btn.disabled {
    background: #59666d;
}

.video-hangup {
    background: #ea0038;
}

.video-hangup:hover {
    background: #ff174f;
}


/* =========================================================
   MODE PAYSAGE
========================================================= */

@media (orientation: landscape) {

    .local-video-wrapper {
        top: 70px;
        right: 18px;

        width: 150px;
        height: 100px;
    }

    .video-control-panel {
        bottom: 10px;

        grid-template-columns:
            repeat(6, 1fr);

        max-width: 650px;

        padding: 10px;
    }

    .video-control-btn {
        width: 48px;
        height: 48px;
    }

    .video-call-info {
        top: 75px;
    }
}


/* =========================================================
   PETITS ECRANS
========================================================= */

@media (max-width: 380px) {

    .local-video-wrapper {
        width: 105px;
        height: 145px;

        top: 70px;
        right: 10px;
    }

    .video-control-panel {
        gap: 10px 4px;
        padding: 12px 6px;
    }

    .video-control-btn {
        width: 46px;
        height: 46px;

        font-size: 17px;
    }

    .video-control-wrapper span {
        font-size: 9px;
    }

    .video-avatar {
        width: 110px;
        height: 110px;
    }

    .video-avatar span {
        font-size: 48px;
    }
}

html, body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0b141a;
    color: #ffffff;
}
button, [role="button"] { cursor: pointer; }
.remote-status-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    margin-top: 6px;
}
.remote-status-badge {
    display: none;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(234, 0, 56, 0.18);
    color: #ff8da3;
    font-size: 11px;
    font-weight: 600;
}
.remote-status-badge.show { display: inline-flex; }
#call-toast {
    position: fixed;
    left: 50%;
    bottom: 110px;
    transform: translateX(-50%) translateY(12px);
    z-index: 4000;
    padding: 10px 16px;
    border-radius: 999px;
    background: rgba(17, 27, 33, 0.94);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
}
#call-toast.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}
.control-btn.active-mute,
.video-control-btn.active-mute { background-color: #ea0038; }
.control-btn:disabled,
.video-control-btn:disabled { opacity: 0.45; pointer-events: none; }
.audio-route-menu {
    display: none;
    position: absolute;
    bottom: 86px;
    left: 50%;
    transform: translateX(-50%);
    min-width: 180px;
    background: #111b21;
    border-radius: 16px;
    padding: 8px;
    z-index: 40;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4);
}
.audio-route-menu.open { display: block; }
.audio-route-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    color: #fff;
    border-radius: 12px;
}
.audio-route-item.active { background: #00a884; }
`;
  }

  static get HTML() {
    return `<div class="container" id="call-manager-root">
  <audio id="remoteAudio" autoplay playsinline webkit-playsinline></audio>
  <audio id="remote-audio" autoplay playsinline webkit-playsinline></audio>
  <div id="call-toast"></div>

  <button id="log-toggle-btn" type="button" onclick="toggleScreenLog()" aria-label="Logs">🐞</button>
  <div id="log-debug-box"></div>

  <div id="interface-1" class="view-container">
    <div class="app-container">
      <div class="header">
        <button class="icon-btn-top" type="button" onclick="closeInterface()" aria-label="Retour">
          <i class="fa-solid fa-arrow-left"></i>
        </button>
        <div class="contact-info">
          <span class="contact-name js-contact-name">Junior</span>
          <div class="status-bar">Hors ligne</div>
          <div class="remote-status-badge js-remote-mute-badge">
            <i class="fa-solid fa-microphone-slash"></i> Micro coupé
          </div>
        </div>
        <button class="icon-btn-top" type="button" aria-label="Ajouter">
          <i class="fa-solid fa-user-plus"></i>
        </button>
      </div>
      <div class="center" id="timer">00:00:00</div>
      <div class="center-avatar">
        <div class="avatar-container">
          <span class="js-contact-initial" style="font-size: 80px; color: #8696a0; font-weight: 600">J</span>
        </div>
      </div>
      <div class="control-panel">
        <div class="btn-wrapper">
          <button class="control-btn" type="button" onclick="toggleAudioRouteMenu()">
            <i class="fa-brands fa-bluetooth-b" id="audio-route-icon"></i>
          </button>
          <span class="btn-label">Audio</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn" type="button" onclick="upgradeToVideo()">
            <i class="fa-solid fa-video"></i>
          </button>
          <span class="btn-label">Vidéo</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn js-mic-btn" type="button" onclick="toggleMicrophone()" aria-label="Micro">
            <i class="fa-solid fa-microphone js-mic-icon"></i>
          </button>
          <span class="btn-label js-mic-label">Désactiver le micro</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn" type="button">
            <i class="fa-solid fa-ellipsis"></i>
          </button>
          <span class="btn-label">Plus</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn" type="button">
            <i class="fa-solid fa-arrow-up-from-bracket"></i>
          </button>
          <span class="btn-label">Partager</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn hangup" type="button" onclick="hangUp()">
            <i class="fa-solid fa-phone-slash"></i>
          </button>
          <span class="btn-label">Terminer</span>
        </div>
      </div>
      <div id="audio-route-menu" class="audio-route-menu"></div>
    </div>
  </div>

  <div id="interface-2" class="view-container">
    <div class="app-container">
      <div class="header" style="justify-content: center">
        <div class="contact-info">
          <span class="contact-name js-contact-name">Junior</span>
          <div class="status-bar">Hors ligne</div>
        </div>
      </div>
      <div class="center-avatar">
        <div class="avatar-container">
          <span class="js-contact-initial" style="font-size: 80px; color: #8696a0; font-weight: 600">J</span>
        </div>
      </div>
      <div class="incoming-actions">
        <div class="incoming-btn-wrapper">
          <button class="incoming-btn refuse" type="button" onclick="rejectCall()">
            <i class="fa-solid fa-phone-slash"></i>
          </button>
          <span class="incoming-label">Refuser</span>
        </div>
        <div class="incoming-btn-wrapper">
          <div class="swipe-arrows">
            <i class="fa-solid fa-chevron-up"></i>
            <i class="fa-solid fa-chevron-up"></i>
            <i class="fa-solid fa-chevron-up"></i>
          </div>
          <button class="incoming-btn accept" type="button" id="swipeAcceptBtn">
            <i class="fa-solid fa-phone"></i>
          </button>
          <span class="incoming-label">Balayer vers le haut pour accepter</span>
        </div>
        <div class="incoming-btn-wrapper">
          <button class="incoming-btn message" type="button">
            <i class="fa-solid fa-message"></i>
          </button>
          <span class="incoming-label">Message</span>
        </div>
      </div>
    </div>
  </div>

  <div id="interface-3" class="view-container video-call-view">
    <div class="video-call-container">
      <video id="remote-video" class="remote-video" autoplay playsinline webkit-playsinline muted disablePictureInPicture disableRemotePlayback controlsList="nofullscreen nodownload noremoteplayback noplaybackrate"></video>
      <div class="video-header">
        <div class="video-header-info">
          <div class="video-header-name js-contact-name">Junior</div>
          <div class="video-header-status status-bar">Connexion...</div>
          <div class="remote-status-row">
            <span class="remote-status-badge js-remote-mute-badge"><i class="fa-solid fa-microphone-slash"></i> Micro coupé</span>
            <span class="remote-status-badge js-remote-camera-badge"><i class="fa-solid fa-video-slash"></i> Caméra coupée</span>
          </div>
        </div>
      </div>
      <div class="video-call-info">
        <span id="timer-video">00:00:00</span>
      </div>
      <div class="local-video-wrapper">
        <video id="local-video" class="local-video" autoplay playsinline webkit-playsinline muted disablePictureInPicture disableRemotePlayback controlsList="nofullscreen nodownload noremoteplayback noplaybackrate"></video>
        <div id="local-video-placeholder" class="local-video-placeholder">
          <i class="fa-solid fa-video-slash"></i>
        </div>
      </div>
      <div class="video-control-panel">
        <div class="video-control-wrapper">
          <button class="video-control-btn" type="button" id="btn-toggle-camera" onclick="toggleCamera()">
            <i class="fa-solid fa-video" id="camera-icon"></i>
          </button>
          <span>Caméra</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn" type="button" id="btn-switch-camera" onclick="switchCamera()" aria-label="Changer de caméra">
            <i class="fa-solid fa-camera-rotate"></i>
          </button>
          <span>Retourner</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn" type="button" id="btn-toggle-speaker" onclick="toggleSpeaker()">
            <i class="fa-solid fa-volume-high" id="speaker-icon"></i>
          </button>
          <span>Haut-parleur</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn js-mic-btn" type="button" id="btn-toggle-mic" onclick="toggleMicrophone()" aria-label="Micro">
            <i class="fa-solid fa-microphone js-mic-icon"></i>
          </button>
          <span class="js-mic-label" data-label-on="Micro" data-label-muted="Muet">Micro</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn video-hangup" type="button" onclick="hangUp(true)">
            <i class="fa-solid fa-phone-slash"></i>
          </button>
          <span>Terminer</span>
        </div>
      </div>
    </div>
  </div>
</div>`;
  }

  constructor() {
    this.myId = null;
    this.targetUserId = null;
    // Référence de connexion cordova-plugin-advanced-websocket (remplace
    // l'ancien objet natif WebSocket de cordova-plugin-websocket). Le plugin
    // n'exposant pas de .readyState, on le suit nous-mêmes dans wsReadyState
    // en réutilisant les constantes standard WebSocket.OPEN/CONNECTING/CLOSED
    // (toujours disponibles nativement dans la WebView, indépendamment du plugin).
    this.wsId = null;
    this.wsReadyState = WebSocket.CLOSED;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.manuallyClosed = false;
    this.deviceToken = null;
    this.voipToken = null;
    this.push = null;
    this.peerConnection = null;
    this.localStream = null;
    this.pendingCandidates = [];
    this.pendingOffer = null;
    this.currentCallId = null;
    this.currentNotId = null;
    this.autoAcceptOnOffer = false;
    this.activeRTC = null;
    this.isMuted = false;
    this.isRestartingIce = false;
    this.timerInterval = null;
    this.vibrationTimer = null;
    this.isVibrating = false;
    this.isVideoCall = false;
    this.isCameraOff = false;
    this.isFrontCamera = true;
    this.isSwitchingCamera = false;
    this.isSpeakerOn = true;
    this.isRenegotiating = false;
    this.appReady = false;
    this.pendingNativeCall = null;
    this.callToastTimer = null;
    this.currentAudioRoute = "earpiece";

    this.mountUI();
    this.interfaceReceiver = document.getElementById("interface-2");
    this.interfaceSender = document.getElementById("interface-1");
    this.interfaceVideo = document.getElementById("interface-3");

    document.addEventListener("deviceready", this.onDeviceReady, false);

    // Écran noir au retour au premier plan (écran verrouillé/déverrouillé pendant un appel) :
    // le WebView Android peut garder une frame vidéo figée (surface matérielle) tant qu'aucun
    // repaint n'est forcé après une pause. On force ce repaint + on relance la lecture des
    // <video> dès la reprise de l'app.
    document.addEventListener("resume", this.onAppResume, false);

    // iOS : initialisation spécifique (iosrtc)
    document.addEventListener(
      "deviceready",
      () => {
        // iOS: Configuration iosrtc
        if (this.isIOS() && cordova.plugins && cordova.plugins.iosrtc) {
          cordova.plugins.iosrtc.registerGlobals();
          console.log("✅ [iOS] iosrtc activé - WebRTC natif iOS");
        } else if (this.isIOS()) {
          console.error("❌ [iOS] iosrtc non disponible");
        }
      },
      false,
    );

    // Active le glisser-déposer de la mini-vidéo locale (appel vidéo)
    this.setupDraggableVideo();
  }

  /* =========================================================
     HTML + CSS : montés par la classe
  ========================================================= */

  mountUI = () => {
    this.ensureFontAwesome();
    this.injectStyles();
    this.injectMarkup();
    this.bindIncomingSwipe();
  };

  ensureFontAwesome = () => {
    if (document.getElementById("call-manager-fa")) return;
    const link = document.createElement("link");
    link.id = "call-manager-fa";
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";
    document.head.appendChild(link);
  };

  injectStyles = () => {
    if (document.getElementById("call-manager-styles")) return;
    const style = document.createElement("style");
    style.id = "call-manager-styles";
    style.textContent = CallManager.CSS;
    document.head.appendChild(style);
  };

  injectMarkup = () => {
    if (document.getElementById("call-manager-root") || document.getElementById("interface-2")) {
      if (!document.getElementById("call-toast")) {
        const toast = document.createElement("div");
        toast.id = "call-toast";
        document.body.appendChild(toast);
      }
      this.injectLogPanel();
      return;
    }
    const host = document.createElement("div");
    host.innerHTML = CallManager.HTML;
    document.body.appendChild(host.firstElementChild);
    this.injectLogPanel();
  };

  // Ajoute le bouton 🐞 + le panneau de logs indépendamment du reste du
  // markup (utile si l'HTML de la page est statique et que injectMarkup
  // s'arrête plus haut avant d'insérer CallManager.HTML).
  injectLogPanel = () => {
    if (!document.getElementById("log-toggle-btn")) {
      const btn = document.createElement("button");
      btn.id = "log-toggle-btn";
      btn.type = "button";
      btn.setAttribute("aria-label", "Logs");
      btn.textContent = "🐞";
      btn.onclick = () => this.toggleScreenLog();
      document.body.appendChild(btn);
    }
    if (!document.getElementById("log-debug-box")) {
      const box = document.createElement("div");
      box.id = "log-debug-box";
      document.body.appendChild(box);
    }
    this.setupConsoleCapture();
  };

  setContactName = (name) => {
    const label = name || "Junior";
    document.querySelectorAll(".js-contact-name").forEach((el) => {
      el.textContent = label;
    });
    const initial = label.trim().charAt(0).toUpperCase() || "J";
    document.querySelectorAll(".js-contact-initial").forEach((el) => {
      el.textContent = initial;
    });
  };

  bindIncomingSwipe = () => {
    const acceptBtn = document.getElementById("swipeAcceptBtn");
    if (!acceptBtn || acceptBtn.dataset.swipeBound === "1") return;
    acceptBtn.dataset.swipeBound = "1";

    // Animation visuelle uniquement (swipe) — une seule porte d'entrée réelle :
    // le click. Sur WebView Android, un touchend synthétise souvent un click
    // juste après ; si endDrag appelait aussi acceptCall(), on décrochait 2x
    // → 2e answer-call → setRemoteDescription échoue côté appelant → hangUp.
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    const threshold = -80;

    const startDrag = (y) => {
      isDragging = true;
      startY = y;
      acceptBtn.style.transition = "none";
    };
    const moveDrag = (y) => {
      if (!isDragging) return;
      currentY = y - startY;
      if (currentY > 10) currentY = 10;
      if (currentY < -150) currentY = -150;
      acceptBtn.style.transform = "translateY(" + currentY + "px)";
    };
    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      acceptBtn.style.transition = "transform 0.3s ease";
      acceptBtn.style.transform = "translateY(0px)";
      // Si le seuil est atteint, on déclenche un click programmatique unique
      // (évite le double acceptCall swipe + click synthétique).
      if (currentY <= threshold) {
        acceptBtn.click();
      }
      currentY = 0;
    };

    acceptBtn.addEventListener("touchstart", (e) => startDrag(e.touches[0].clientY), { passive: true });
    window.addEventListener("touchmove", (e) => { if (isDragging) moveDrag(e.touches[0].clientY); }, { passive: true });
    window.addEventListener("touchend", endDrag);
    // Pas de listeners mouse : inutiles sur mobile et source de doublons.

    acceptBtn.addEventListener("click", (e) => {
      e.preventDefault();
      this.acceptCall();
    });
  };


  getPlatform = () => {
    if (!window.cordova) return "web";
    return cordova.platformId || "web";
  };

  isIOS = () => {
    return this.getPlatform() === "ios";
  };

  isAndroid = () => {
    return this.getPlatform() === "android";
  };

  /* =========================================================
   INITIALISATION ET AUTORISATIONS
========================================================= */

  onDeviceReady = async () => {
    console.log("🚀 Initialisation de l'application WebRTC...");
    console.log("📱 Plateforme détectée:", this.getPlatform());
    console.log("🔍 isIOS():", this.isIOS());
    console.log("🔍 isAndroid():", this.isAndroid());

    try {
      // Permissions communes
      await this.requestMicrophonePermission();
      await this.requestCameraPermission();

      // Permissions spécifiques Android
      if (this.isAndroid()) {
        await this.requestBluetoothPermission();
        await this.requestNotificationPermission();
      }

      // Permissions spécifiques iOS
      if (this.isIOS()) {
        await this.ensureMediaAuthorizedIOS();
      }

      // Identifiant local + push (comme index1.js). Sur certaines builds Cordova
      // l'ID / le token peuvent être fournis par le native — on initialise quand même
      // si myId n'est pas déjà défini.
      if (!this.myId) this.initializeUserId();
      this.initPushNotifications();

      const idElement = document.getElementById("my-id-display");
      if (idElement) idElement.innerText = this.myId;

      await this.connectWebSocket();

      this.appReady = true;
      if (this.pendingNativeCall) {
        const call = this.pendingNativeCall;
        this.pendingNativeCall = null;
        this.processIncomingCall(
          call.callId,
          call.from,
          call.isVideo,
          call.autoAnswer,
        );
      }
    } catch (error) {
      console.error("❌ Erreur au démarrage :", error);
      this.updateStatus("Erreur d'initialisation");
    }
  };

  // Appelé à chaque retour au premier plan (déverrouillage de l'écran, retour depuis une
  // autre app...). Corrige le "écran noir au raccrochage quand l'écran était éteint" : sans
  // repaint forcé, le WebView Android peut rester figé sur la dernière frame vidéo (surface
  // matérielle) même après que le DOM a été correctement nettoyé côté JS.
  onAppResume = () => {
    console.log("🔄 onAppResume() — repaint forcé du WebView");

    // 1) Relancer la lecture des <video> encore actives (cas : appel toujours en cours)
    ["local-video", "remote-video"].forEach((id) => {
      const v = document.getElementById(id);
      if (v && v.srcObject) {
        v.play().catch((e) => console.warn("⚠️ re-play vidéo au resume :", e));
      }
    });

    // 2) Forcer un reflow/repaint complet (contourne la frame figée noire)
    requestAnimationFrame(() => {
      document.body.style.display = "none";
      // Lire une propriété layout force le navigateur à appliquer le changement
      // avant de le défaire — sans ce "void", le double changement de style
      // pourrait être fusionné/ignoré par le moteur de rendu.
      void document.body.offsetHeight;
      document.body.style.display = "";
    });

    // 3) Le reset du hardware layer côté natif (MainActivity.onResume()) se déclenche
    // automatiquement via le cycle de vie de l'Activity Android — rien à appeler ici.
  };

  // Permissions Android
  requestCameraPermission = () => {
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
  };

  requestNotificationPermission = () => {
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
  };

  requestMicrophonePermission = () => {
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
  };

  requestBluetoothPermission = () => {
    return new Promise((resolve) => {
      if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        const perm =
          permissions.BLUETOOTH_CONNECT ||
          "android.permission.BLUETOOTH_CONNECT";
        permissions.requestPermission(
          perm,
          () => resolve(),
          () => resolve(),
        );
      } else {
        resolve();
      }
    });
  };

  // Permissions iOS spécifiques
  waitForAppActive = () => {
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
  };

  ensureMediaAuthorizedIOS = () => {
    if (
      !this.isIOS() ||
      !(window.cordova && cordova.plugins && cordova.plugins.diagnostic)
    ) {
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

            console.log(
              `⏳ [iOS] ${label} jamais demandé, attente du premier plan...`,
            );
            await this.waitForAppActive();

            requestAuth(
              (newStatus) => {
                console.log(`✅ [iOS] ${label} ->`, newStatus);
                resolve();
              },
              (error) => {
                console.warn(`⚠️ [iOS] Erreur demande ${label} :`, error);
                resolve();
              },
            );
          },
          (error) => {
            console.warn(`⚠️ [iOS] Erreur lecture statut ${label} :`, error);
            resolve();
          },
        );
      });
    }

    return Promise.all([
      ensureAuthorized(
        diagnostic.getMicrophoneAuthorizationStatus,
        diagnostic.requestMicrophoneAuthorization,
        "microphone",
      ),
      ensureAuthorized(
        diagnostic.getCameraAuthorizationStatus,
        diagnostic.requestCameraAuthorization,
        "caméra",
      ),
    ]);
  };

  initializeUserId = () => {
    this.myId = localStorage.getItem("app_user_id");
    if (!this.myId) {
      this.myId = "ID-" + Math.floor(100000 + Math.random() * 900000);
      localStorage.setItem("app_user_id", this.myId);
    }
    console.log("👤 Mon ID local :", this.myId);
  };

  /* =========================================================
   GESTION PUSH NOTIFICATIONS
========================================================= */

  initPushNotifications = () => {
    console.log("🔔 ===== INITIALISATION PUSH =====");

    if (typeof PushNotification === "undefined") {
      console.error("❌ PushNotification est undefined");
      return;
    }

    try {
      this.push = PushNotification.init({
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

      // ✅ FIX CRITIQUE : arrow functions pour conserver this → CallManager
      this.push.on("registration", (data) => {
        console.log("✅ ENREGISTREMENT PUSH RÉUSSI :", data.registrationId);
        this.deviceToken = data.registrationId;

        if (this.wsReadyState === WebSocket.OPEN) {
          this.sendSignal({
            action: "register-push-token",
            userId: this.myId,
            pushToken: this.deviceToken,
          });
        }
      });

      // Action: Accepter depuis notification
      this.push.on("accept", async (data) => {
        console.log("📞 ACCEPTER DEPUIS PUSH");
        const additionalData = data.additionalData || {};

        this.extractPushData(additionalData);
        this.autoAcceptOnOffer = true;

        if (this.peerConnection) {
          console.log("Appel déjà en cours, acceptation ignorée");
          return;
        }
        this.showInterface(
          this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
        );
        this.updateStatus("Connexion à l'appel...");

        await this.ensureConnectedAndFetchOffer();
      });

      // Action: Refuser
      this.push.on("reject", async (data) => {
        console.log("📵 REFUSER APPEL");
        const additionalData = data.additionalData || {};

        this.extractPushData(additionalData);

        await this.ensureSocketReady();
        this.rejectCall();

        if (this.push && additionalData.notId) {
          this.push.finish(() =>
            console.log("✅ Notification refusée terminée"),
          );
        }
      });

      // Action: Clic sur notification
      this.push.on("notification", async (data) => {
        console.log("🔔 Notification cliquée :", JSON.stringify(data));
        const additionalData = data.additionalData || {};

        if (additionalData.type === "incoming-call") {
          this.extractPushData(additionalData);
          this.autoAcceptOnOffer = false;

          this.showInterface(this.interfaceReceiver);
          this.updateStatus(
            this.isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...",
          );
          this.startVibration();

          await this.ensureConnectedAndFetchOffer();
        }

        this.push.finish(() => console.log("✅ Notification terminée"));
      });

      this.push.on("error", (error) =>
        console.error("❌ ERREUR PUSH :", error),
      );
    } catch (error) {
      console.error("❌ Exception Push :", error);
    }
  };

  extractPushData = (data) => {
    if (data.callerId) this.targetUserId = data.callerId;
    if (data.callId) {
      this.currentCallId = data.callId;
      localStorage.setItem("pending_call_id", data.callId);
    }
    if (data.isVideo !== undefined) {
      this.isVideoCall = data.isVideo === "true" || data.isVideo === true;
    }
    if (data.notId) this.currentNotId = data.notId;
  };

  ensureConnectedAndFetchOffer = async () => {
    if (!this.currentCallId) {
      this.currentCallId = localStorage.getItem("pending_call_id");
    }

    await this.ensureSocketReady();

    if (this.currentCallId) {
      console.log(
        "📩 Demande de l'offre SDP pour callId :",
        this.currentCallId,
      );
      this.sendSignal({
        type: "get-offer",
        callId: this.currentCallId,
      });
    }
  };

  ensureSocketReady = () => {
    return new Promise((resolve) => {
      const enregistrerEtValider = () => {
        this.sendRegistration();
        if (this.isIOS() && this.voipToken) {
          this.sendSignal({
            type: "register-voip-token",
            userId: this.myId,
            voipToken: this.voipToken,
          });
        }
        setTimeout(resolve, 400);
      };

      if (this.wsReadyState === WebSocket.OPEN) {
        enregistrerEtValider();
        return;
      }

      this.connectWebSocket().then(() => {
        let settled = false;
        const checkInterval = setInterval(() => {
          if (this.wsReadyState === WebSocket.OPEN) {
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
  };

  /* =========================================================
   SIGNALISATION WEBSOCKET
========================================================= */

  connectWebSocket = async () => {
    if (
      this.wsReadyState === WebSocket.OPEN ||
      this.wsReadyState === WebSocket.CONNECTING
    ) {
      return;
    }

    this.manuallyClosed = false;
    this.updateStatus("Connexion au serveur...");

    try {
      await fetch(CallManager.HTTP_SERVER_URL, { method: "GET", cache: "no-cache" });
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
      this.createWebSocket(settleOnce);
    });
  };

  createWebSocket = (onSettle) => {
    if (this.wsId != null) {
      try {
        CordovaWebsocketPlugin.wsClose(this.wsId, 1000, "Reconnecting");
      } catch (e) {}
      this.wsId = null;
    }
    this.wsReadyState = WebSocket.CONNECTING;

    const wsOptions = {
      url: CallManager.SIGNALING_SERVER_URL,
      // Ping/pong au niveau protocole (OkHttp/SocketRocket) pour détecter une
      // connexion morte même quand aucune frame de fermeture n'est reçue —
      // en plus du ping/pong applicatif JSON déjà géré par handleSignalMessage.
      pingInterval: 30000,
    };

    // receiveCallback : appelé pour chaque message reçu, et aussi à la
    // fermeture/échec de la connexion (différencié par callbackMethod).
    const onReceive = (recvEvent) => {
      switch (recvEvent.callbackMethod) {
        case "onMessage":
          this.handleSignalMessage(recvEvent.message);
          break;

        case "onClose":
          console.log(
            "🔌 WebSocket fermé :",
            recvEvent.reason || recvEvent.exception || recvEvent.code,
          );
          this.stopHeartbeat();
          this.wsId = null;
          this.wsReadyState = WebSocket.CLOSED;
          if (!this.manuallyClosed) {
            this.updateStatus("Hors ligne");
            this.scheduleReconnect();
          }
          break;

        case "onFail":
          console.error(
            "❌ Erreur WebSocket :",
            recvEvent.exception || recvEvent.reason,
          );
          this.updateStatus("Erreur réseau WebSocket");
          this.stopHeartbeat();
          this.wsId = null;
          this.wsReadyState = WebSocket.CLOSED;
          if (!this.manuallyClosed) {
            this.scheduleReconnect();
          }
          break;
      }
    };

    // successCallback : connexion établie
    const onSuccess = (success) => {
      console.log("✅ WebSocket Connecté");
      this.wsId = success.webSocketId;

      // Le serveur coupe la connexion après ~30 s d'inactivité → ping JSON
      // toutes les 20 s.
      this.startHeartbeat();
      this.sendRegistration();

      if (this.isIOS() && this.voipToken) {
        this.sendSignal({
          type: "register-voip-token",
          userId: this.myId,
          voipToken: this.voipToken,
        });
      }
      if (typeof onSettle === "function") onSettle();
    };

    // failureCallback : échec de la connexion initiale
    const onFailure = (error) => {
      console.error("❌ Erreur création WebSocket :", error);
      this.stopHeartbeat();
      this.wsId = null;
      this.wsReadyState = WebSocket.CLOSED;
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
      if (typeof onSettle === "function") onSettle();
    };

    try {
      CordovaWebsocketPlugin.wsConnect(wsOptions, onReceive, onSuccess, onFailure);
    } catch (error) {
      onFailure(error);
    }
  };

  // ---
  sendRegistration = () => {
    let sessionKey = window.localStorage.getItem("mySessionKey");
    let userId = window.localStorage.getItem("myUserID");
    let holderName = window.localStorage.getItem("myHoldername");

    if (!sessionKey) {
      sessionKey =
        "sess-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.localStorage.setItem("mySessionKey", sessionKey);
    }
    if (!userId) {
      userId = this.myId;
      window.localStorage.setItem("myUserID", userId);
    }
    if (!holderName) {
      holderName = this.myId;
      window.localStorage.setItem("myHoldername", holderName);
    }

    console.log("📝 Inscription :", { sessionKey, userId, holderName });
    if (this.wsId != null) {
      CordovaWebsocketPlugin.wsSend(
        this.wsId,
        JSON.stringify({
          action: "registration",
          SessionID: sessionKey,
          UserID: userId,
          SocketID: "0",
          Username: holderName,
        }),
      );
    }
  };

  startHeartbeat = () => {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.wsId != null) {
        CordovaWebsocketPlugin.wsSend(
          this.wsId,
          JSON.stringify({ action: "ping" }),
        );
      }
    }, 20000);
  };

  stopHeartbeat = () => {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  };

  handleRegistered = (data) => {
    const status = (data && data.status) || "";
    if (status.startsWith("failed")) {
      console.error("❌ Inscription refusée par le serveur :", data);
      this.updateStatus("Inscription refusée par le serveur");
      return;
    }
    this.wsReadyState = WebSocket.OPEN;
    this.updateStatus("En ligne");
    console.log("✅ Inscription acceptée :", data);
  };

  // Traite un message JSON reçu du serveur de signalisation (extrait de
  // createWebSocket pour être appelable depuis le receiveCallback du plugin).
  handleSignalMessage = (rawMessage) => {
    let data;
    try {
      data = JSON.parse(rawMessage);
    } catch (e) {
      return;
    }

    const action = data.action || data.type;

    if (action === "ping") {
      this.sendSignal(data.action ? { action: "pong" } : { type: "pong" });
      console.log("🏓 Pong envoyé");
      return;
    }

    console.log("📦 Signal reçu :", action);

    switch (action) {
      case "registered":
        this.handleRegistered(data);
        break;

      case "incoming-call":
        this.handleIncomingCall(data);
        break;

      case "call-offer-details":
        this.handleCallOfferDetails(data);
        break;

      case "call-expired":
        alert("L'appel a expiré ou a été annulé.");
        this.hangUp(false);
        break;

      case "restart-offer":
        if (data.isVideoUpgrade) {
          this.handleVideoUpgradeOffer(data);
        } else {
          this.handleRestartOffer(data);
        }
        break;

      case "call-answered":
        this.handleCallAnswered(data);
        break;

      case "ice-candidate":
        this.handleNewICECandidate(data);
        break;

      case "peer-mic-state":
        this.handleRemoteMicState(data);
        break;

      case "peer-camera-state":
        this.handleRemoteCameraState(data);
        break;

      case "call-refused":
      case "call-end":
        this.hangUp(false);
        break;

      case "video-upgrade-offer":
        this.handleVideoUpgradeOffer(data);
        break;

      case "video-upgrade-request":
        this.handleVideoUpgradeRequest(data);
        break;

      case "video-upgrade-response":
        this.handleVideoUpgradeResponse(data);
        break;
    }
  };

  scheduleReconnect = () => {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(
      () => this.connectWebSocket(),
      CallManager.RECONNECT_DELAY,
    );
  };

  sendSignal = (data, _retries = 0) => {
    if (this.wsReadyState === WebSocket.OPEN && this.wsId != null) {
      CordovaWebsocketPlugin.wsSend(this.wsId, JSON.stringify(data));
      return true;
    }
    // ✅ FIX : limite à 10 tentatives (5s max) pour éviter la boucle infinie
    if (_retries >= 10) {
      console.warn("⚠️ sendSignal abandonné après 10 tentatives :", data.type);
      return false;
    }
    console.warn(
      `⚠️ Socket non prêt, tentative ${_retries + 1}/10 dans 500ms :`,
      data.type,
    );
    setTimeout(() => this.sendSignal(data, _retries + 1), 500);
    return false;
  };

  /* =========================================================
   1. PARTIE ÉMETTEUR (OUTGOING CALL)
========================================================= */

  makeCall = async (video = false) => {
    if (this.wsReadyState !== WebSocket.OPEN) {
      alert("Vous n'êtes pas connecté au serveur.");
      return;
    }

    const input = document.getElementById("target-id-input");
    const targetId = input ? input.value.trim() : "";

    if (!targetId || targetId === this.myId) {
      alert("Veuillez saisir un ID valide.");
      return;
    }

    this.cleanCallState();
    this.targetUserId = targetId;
    this.isVideoCall = video;

    this.updateStatus("Initialisation média...");

    try {
      await this.initMediaAndPeer();

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal({
        type: "call-user",
        targetId: this.targetUserId,
        offer: offer,
        isVideo: this.isVideoCall,
      });

      this.updateStatus("Appel en cours...");
      this.toggleCallButtons(true);
      this.toggleCallControlButtons(false);
      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );
    } catch (error) {
      console.error("❌ Erreur lancement appel :", error);
      this.hangUp(false);
    }
  };

  makeVideoCall = () => {
    this.makeCall(true);
  };

  handleCallAnswered = async (data) => {
    console.log("📞 Appel accepté par le destinataire");
    if (!this.peerConnection) return;
    if (!data.answer) {
      console.error("❌ Erreur : data.answer est manquant !");
      this.hangUp(false);
      return;
    }

    // Ignorer une 2e réponse (answer dupliquée) si on a déjà quitté
    // have-local-offer — sinon setRemoteDescription lève et le catch
    // appelle hangUp() → retour intempestif à l'écran d'accueil.
    if (this.peerConnection.signalingState !== "have-local-offer") {
      console.warn(
        "⚠️ call-answered ignoré (état déjà avancé) :",
        this.peerConnection.signalingState,
      );
      return;
    }

    try {
      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(data.answer),
      );
      await this.processPendingCandidates();
      this.startTimer();
      this.updateStatus("Appel connecté");
      this.toggleCallControlButtons(true);

      // Basculer l'appelant vers l'interface d'appel en cours
      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );
      this.setContactName(this.targetUserId);
    } catch (error) {
      console.error("❌ Erreur réponse :", error);
      this.hangUp(false);
    } finally {
      this.isRenegotiating = false;
    }
  };

  /* =========================================================
   TRANSFORMER UN APPEL AUDIO EN APPEL VIDÉO
========================================================= */

  upgradeToVideo = async () => {
    if (!this.peerConnection || !this.localStream || this.isVideoCall) {
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
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      this.isRenegotiating = true;

      this.localStream.addTrack(videoTrack);
      this.peerConnection.addTrack(videoTrack, this.localStream);

      this.isVideoCall = true;

      const localVideo = document.getElementById("local-video");
      if (localVideo) localVideo.srcObject = this.localStream;
      this.showInterface(this.interfaceVideo);
      this.showLocalVideoPlaceholder(false);

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal({
        type: "restart-offer",
        targetId: this.targetUserId,
        offer: offer,
        isVideo: true,
      });
      this.updateStatus("Passage en appel vidéo...");
    } catch (error) {
      this.isRenegotiating = false;
      console.error("❌ Erreur passage en vidéo :", error);
    }
  };

  performVideoUpgrade = async () => {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      this.isRenegotiating = true;

      this.localStream.addTrack(videoTrack);
      this.peerConnection.addTrack(videoTrack, this.localStream);

      this.isVideoCall = true;

      const localVideo = document.getElementById("local-video");
      if (localVideo) localVideo.srcObject = this.localStream;
      this.showInterface(this.interfaceVideo);
      this.showLocalVideoPlaceholder(false);

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal({
        type: "restart-offer",
        targetId: this.targetUserId,
        offer: offer,
        isVideo: true,
      });
      this.updateStatus("Passage en appel vidéo...");
    } catch (error) {
      this.isRenegotiating = false;
      console.error("❌ Erreur passage en vidéo :", error);
    }
  };

  handleVideoUpgradeRequest = (data) => {
    console.log("📹 Demande de passage en vidéo reçue de :", data.from);

    const accept = window.confirm("Voulez-vous passer en appel vidéo ?");

    this.sendSignal({
      type: "video-upgrade-response",
      targetId: this.targetUserId,
      accepted: accept,
    });

    if (!accept) {
      console.log("📹 Passage en vidéo refusé");
    }
  };

  handleVideoUpgradeResponse = (data) => {
    if (data.accepted) {
      console.log("📹 Passage en vidéo accepté par le destinataire");
      this.performVideoUpgrade();
    } else {
      console.log("📹 Passage en vidéo refusé par le destinataire");
      this.updateStatus("Appel connecté");
      alert("L'autre personne a refusé de passer en appel vidéo.");
    }
  };

  handleVideoUpgradeOffer = async (data) => {
    if (!this.peerConnection) {
      console.log(
        "⛔ handleVideoUpgradeOffer() ignoré — pas de peerConnection",
      );
      return;
    }
    console.log(
      "📹 handleVideoUpgradeOffer() reçu — isVideoCall avant:",
      this.isVideoCall,
    );
    this.isRenegotiating = true;

    try {
      if (!this.isVideoCall) {
        this.isVideoCall = true;
        this.showInterface(this.interfaceVideo);
        this.showLocalVideoPlaceholder(true);
        this.isCameraOff = true;
        this.updateCameraIcon();
        this.sendCameraState();
      }

      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(data.offer),
      );
      console.log("📹 setRemoteDescription(offer) OK");
      await this.processPendingCandidates();

      const videoTransceiver = this.peerConnection
        .getTransceivers()
        .find(
          (t) =>
            t.receiver && t.receiver.track && t.receiver.track.kind === "video",
        );

      if (
        videoTransceiver &&
        !(this.localStream && this.localStream.getVideoTracks().length > 0)
      ) {
        videoTransceiver.direction = "recvonly";
      }

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      console.log("📹 Réponse créée (recvonly si pas encore de caméra locale)");

      this.sendSignal({
        type: "answer-call",
        targetId: this.targetUserId,
        answer: answer,
      });
      this.updateStatus("Appel vidéo connecté");
    } catch (error) {
      console.error("❌ Erreur réception passage vidéo :", error);
    } finally {
      this.isRenegotiating = false;
    }
  };

  /* =========================================================
   2. PARTIE RÉCEPTEUR (INCOMING CALL)
========================================================= */

  handleIncomingCall = (data) => {
    console.log("📞 Appel entrant reçu de :", data.from);

    this.cleanCallState();
    this.targetUserId = data.from;
    this.pendingOffer = data.offer;
    this.currentCallId = data.callId;
    this.isVideoCall = data.isVideo === "true" || data.isVideo === true;
    if (data.notId) this.currentNotId = data.notId;

    // ✅ FIX : afficher le nom de l'appelant dans toutes les interfaces
    this.setContactName(data.from);

    this.updateStatus(
      this.isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...",
    );
    this.showInterface(this.interfaceReceiver);
    this.startVibration();
  };

  handleCallOfferDetails = async (data) => {
    console.log("📦 Offre SDP reçue du serveur pour :", data.callId);

    this.targetUserId = data.from;
    this.pendingOffer = data.offer;
    this.isVideoCall = data.isVideo === "true" || data.isVideo === true;

    if (this.autoAcceptOnOffer && this.pendingOffer) {
      this.autoAcceptOnOffer = false;
      await this.acceptCall();
    }
  };

  acceptCall = async () => {
    // Anti double-décroche (swipe + click synthétique WebView, ou 2 taps rapides)
    if (this.peerConnection) {
      console.warn("⚠️ acceptCall() ignoré — appel déjà en cours de traitement");
      return;
    }
    if (this._acceptInProgress) {
      console.warn("⚠️ acceptCall() ignoré — acceptation déjà en cours");
      return;
    }
    this._acceptInProgress = true;

    // iOS: réponse forcée via CallKit
    if (this.isIOS()) {
      console.log("ℹ️ [iOS] Réponse forcée via l'écran d'appel natif CallKit.");
      this.updateStatus("Décrochez depuis l'écran d'appel");
      this._acceptInProgress = false;
      return this.answerIncomingCall();
    }

    this.stopVibration();

    if (!this.pendingOffer) {
      if (this.currentCallId) {
        this.autoAcceptOnOffer = true;
        this._acceptInProgress = false;
        await this.ensureConnectedAndFetchOffer();
        return;
      }
      console.warn("⚠️ Aucune offre SDP disponible pour répondre.");
      this._acceptInProgress = false;
      return;
    }

    try {
      this.updateStatus("Connexion à l'appel...");
      await this.initMediaAndPeer();

      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(this.pendingOffer),
      );
      await this.processPendingCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.sendSignal({
        type: "answer-call",
        targetId: this.targetUserId,
        answer: answer,
      });

      this.startTimer();
      this.pendingOffer = null;

      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );
      this.updateStatus("Appel connecté");
    } catch (error) {
      console.error("❌ Erreur acceptation appel :", error);
      this.hangUp(false);
    } finally {
      this._acceptInProgress = false;
    }
  };

  // iOS: Version spécifique pour answerIncomingCall
  answerIncomingCall = async () => {
    console.log("🚀 [iOS] answerIncomingCall() démarre");
    this.stopVibration();

    if (!this.pendingOffer) {
      if (this.currentCallId) {
        console.log("⏳ [iOS] Pas encore d'offre — nouvelle demande get-offer");
        this.autoAcceptOnOffer = true;
        await this.ensureConnectedAndFetchOffer();
        return;
      }
      console.warn("⚠️ [iOS] Aucune offre SDP disponible");
      return;
    }

    try {
      this.updateStatus("Connexion à l'appel...");

      // iOS: Activation audio AVANT getUserMedia
      if (this.isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
        console.log("🔊 [iOS] activateAudio() natif démarre...");
        await new Promise((resolve) => {
          try {
            cordova.plugins.CordovaCall.activateAudio(
              () => {
                console.log("✅ [iOS] AVAudioSession activée.");
                resolve();
              },
              (err) => {
                console.warn("⚠️ [iOS] activateAudio erreur:", err);
                resolve();
              },
            );
          } catch (e) {
            console.warn("⚠️ [iOS] activateAudio exception:", e);
            resolve();
          }
        });
      }

      await this.initMediaAndPeer(false); // false: attacher pistes après setRemoteDescription

      if (this.isVideoCall) {
        this.showInterface(this.interfaceVideo);
      }

      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(this.pendingOffer),
      );

      this.attachLocalTracksToPeer();

      await this.processPendingCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.sendSignal({
        type: "answer-call",
        targetId: this.targetUserId,
        answer: answer,
      });

      this.startTimer();
      this.pendingOffer = null;

      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );
      this.updateStatus("Appel connecté");
    } catch (error) {
      console.error("❌ [iOS] Erreur acceptation appel :", error);
      this.hangUp(false);
    }
  };

  rejectCall = () => {
    // iOS: Terminer appel CallKit
    if (this.isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
      try {
        cordova.plugins.CordovaCall.endCall();
      } catch (e) {}
    }

    if (this.targetUserId) {
      this.sendSignal({
        type: "call-refused",
        targetId: this.targetUserId,
      });
    }
    this.stopVibration();
    this.cleanCallState();
    this.closeInterfaces();
    this.updateStatus("En ligne");
    this.closeNativeIncomingCallScreenIfNeeded();
  };

  // ✅ FIX écran noir : quand l'appel entrant s'affiche par-dessus l'écran de
  // verrouillage (IncomingCallActivity, voir CallMessagingService/appel_entrant.html),
  // le natif applique FLAG_SHOW_WHEN_LOCKED / FLAG_TURN_SCREEN_ON / FLAG_KEEP_SCREEN_ON
  // à la création de l'Activity et ne les retire QUE via le pont JS "AndroidCall"
  // (voir IncomingCallActivity.JsBridge.closeCallScreen()). Comme rien ne l'appelait
  // jamais depuis CallManager.js, l'Activity restait figée par-dessus le verrouillage
  // (WebView vide, fond sombre) après un raccroché ou un refus depuis cette écran-là —
  // d'où l'"écran noir" constaté. window.AndroidCall n'existe que dans ce contexte
  // précis (absent dans MainActivity) : l'appel est donc sans effet ailleurs.
  closeNativeIncomingCallScreenIfNeeded = () => {
    if (window.AndroidCall && typeof AndroidCall.closeCallScreen === "function") {
      try {
        AndroidCall.closeCallScreen();
      } catch (e) {
        console.warn("⚠️ AndroidCall.closeCallScreen() a échoué :", e);
      }
    }
  };

  /* =========================================================
   3. FLUX MEDIA & WEBRTC
========================================================= */

  attachLocalTracksToPeer = () => {
    if (!this.peerConnection || !this.localStream) return;
    this.localStream.getTracks().forEach((track) => {
      this.peerConnection.addTrack(track, this.localStream);
    });
    console.log("✅ Pistes locales attachées au peerConnection");
  };

  initMediaAndPeer = async (attachTracksNow = true) => {
    try {
      // Configuration de l'implémentation WebRTC
      this.activeRTC = {
        getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
        PeerConnection: window.RTCPeerConnection,
        SessionDescription: window.RTCSessionDescription,
        IceCandidate: window.RTCIceCandidate,
      };

      // iOS: Vérifier autorisations médias
      if (this.isIOS()) {
        await this.ensureMediaAuthorizedIOS();
      }

      this.localStream = await this.activeRTC.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: this.isVideoCall ? { facingMode: "user" } : false,
      });

      if (this.isVideoCall) {
        const localVideo = document.getElementById("local-video");
        if (localVideo) localVideo.srcObject = this.localStream;
      }

      // iOS: Activer haut-parleur par défaut
      if (this.isIOS() && typeof activerAudioSessionIOS === "function") {
        activerAudioSessionIOS(this.isSpeakerOn ? "speaker" : "receiver");
      }

      this.peerConnection = new this.activeRTC.PeerConnection(CallManager.RTC_CONFIG);

      if (attachTracksNow) {
        this.attachLocalTracksToPeer();
      }

      this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.targetUserId) {
        this.logToScreen(`🧊 ICE envoyé: ${event.candidate.type ?? "?"} ${event.candidate.protocol ?? ""}`);
        this.sendSignal({
          type: "ice-candidate",
          targetId: this.targetUserId,
          candidate: event.candidate,
        });
      } else if (!event.candidate) {
        this.logToScreen("🧊 Fin de collecte ICE locale");
      }
    };

      this.peerConnection.ontrack = async (event) => {
        console.log("🔊/📹 ontrack déclenché — kind:", event.track.kind);

        const stream =
          event.streams && event.streams[0]
            ? event.streams[0]
            : new MediaStream([event.track]);

        const playRemoteAudio = (audioStream) => {
          const remoteAudio =
            document.getElementById("remoteAudio") ||
            document.getElementById("remote-audio");
          if (!remoteAudio) {
            console.error("❌ #remoteAudio introuvable");
            return;
          }
          remoteAudio.muted = false;
          remoteAudio.volume = 1;
          if (remoteAudio.srcObject !== audioStream) {
            remoteAudio.srcObject = audioStream;
          }
          audioStream.getAudioTracks().forEach((t) => {
            t.enabled = true;
            console.log(
              "🔊 piste audio:",
              t.id,
              "enabled=",
              t.enabled,
              "muted=",
              t.muted,
              "readyState=",
              t.readyState,
            );
          });
          const tryPlay = (n) => {
            remoteAudio
              .play()
              .then(() => console.log("✅ remoteAudio.play() OK"))
              .catch((e) => {
                console.warn("⚠️ remoteAudio.play() try", n, e);
                if (n < 3) setTimeout(() => tryPlay(n + 1), 400 * (n + 1));
              });
          };
          tryPlay(0);
        };

        if (event.track.kind === "video") {
          const remoteVideo = document.getElementById("remote-video");
          if (remoteVideo) {
            // Son uniquement via <audio> — évite silence / double audio WebView
            remoteVideo.muted = true;
            if (remoteVideo.srcObject !== stream) {
              remoteVideo.srcObject = stream;
            }
            try {
              await remoteVideo.play();
            } catch (e) {
              console.error("❌ Erreur play remote-video :", e);
            }
          }
          if (stream.getAudioTracks().length > 0) {
            playRemoteAudio(stream);
          }
        } else {
          playRemoteAudio(stream);
        }
      };

      // iOS: Utiliser oniceconnectionstatechange au lieu de onconnectionstatechange
      const stateChangeEvent = this.isIOS()
        ? "oniceconnectionstatechange"
        : "onconnectionstatechange";
      const stateProperty = this.isIOS()
        ? "iceConnectionState"
        : "connectionState";

      this.peerConnection[stateChangeEvent] = () => {
        const state = this.peerConnection[stateProperty];
        console.log("🔗 État WebRTC :", state);

        if (
          (state === "failed" || state === "disconnected") &&
          !this.isRestartingIce &&
          !this.isRenegotiating
        ) {
          console.log("⚠️ Déclenchement restartIceSession()");
          this.restartIceSession();
        }

        if (state === "connected" || state === "completed") {
          this.isRestartingIce = false;
          this.updateStatus("Appel connecté");

          // iOS: Activer haut-parleur à la connexion
          if (this.isIOS() && typeof activerAudioSessionIOS === "function") {
            activerAudioSessionIOS(this.isSpeakerOn ? "speaker" : "receiver");
          }

          // Re-play audio distant (autoplay parfois bloqué au 1er ontrack)
          const remoteAudio =
            document.getElementById("remoteAudio") ||
            document.getElementById("remote-audio");
          if (remoteAudio && remoteAudio.srcObject) {
            remoteAudio.muted = false;
            remoteAudio.volume = 1;
            remoteAudio.play().catch((e) =>
              console.warn("⚠️ re-play remoteAudio:", e),
            );
          }
        }
      };
    } catch (error) {
      console.error("❌ Erreur dans initMediaAndPeer() :", error);
      throw error; // ✅ FIX : propager l'erreur pour que l'appelant (makeCall, acceptCall) annule proprement
    }
  };


  /* =========================================================
   ZONE DE LOG ÉCRAN — ICE + erreurs + localStorage
========================================================= */

// Ajoute une ligne dans le panneau (toujours en mémoire, visible seulement si
// le bouton 🐞 a été activé — voir toggleScreenLog).
logToScreen = (message) => {
  const box = document.getElementById("log-debug-box");
  if (!box) return;
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
};

// Bouton 🐞 : bascule l'affichage du panneau, sans jamais effacer son contenu.
toggleScreenLog = () => {
  const box = document.getElementById("log-debug-box");
  if (!box) return;
  box.classList.toggle("show");
};

clearScreenLog = () => {
  const box = document.getElementById("log-debug-box");
  if (!box) return;
  box.innerHTML = "";
  box.classList.remove("show");
};

// Capture tous les console.log/warn/error de l'app (une seule fois) et les
// répercute dans le panneau, en plus de la console habituelle du navigateur.
setupConsoleCapture = () => {
  if (CallManager._consoleCaptured) return;
  CallManager._consoleCaptured = true;

  const format = (args) =>
    args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch (e) {
          return String(a);
        }
      })
      .join(" ");

  ["log", "warn", "error"].forEach((level) => {
    const original = console[level].bind(console);
    const prefix = { log: "", warn: "⚠️ ", error: "❌ " }[level];
    console[level] = (...args) => {
      original(...args);
      this.logToScreen(`${prefix}${format(args)}`);
    };
  });
};

serializeError = (error) => {
  const data = {};
  Object.getOwnPropertyNames(error).forEach((key) => { data[key] = error[key]; });
  data.name = data.name ?? error.name;
  data.message = data.message ?? error.message;
  data.code = data.code ?? error.code;
  return data;
};

showLocalStorageOnScreen = () => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  if (keys.length === 0) {
    this.logToScreen("📦 localStorage: (vide)");
    return;
  }
  keys.forEach((key) => this.logToScreen(`📦 ${key} = ${localStorage.getItem(key)}`));
};



  handleNewICECandidate = async (data) => {
    if (!data.candidate) return;

    this.logToScreen(`🧊 ICE reçu: ${data.candidate.candidate ?? "?"}`);

    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      this.pendingCandidates.push(data.candidate);
      return;
    }

    try {
      const IceCandidate = this.activeRTC ? this.activeRTC.IceCandidate : RTCIceCandidate;
      await this.peerConnection.addIceCandidate(new IceCandidate(data.candidate));
    } catch (error) {
      const errData = this.serializeError(error);
      this.logToScreen(`❌ ${errData.name} (code:${errData.code}) — ${errData.message}`);
    }
  };

  processPendingCandidates = async () => {
    if (this.pendingCandidates.length > 0) {
      const IceCandidate = this.activeRTC
        ? this.activeRTC.IceCandidate
        : RTCIceCandidate;
      for (const candidate of this.pendingCandidates) {
        try {
          await this.peerConnection.addIceCandidate(
            new IceCandidate(candidate),
          );
        } catch (e) {}
      }
      this.pendingCandidates = [];
    }
  };


    /* =========================================================
   DEBUG — Affichage du localStorage à l'écran
========================================================= */

  showLocalStorageOnScreen = () => {
    // 1. Récupération de toutes les données du localStorage
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }

    // 2. Création du panneau d'affichage s'il n'existe pas déjà
    let box = document.getElementById("storage-debug-box");
    if (!box) {
      box = document.createElement("div");
      box.id = "storage-debug-box";
      box.style.cssText =
        "position:fixed;bottom:10px;left:10px;right:10px;max-height:35vh;overflow-y:auto;" +
        "background:rgba(0,0,0,0.85);color:#0f0;font-size:12px;font-family:monospace;" +
        "padding:8px;border-radius:8px;z-index:9999;white-space:pre-wrap;";
      document.body.appendChild(box);
    }

    // 3. Construction du texte à afficher
    let text = `📦 localStorage [${new Date().toLocaleTimeString()}]\n`;
    const keys = Object.keys(data);
    if (keys.length === 0) {
      text += "(vide)";
    } else {
      keys.forEach((key) => {
        text += `${key} = ${data[key]}\n`;
      });
    }

    box.textContent = text; // remplace le contenu à chaque appel
  };

  /* =========================================================
   4. RECONNEXION ICE
========================================================= */

  restartIceSession = async () => {
    if (!this.peerConnection || !this.targetUserId) return;

    try {
      this.isRestartingIce = true;
      if (typeof this.peerConnection.restartIce === "function") {
        this.peerConnection.restartIce();
      }

      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal({
        type: "restart-offer",
        targetId: this.targetUserId,
        offer: offer,
      });
    } catch (error) {
      this.isRestartingIce = false;
    }
  };

  handleRestartOffer = async (data) => {
    if (!this.peerConnection) return;

    try {
      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(data.offer),
      );
      await this.processPendingCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.sendSignal({
        type: "answer-call",
        targetId: this.targetUserId,
        answer: answer,
      });
    } catch (e) {}
  };

  /* =========================================================
   5. NETTOYAGE
========================================================= */

  clearNativeCallNotification = () => {
    if (!this.currentNotId) return;
    if (!(
      this.isIOS() &&
      this.push &&
      typeof this.push.clearNotification === "function"
    )) {
      return;
    }
    const notIdToClear = this.currentNotId;
    this.push.clearNotification(
      Number(notIdToClear),
      () => console.log("✅ Notification native supprimée"),
      (err) => console.warn("⚠️ Échec suppression notification native :", err),
    );
  };

  hangUp = (sendSignalToPeer = true) => {
    // iOS: Terminer appel CallKit (auparavant seulement dans this.rejectCall,
    // ce qui laissait l'interface native ouverte quand on raccrochait
    // un appel déjà accepté au lieu de le refuser)
    if (this.isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
      try {
        cordova.plugins.CordovaCall.endCall();
      } catch (e) {}
    }

    if (sendSignalToPeer && this.targetUserId) {
      this.sendSignal({
        type: "call-end",
        targetId: this.targetUserId,
      });
    }

    // Masquer l'UI d'abord (évite flash / écran noir), puis libérer les médias
    this.closeInterfaces();
    this.cleanCallState();
    this.toggleCallButtons(false);
    this.updateStatus("En ligne");
    this.closeNativeIncomingCallScreenIfNeeded();
  };

  // Alias attendu par le bouton flèche-retour de interface-1 :
  // pendant un appel, "retour" doit raccrocher, pas juste masquer l'écran.
  closeInterface = () => {
    this.hangUp();
  };

  cleanCallState = () => {
    this.clearNativeCallNotification();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    ["remoteAudio", "remote-audio"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        try {
          el.pause();
        } catch (e) {}
        el.srcObject = null;
      }
    });

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (e) {}
      this.peerConnection = null;
    }
    this.activeRTC = null;

    this.stopTimer();
    this.stopVibration();

    this.pendingOffer = null;
    this.currentCallId = null;
    this.currentNotId = null;
    this.targetUserId = null;
    this.pendingCandidates = [];
    this.autoAcceptOnOffer = false;
    this._acceptInProgress = false;
    this.isRestartingIce = false;
    this.isVideoCall = false;
    this.isCameraOff = false;
    this.isMuted = false;
    this.updateMicUI();
    document
      .querySelectorAll(".js-remote-mute-badge")
      .forEach((badge) => badge.classList.remove("show"));
    document
      .querySelectorAll(".js-remote-camera-badge")
      .forEach((badge) => badge.classList.remove("show"));
    this.hideCallToast();
    this.isFrontCamera = true;
    this.isSwitchingCamera = false;
    this.isRenegotiating = false;
    this.isSpeakerOn = true;
    this.toggleCallControlButtons(true);

    const switchCameraBtn = document.getElementById("btn-switch-camera");
    if (switchCameraBtn) switchCameraBtn.disabled = false;

    localStorage.removeItem("pending_call_id");
  };

  // Confirmation locale brève d'une action sur SON PROPRE micro/caméra (ex: "Micro coupé") —
  // à ne pas confondre avec les badges .remote-status-badge, qui signalent l'état du
  // CORRESPONDANT. Réinitialisé un appel plus tôt, un déclenchement rapproché (ex: micro puis
  // caméra coupés coup sur coup) remplace simplement le message affiché.
  showCallToast = (message) => {
    const toast = document.getElementById("call-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(this.callToastTimer);
    this.callToastTimer = setTimeout(
      () => toast.classList.remove("show"),
      1800,
    );
  };

  hideCallToast = () => {
    clearTimeout(this.callToastTimer);
    const toast = document.getElementById("call-toast");
    if (toast) toast.classList.remove("show");
  };

  toggleMicrophone = () => {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    this.isMuted = !this.isMuted;
    audioTrack.enabled = !this.isMuted;
    this.updateMicUI();
    if (this.isMuted) this.showCallToast("Micro coupé");

    if (this.targetUserId) {
      this.sendSignal({
        type: "peer-mic-state",
        targetId: this.targetUserId,
        muted: this.isMuted,
      });
    }
  };

  // Avertit l'autre partie d'une coupure/réactivation du micro (relais "peer-mic-state" côté
  // serveur, voir serveurios.js). Chaque camp affiche un badge quand SON correspondant est
  // coupé — indépendant de son propre état de micro.
  handleRemoteMicState = (data) => {
    document.querySelectorAll(".js-remote-mute-badge").forEach((badge) => {
      badge.classList.toggle("show", !!data.muted);
    });
  };

  handleRemoteCameraState = (data) => {
    document.querySelectorAll(".js-remote-camera-badge").forEach((badge) => {
      badge.classList.toggle("show", !!data.cameraOff);
    });
  };

  // Avertit l'autre partie d'une coupure/réactivation de SA caméra (même mécanisme que
  // sendCameraState -> peer-camera-state, symétrique de peer-mic-state pour le micro).
  sendCameraState = () => {
    if (this.targetUserId) {
      this.sendSignal({
        type: "peer-camera-state",
        targetId: this.targetUserId,
        cameraOff: this.isCameraOff,
      });
    }
  };

  // Le micro existe dans deux interfaces (appel audio et appel vidéo) : on met à jour toutes
  // les copies (un id HTML ne peut désigner qu'un seul élément, d'où les classes js-mic-*).
  updateMicUI = () => {
    document
      .querySelectorAll(".js-mic-btn")
      .forEach((btn) => btn.classList.toggle("active-mute", this.isMuted));
    document.querySelectorAll(".js-mic-icon").forEach((icon) => {
      icon.className = this.isMuted
        ? "fa-solid fa-microphone-slash js-mic-icon"
        : "fa-solid fa-microphone js-mic-icon";
    });
    document.querySelectorAll(".js-mic-label").forEach((label) => {
      label.textContent = this.isMuted
        ? label.dataset.labelMuted || "Activer le micro"
        : label.dataset.labelOn || "Désactiver le micro";
    });
  };

  // Android: Gestion AudioRoute

  getAudioRoutes = () => {
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
  };

  setAudioRoute = (route) => {
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
  };

  toggleAudioRouteMenu = async () => {
    const menu = document.getElementById("audio-route-menu");
    if (!menu) return;

    if (menu.classList.contains("open")) {
      menu.classList.remove("open");
      return;
    }

    const { routes, current } = await this.getAudioRoutes();
    this.currentAudioRoute = current || "earpiece";

    menu.innerHTML = "";
    routes.forEach((route) => {
      const item = document.createElement("div");
      item.className =
        "audio-route-item" +
        (route === this.currentAudioRoute ? " active" : "");
      item.innerHTML = `<i class="${CallManager.ROUTE_ICONS[route] || "fa-solid fa-volume-high"}"></i><span>${CallManager.ROUTE_LABELS[route] || route}</span>`;
      item.onclick = async () => {
        await this.setAudioRoute(route);
        this.currentAudioRoute = route;
        this.updateAudioRouteIcon();
        menu.classList.remove("open");
      };
      menu.appendChild(item);
    });

    menu.classList.add("open");
  };

  updateAudioRouteIcon = () => {
    const icon = document.getElementById("audio-route-icon");
    if (icon)
      icon.className =
        CallManager.ROUTE_ICONS[this.currentAudioRoute] || "fa-brands fa-bluetooth-b";
  };

  // iOS: Gestion haut-parleur
  toggleSpeaker = () => {
    this.isSpeakerOn = !this.isSpeakerOn;

    if (this.isIOS() && typeof activerAudioSessionIOS === "function") {
      activerAudioSessionIOS(this.isSpeakerOn ? "speaker" : "receiver");
    }

    const speakerIcon = document.getElementById("speaker-icon");
    const btn = document.getElementById("btn-toggle-speaker");

    if (this.isSpeakerOn) {
      if (speakerIcon) speakerIcon.className = "fa-solid fa-volume-high";
      if (btn) btn.classList.remove("disabled");
    } else {
      if (speakerIcon) speakerIcon.className = "fa-solid fa-volume-low";
      if (btn) btn.classList.add("disabled");
    }
  };

  /* =========================================================
   6. UI & TIMERS
========================================================= */

  updateStatus = (message) => {
    const statusElement = document.querySelectorAll(".status-bar");
    for (let i = 0; i < statusElement.length; i++) {
      statusElement[i].innerText = message;
    }
  };

  // Active/désactive les boutons de contrôle d'appel (micro, caméra, switch caméra,
  // haut-parleur) côté appelant. Utilisé pour les garder désactivés tant que
  // l'appelé n'a pas encore accepté l'appel (bouton raccrocher non concerné,
  // il doit rester utilisable pour annuler l'appel en cours).
  toggleCallControlButtons = (enabled) => {
    // Boutons vidéo (ids stables dans interface-3)
    const ids = [
      "btn-toggle-mic",
      "btn-toggle-camera",
      "btn-switch-camera",
      "btn-toggle-speaker",
    ];
    ids.forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled = !enabled;
      if (enabled) {
        btn.classList.remove("disabled");
      } else {
        btn.classList.add("disabled");
      }
    });

    // Tous les boutons micro (classes js-mic-btn : audio + vidéo)
    document.querySelectorAll(".js-mic-btn").forEach((btn) => {
      btn.disabled = !enabled;
      if (enabled) {
        btn.classList.remove("disabled");
      } else {
        btn.classList.add("disabled");
      }
    });

    // Interface d'appel audio (interface-1) : les boutons "Audio", "Vidéo",
    // "Plus" et "Partager" n'ont pas d'id dans le HTML de référence (qu'on ne
    // modifie pas), donc on les cible par leur position dans le panneau de
    // contrôle. Le bouton "Terminer" (classe .hangup) est explicitement exclu
    // pour rester utilisable et permettre d'annuler l'appel en cours.
    if (this.interfaceSender) {
      const audioPanelButtons = this.interfaceSender.querySelectorAll(
        ".control-panel button:not(.hangup)",
      );
      audioPanelButtons.forEach((btn) => {
        btn.disabled = !enabled;
        if (enabled) {
          btn.classList.remove("disabled");
        } else {
          btn.classList.add("disabled");
        }
      });
    }
  };

  toggleCallButtons = (inCall) => {
    const callButton = document.getElementById("btn-call");
    if (callButton) callButton.disabled = inCall;

    const hangupButton = document.getElementById("btn-hangup");
    if (hangupButton) hangupButton.disabled = !inCall;
  };

  // Empêche l'écran de se verrouiller le temps d'un appel (audio ou vidéo), via
  // cordova-plugin-insomnia (fonctionne sur iOS et Android). Activé/désactivé depuis
  // showInterface()/closeInterfaces(), seuls points de passage communs à l'ouverture et à la
  // fermeture de toute interface d'appel (entrant, sortant, audio, vidéo).
  setScreenKeptAwake = (enabled) => {
    const insomnia = window.plugins && window.plugins.insomnia;
    if (!insomnia) return;

    const onError = (err) =>
      console.warn("⚠️ [setScreenKeptAwake] erreur:", err);
    if (enabled) {
      insomnia.keepAwake(() => {}, onError);
    } else {
      insomnia.allowSleepAgain(() => {}, onError);
    }
  };

  showInterface = (activeInterface) => {
    // ✅ FIX "aucune image ne s'affiche" : on ne bascule QUE l'affichage des
    // écrans ici (hideAllInterfaces), on ne touche plus aux <video>. Avant ce
    // correctif, showInterface() appelait closeInterfaces() — qui remet
    // systématiquement local-video/remote-video.srcObject à null et les passe
    // en display:none — À CHAQUE changement d'écran, y compris celui qui bascule
    // VERS l'appel vidéo lui-même. Résultat : initMediaAndPeer() attachait bien
    // le flux caméra local à <video id="local-video">, mais l'appel à
    // showInterface(this.interfaceVideo) qui suit immédiatement (dans makeCall,
    // acceptCall, handleCallAnswered...) l'effaçait aussitôt. closeInterfaces()
    // reste utilisé tel quel — mais uniquement au raccrochage (hangUp/rejectCall),
    // où ce nettoyage complet des flux est réellement voulu.
    this.hideAllInterfaces();
    if (activeInterface) activeInterface.classList.add("active");
    this.setScreenKeptAwake(!!activeInterface);

    if (activeInterface === this.interfaceVideo) {
      const localV = document.getElementById("local-video");
      const remoteV = document.getElementById("remote-video");
      if (localV) localV.style.display = "";
      if (remoteV) remoteV.style.display = "";
      document.body.classList.add("video-call-active");

      // fixed uniquement pendant l'appel vidéo (évite rectangle noir après hangUp)
      const localWrap = document.querySelector(".local-video-wrapper");
      if (localWrap) {
        localWrap.style.position = "fixed";
        localWrap.style.zIndex = "9999";
        localWrap.style.touchAction = "none";
      }
    } else {
      document.body.classList.remove("video-call-active");
      // Repart d'un style propre si jamais on quitte l'écran vidéo sans
      // raccrocher (closeInterfaces() ne le fait plus pour nous ici).
      const localWrap = document.querySelector(".local-video-wrapper");
      if (localWrap) localWrap.style.cssText = "";
    }

    if (
      activeInterface === this.interfaceVideo &&
      this.isIOS() &&
      cordova.plugins &&
      cordova.plugins.iosrtc
    ) {
      cordova.plugins.iosrtc.refreshVideos();
      setTimeout(() => cordova.plugins.iosrtc.refreshVideos(), 300);
    }
  };

  // Ferme uniquement les écrans (retire .active) — sans toucher aux flux vidéo.
  // Utilisé par showInterface() à chaque changement d'écran normal.
  hideAllInterfaces = () => {
    document.querySelectorAll(".view-container").forEach((el) => {
      el.classList.remove("active");
    });
  };

  // Nettoyage COMPLET (écrans + flux vidéo) : réservé à la fin d'appel réelle
  // (hangUp/rejectCall) — ne plus appeler depuis showInterface().

  closeInterfaces = () => {
    this.interfaceReceiver =
      this.interfaceReceiver || document.getElementById("interface-2");
    this.interfaceSender =
      this.interfaceSender || document.getElementById("interface-1");
    this.interfaceVideo =
      this.interfaceVideo || document.getElementById("interface-3");

    // 1) Masquer les <video> AVANT de retirer .active (iosrtc + flash noir)
    ["local-video", "remote-video"].forEach((id) => {
      const v = document.getElementById(id);
      if (!v) return;
      try {
        v.pause();
      } catch (e) {}
      v.srcObject = null;
      v.removeAttribute("src");
      v.style.display = "none";
      try {
        v.load();
      } catch (e) {}
    });

    // 2) Reset complet des styles inline de la mini-vidéo (fixed / z-index)
    const localWrap = document.querySelector(".local-video-wrapper");
    if (localWrap) {
      localWrap.style.cssText = "";
    }

    // 3) Fermer tous les overlays
    document.querySelectorAll(".view-container").forEach((el) => {
      el.classList.remove("active");
    });
    document.body.classList.remove("video-call-active");
    this.setScreenKeptAwake(false);

    // 4) iosrtc : refresh après masquage
    if (
      this.isIOS() &&
      window.cordova &&
      cordova.plugins &&
      cordova.plugins.iosrtc
    ) {
      try {
        cordova.plugins.iosrtc.refreshVideos();
      } catch (e) {}
      setTimeout(() => {
        try {
          cordova.plugins.iosrtc.refreshVideos();
        } catch (e) {}
      }, 120);
    }
  };

  startTimer = () => {
    let secondes = 0;
    if (this.timerInterval) return;

    this.timerInterval = setInterval(() => {
      secondes++;
      const h = String(Math.floor(secondes / 3600)).padStart(2, "0");
      const m = String(Math.floor((secondes % 3600) / 60)).padStart(2, "0");
      const s = String(secondes % 60).padStart(2, "0");

      const timerElement = document.getElementById("timer");
      const timerVideo = document.getElementById("timer-video");
      if (timerElement) timerElement.textContent = `${h}:${m}:${s}`;
      if (timerVideo) timerVideo.textContent = `${h}:${m}:${s}`;
    }, 1000);
  };

  stopTimer = () => {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    const timerElement = document.getElementById("timer");
    const timerVideo = document.getElementById("timer-video");
    if (timerElement) timerElement.textContent = "00:00:00";
    if (timerVideo) timerVideo.textContent = "00:00:00";
  };

  toggleCamera = async () => {
    // Cas 1: on a déjà une piste vidéo locale
    if (this.localStream && this.localStream.getVideoTracks().length > 0) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      this.isCameraOff = !this.isCameraOff;
      videoTrack.enabled = !this.isCameraOff;
      this.updateCameraIcon();
      this.sendCameraState();
      if (this.isCameraOff) this.showCallToast("Caméra coupée");

      // ⚠️ Contrairement à Android/Chromium, iosrtc n'affiche pas d'écran noir sur une piste
      // vidéo désactivée (track.enabled = false) : la vue native continue de peindre la
      // dernière image reçue, figée. On détache/réattache donc le flux de la miniature locale
      // pour forcer l'équivalent — ça n'a aucun effet sur ce qui est envoyé à l'interlocuteur
      // (la piste réellement transmise reste celle du this.peerConnection, gérée séparément).
      const localVideoEl = document.getElementById("local-video");
      if (localVideoEl) {
        if (this.isCameraOff) {
          localVideoEl.srcObject = null;
        } else {
          localVideoEl.srcObject = this.localStream;
          localVideoEl.play().catch(() => {});
        }
      }
      this.showLocalVideoPlaceholder(this.isCameraOff);
      return;
    }

    // Cas 2: pas encore de caméra locale
    if (!this.peerConnection || !this.localStream) return;

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      this.localStream.addTrack(videoTrack);

      const videoTransceiver = this.peerConnection
        .getTransceivers()
        .find(
          (t) =>
            t.receiver && t.receiver.track && t.receiver.track.kind === "video",
        );

      if (videoTransceiver) {
        await videoTransceiver.sender.replaceTrack(videoTrack);
        videoTransceiver.direction = "sendrecv";
      } else {
        this.peerConnection.addTrack(videoTrack, this.localStream);
      }

      const localVideo = document.getElementById("local-video");
      if (localVideo) localVideo.srcObject = this.localStream;

      this.showLocalVideoPlaceholder(false);
      this.isRenegotiating = true;
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.sendSignal({
        type: "restart-offer",
        targetId: this.targetUserId,
        offer: offer,
        isVideo: true,
      });
      console.log("📹 Caméra activée manuellement, renégociation envoyée");

      this.isCameraOff = false;
      this.updateCameraIcon();
      this.sendCameraState();
    } catch (error) {
      console.error("❌ Erreur activation caméra :", error);
      this.isRenegotiating = false;
    }
  };

  // Bascule caméra avant <-> arrière. Le capteur précédent est libéré AVANT d'ouvrir le
  // suivant (Android n'autorise pas deux caméras ouvertes), puis la piste envoyée à
  // l'interlocuteur est remplacée à chaud (replaceTrack) : pas de renégociation SDP.
  switchCamera = async () => {
    if (this.isSwitchingCamera || !this.localStream) return;
    const oldTrack = this.localStream.getVideoTracks()[0];
    if (!oldTrack) return;

    const button = document.getElementById("btn-switch-camera");
    this.isSwitchingCamera = true;
    if (button) button.disabled = true;

    const openCamera = async (front) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: front ? "user" : "environment" } },
      });
      return stream.getVideoTracks()[0];
    };

    const wasFront = this.isFrontCamera;
    const videoSender = this.peerConnection
      ? this.peerConnection
          .getSenders()
          .find((s) => s.track && s.track.kind === "video")
      : null;
    oldTrack.stop();
    this.localStream.removeTrack(oldTrack);

    let newTrack = null;
    try {
      newTrack = await openCamera(!wasFront);
      this.isFrontCamera = !wasFront;
    } catch (error) {
      console.error(
        "❌ Caméra " + (wasFront ? "arrière" : "avant") + " indisponible :",
        error,
      );
      try {
        newTrack = await openCamera(wasFront);
      } catch (restoreError) {
        console.error(
          "❌ Impossible de rouvrir la caméra d'origine :",
          restoreError,
        );
      }
    }

    try {
      if (newTrack) {
        newTrack.enabled = !this.isCameraOff;
        this.localStream.addTrack(newTrack);

        if (videoSender) await videoSender.replaceTrack(newTrack);
      }
    } catch (error) {
      console.error("❌ Erreur remplacement piste vidéo :", error);
    }

    const localVideo = document.getElementById("local-video");
    if (localVideo) {
      localVideo.srcObject = this.localStream;
      localVideo.play().catch(() => {});
    }
    if (this.isIOS() && cordova.plugins && cordova.plugins.iosrtc) {
      cordova.plugins.iosrtc.refreshVideos();
    }

    this.isSwitchingCamera = false;
    if (button) button.disabled = false;
  };

  updateCameraIcon = () => {
    const cameraIcon = document.getElementById("camera-icon");
    const btn = document.getElementById("btn-toggle-camera");

    if (this.isCameraOff) {
      if (cameraIcon) cameraIcon.className = "fa-solid fa-video-slash";
      if (btn) btn.classList.add("disabled");
    } else {
      if (cameraIcon) cameraIcon.className = "fa-solid fa-video";
      if (btn) btn.classList.remove("disabled");
    }
  };

  showLocalVideoPlaceholder = (show) => {
    const placeholder = document.getElementById("local-video-placeholder");
    if (placeholder) placeholder.style.display = show ? "flex" : "none";
  };

  /* =========================================================
   APPEL ENTRANT DÉCLENCHÉ NATIVEMENT
========================================================= */

  onNativeIncomingCall = (callId, from, isVideo, autoAnswer = false) => {
    console.log(
      "📲 Appel entrant natif :",
      callId,
      from,
      isVideo,
      "autoAnswer:",
      autoAnswer,
    );

    if (!this.appReady) {
      console.log("⏳ App pas encore prête, appel natif mis en attente");
      this.pendingNativeCall = { callId, from, isVideo, autoAnswer };
      return;
    }

    this.processIncomingCall(callId, from, isVideo, autoAnswer);
  };

  processIncomingCall = (callId, from, isVideo, autoAnswer = false) => {
    if (this.peerConnection) {
      console.log("Appel déjà en cours, appel natif ignoré");
      return;
    }

    if (!this.interfaceReceiver)
      this.interfaceReceiver = document.getElementById("interface-2");
    if (!this.interfaceSender)
      this.interfaceSender = document.getElementById("interface-1");
    if (!this.interfaceVideo)
      this.interfaceVideo = document.getElementById("interface-3");

    this.currentCallId = callId;
    this.targetUserId = from;
    this.isVideoCall = !!isVideo;
    this.autoAcceptOnOffer = !!autoAnswer;

    if (this.autoAcceptOnOffer) {
      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );
      this.updateStatus("Connexion à l'appel...");
    } else {
      this.showInterface(this.interfaceReceiver);
      this.updateStatus(
        this.isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...",
      );
      this.startVibration();
    }

    this.ensureConnectedAndFetchOffer();
  };

  /* =========================================================
   VIBRATION
    =========================================================
 */

  startVibration = () => {
    if (!("vibrate" in navigator)) return;

    this.isVibrating = true;
    const triggerContinuousVibration = () => {
      if (!this.isVibrating) return;
      navigator.vibrate([1000, 1000]);
      this.vibrationTimer = setTimeout(triggerContinuousVibration, 2000);
    };
    triggerContinuousVibration();
  };

  stopVibration = () => {
    this.isVibrating = false;
    if (this.vibrationTimer) {
      clearTimeout(this.vibrationTimer);
      this.vibrationTimer = null;
    }
    if ("vibrate" in navigator) {
      navigator.vibrate(0);
    }
  };

  /* =========================================================
   OPTION INTERFACE APPEL (VIDÉO DÉPLAÇABLE)
========================================================= */

  setupDraggableVideo = () => {
    const wrapper = document.querySelector(".local-video-wrapper");
    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    if (!wrapper) return;

    // position:fixed uniquement dans showInterface(vidéo) — pas au load
    // sinon rectangle / écran noir après hangUp
    wrapper.style.touchAction = "none";

    // ⚠️ iosrtc rend <video> via une vue native placée par-dessus/derrière la WebView, dont la
    // position/taille ne sont recalculées QUE sur appel explicite à refreshVideos() (aucun
    // observateur interne ne suit un déplacement du wrapper par simple style.left/top — voir
    // this.showInterface() plus haut). Sans ça, ce bloc ne fait bouger que le fond/la bordure CSS du
    // wrapper : la vidéo elle-même reste figée à sa position d'origine.
    let refreshScheduled = false;
    // ✅ FIX : arrow function pour que this → CallManager (function classique = this → window → crash)
    const refreshLocalVideoNative = () => {
      if (
        this.isIOS() &&
        window.cordova &&
        cordova.plugins &&
        cordova.plugins.iosrtc
      ) {
        cordova.plugins.iosrtc.refreshVideos();
      }
    };
    const scheduleNativeRefresh = () => {
      if (refreshScheduled) return;
      refreshScheduled = true;
      requestAnimationFrame(() => {
        refreshScheduled = false;
        refreshLocalVideoNative();
      });
    };

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

      scheduleNativeRefresh();
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

      // Le snap est animé (transition CSS) : la vidéo native doit suivre à l'arrivée, pas au
      // point de départ. transitionend est le signal fiable ; le setTimeout couvre le cas où il
      // ne se déclenche pas (ex. prefers-reduced-motion).
      wrapper.addEventListener("transitionend", refreshLocalVideoNative, {
        once: true,
      });
      setTimeout(refreshLocalVideoNative, 250);
    }

    function swapVideos() {
      // Caméra locale coupée -> localVideo.srcObject est volontairement détaché (voir
      // this.toggleCamera()) : rien de significatif à échanger, et swapper enverrait "null" dans
      // remote-video (écran principal), effaçant l'image de l'interlocuteur.
      if (!localVideo || !remoteVideo || !localVideo.srcObject) return;
      const tmp = localVideo.srcObject;
      localVideo.srcObject = remoteVideo.srcObject;
      remoteVideo.srcObject = tmp;
      localVideo.play().catch(() => {});
      remoteVideo.play().catch(() => {});
      refreshLocalVideoNative();
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
  };
}

/* =========================================================
   INSTANCIATION ET EXPOSITIONS GLOBALES
   (compatibilité avec les attributs onclick="..." du HTML)
========================================================= */

const callManager = new CallManager();
window.callManager = callManager;

window.makeCall = callManager.makeCall;
window.acceptCall = callManager.acceptCall;
window.rejectCall = callManager.rejectCall;
window.hangUp = callManager.hangUp;
window.closeInterfaces = callManager.closeInterface;
window.connectWebSocket = callManager.connectWebSocket;
window.toggleMicrophone = callManager.toggleMicrophone;
window.makeVideoCall = callManager.makeVideoCall;
window.toggleCamera = callManager.toggleCamera;
window.switchCamera = callManager.switchCamera;
window.onNativeIncomingCall = callManager.onNativeIncomingCall;
window.upgradeToVideo = callManager.upgradeToVideo;
window.toggleAudioRouteMenu = callManager.toggleAudioRouteMenu;
window.toggleSpeaker = callManager.toggleSpeaker;
window.toggleScreenLog = callManager.toggleScreenLog;
window.clearScreenLog = callManager.clearScreenLog;
window.showLocalStorageOnScreen = callManager.showLocalStorageOnScreen;

// Helpers écran d'accueil (index.html)
window.copyMyId = () => {
  const id = (window.callManager && callManager.myId) || localStorage.getItem("app_user_id") || "";
  if (!id) {
    alert("ID non encore généré.");
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(
      () => alert("ID copié : " + id),
      () => prompt("Copiez votre ID :", id),
    );
  } else {
    prompt("Copiez votre ID :", id);
  }
};

window.disconnectWebSocket = () => {
  if (!window.callManager) return;
  callManager.manuallyClosed = true;
  callManager.stopHeartbeat();
  clearTimeout(callManager.reconnectTimer);
  if (callManager.wsId != null) {
    try {
      CordovaWebsocketPlugin.wsClose(callManager.wsId, 1000, "Manual disconnect");
    } catch (e) {}
    callManager.wsId = null;
  }
  callManager.wsReadyState = WebSocket.CLOSED;
  callManager.updateStatus("Hors ligne");
};