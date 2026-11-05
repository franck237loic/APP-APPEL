/**
 * ============================================
 *  RÉUNIONS PLANIFIÉES - EXTENSION CALLMANAGER
 * ============================================
 * 
 * Ce fichier étend CallManager avec les fonctionnalités de réunions planifiées.
 * Il doit être inclus après CallManager.js dans index.html
 */

// ===== HANDLERS DES MESSAGES SERVEUR (réunions) =====
// Ces méthodes sont ajoutées à CallManager.prototype

CallManager.prototype.normalizeMeetingCode = function(code) {
  if (!code && code !== 0) return "";
  const cleaned = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 9)}`;
  }
  if (cleaned.length === 11) {
    return cleaned.replace(/(.{3})(?=.)/g, "$1-");
  }
  return cleaned;
};

CallManager.prototype.handleMeetingCreated = function(data) {
  console.log("📅 [MEETING] Réunion créée:", data);
  this.showMeetingCreatedView(data);
};

CallManager.prototype.handleMeetingLiveReady = function(data) {
  console.log("📅 [MEETING] Réunion maintenant live:", data);
  // Plus besoin de rejoindre automatiquement - le créateur rejoint comme les autres
  // en utilisant son code ou lien
};

CallManager.prototype.handleMeetingJoined = async function(data) {
  console.log("📅 [MEETING] Réunion jointe, salle live:", data.roomId);
  this.closeMeetingWaitingView();

  // Marquer que c'est une réunion planifiée pour empêcher la bascule automatique
  // vers l'écran 1-à-1 lorsqu'il ne reste qu'un autre participant dans la salle.
  this.groupIsMeeting = true;
  this.groupDowngradingToOneToOne = false;
  this.groupRoomId = data.roomId;
  this.groupIsVideo = !!data.isVideo;

  // Stocker les infos de la réunion
  this.currentMeetingTitle = data.title || "Réunion";
  this.currentMeetingId = data.meetingId;

  // Le flux de réunion doit avoir les médias du groupe prêts avant d'ouvrir
  // la salle live et d'envoyer le group-join. Sans cela le client se retrouve
  // avec un roster mais sans peer WebRTC réel, ce qui provoque la fausse
  // sensation "personne présente" alors qu'un participant est en attente.
  if (!this.groupLocalStream) {
    try {
      await this.acquireGroupMedia(this.groupIsVideo);
    } catch (error) {
      console.error("❌ [MEETING] Impossible d'acquérir les médias de la réunion:", error);
      this.showCallToast("Accès média impossible");
      this.groupIsMeeting = false;
      return;
    }
  }

  // Préparer le roster temporaire
  this.groupRoster = [{ userId: this.myId, state: "JOINED" }];

  // Enchaîner sur l'appel de groupe existant
  this.sendSignal({
    type: "group-join",
    roomId: data.roomId,
  });

  // Afficher l'écran de réunion spécifique (Google Meet style)
  this.showMeetingScreen(data);
};

CallManager.prototype.handleMeetingWaiting = function(data) {
  console.log("📅 [MEETING] Réunion en attente, temps restant:", data.waitTimeMin, "min");

  // Stocker les données pour l'auto-join
  this.meetingPendingCode = data.code;
  this.meetingPendingMeetingId = data.meetingId;

  // Calculer le décalage d'horloge
  if (data.serverNow) {
    this.clockOffset = data.serverNow - Date.now();
    console.log("🕐 Décalage d'horloge:", this.clockOffset, "ms");
  }

  this.showMeetingWaitingView(data);
};

CallManager.prototype.handleMeetingHostStarted = function(data) {
  console.log("📅 [MEETING] L'hôte a démarré la réunion:", data.hostId);
  this.showCallToast("L'hôte a démarré la réunion");

  // Fermer la salle d'attente
  this.closeMeetingWaitingView();

  // Rejoindre automatiquement
  if (this.meetingPendingCode) {
    this.joinMeeting(this.meetingPendingCode);
  }
};

CallManager.prototype.handleMeetingError = function(data) {
  console.error("📅 [MEETING] Erreur:", data.reason);
  this.showCallToast("Erreur: " + data.reason);
  this.closeMeetingWaitingView();
  this.closeMeetingCreatedView();
};

CallManager.prototype.handleMeetingHostStarted = function(data) {
  console.log("📅 [MEETING] L'hôte a démarré la réunion:", data.hostId);
  this.showCallToast("L'hôte a démarré la réunion");

  // Fermer la salle d'attente
  this.closeMeetingWaitingView();

  // Rejoindre automatiquement
  if (this.meetingPendingCode) {
    this.joinMeeting(this.meetingPendingCode);
  }
};

/**
 * Afficher l'écran de réunion (Google Meet style)
 */
CallManager.prototype.showMeetingScreen = function(data) {
  console.log("📅 [MEETING] Affichage écran de réunion:", data);

  if (this.meetingScreen) {
    this.meetingScreen.classList.add("active");
    return;
  }

  const html = `
    <div class="view-container meeting-screen" id="meeting-screen">
      <div class="meeting-container">
        <!-- Header de réunion -->
        <div class="meeting-header">
          <div class="meeting-info">
            <h1 class="meeting-title">${this.currentMeetingTitle}</h1>
            <div class="meeting-time">${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <div class="meeting-actions">
            <button class="meeting-action-btn" onclick="window.meetingParticipants.show('${this.currentMeetingId}', '${this.groupRoomId}', true)" title="Participants">
              <i class="fa-solid fa-users"></i>
              <span id="participant-count">1</span>
            </button>
            <button class="meeting-action-btn" onclick="window.meetingChat.show('${this.currentMeetingId}', '${this.groupRoomId}')" title="Chat">
              <i class="fa-solid fa-comment"></i>
            </button>
            <button class="meeting-action-btn" onclick="window.copyMeetingCode('${this.meetingPendingCode || ''}')" title="Code">
              <i class="fa-solid fa-key"></i>
            </button>
          </div>
        </div>

        <!-- Zone vidéo principale -->
        <div class="meeting-video-area" id="meeting-video-area">
          <div class="video-grid" id="meeting-video-grid">
            <!-- Votre vidéo -->
            <div class="video-tile self" id="self-video-tile">
              <video id="meeting-local-video" autoplay muted playsinline></video>
              <div class="video-tile-info">
                <span class="user-name">Vous</span>
                <span class="user-badge">Hôte</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Barre de contrôle (bas) -->
        <div class="meeting-controls">
          <div class="meeting-time-display" id="meeting-time-display">
            00:00:00
          </div>
          <div class="meeting-control-buttons">
            <button class="meeting-control-btn" id="meeting-mic-btn" onclick="window.toggleMeetingMic()">
              <i class="fa-solid fa-microphone"></i>
            </button>
            <button class="meeting-control-btn" id="meeting-cam-btn" onclick="window.toggleMeetingCam()">
              <i class="fa-solid fa-video"></i>
            </button>
            <button class="meeting-control-btn" id="meeting-hand-btn" onclick="window.toggleMeetingHand()">
              <i class="fa-solid fa-hand"></i>
            </button>
            <button class="meeting-control-btn" id="meeting-reaction-btn" onclick="window.showMeetingReactions()">
              <i class="fa-solid fa-face-smile"></i>
            </button>
            <button class="meeting-control-btn meeting-hangup" onclick="window.leaveMeeting()">
              <i class="fa-solid fa-phone-slash"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingScreen = document.getElementById("meeting-screen");
  this.meetingScreen.classList.add("active");

  // Attacher la vidéo locale
  this.attachMeetingLocalVideo();

  // Démarrer le timer de réunion
  this.startMeetingTimer();
};

/**
 * Attacher la vidéo locale à l'écran de réunion
 */
CallManager.prototype.attachMeetingLocalVideo = function() {
  const localVideo = document.getElementById("meeting-local-video");
  if (localVideo && this.groupLocalStream) {
    localVideo.srcObject = this.groupLocalStream;
  }
};

/**
 * Démarrer le timer de réunion
 */
CallManager.prototype.startMeetingTimer = function() {
  this.meetingStartTime = Date.now();

  if (this.meetingTimerInterval) {
    clearInterval(this.meetingTimerInterval);
  }

  this.meetingTimerInterval = setInterval(() => {
    const elapsed = Date.now() - this.meetingStartTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    const timeDisplay = document.getElementById("meeting-time-display");
    if (timeDisplay) {
      timeDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  }, 1000);
};

/**
 * Arrêter le timer de réunion
 */
CallManager.prototype.stopMeetingTimer = function() {
  if (this.meetingTimerInterval) {
    clearInterval(this.meetingTimerInterval);
    this.meetingTimerInterval = null;
  }
};

/**
 * Fermer l'écran de réunion
 */
CallManager.prototype.closeMeetingScreen = function() {
  this.stopMeetingTimer();

  if (this.meetingScreen) {
    this.meetingScreen.classList.remove("active");
    setTimeout(() => {
      if (this.meetingScreen) {
        this.meetingScreen.remove();
        this.meetingScreen = null;
      }
    }, 300);
  }
};

/**
 * Basculer le microphone (réunion)
 */
CallManager.prototype.toggleMeetingMic = function() {
  const btn = document.getElementById("meeting-mic-btn");
  if (!btn) return;

  const isEnabled = this.isGroupMicEnabled !== false;

  if (isEnabled) {
    this.disableGroupMicrophone();
    btn.classList.remove("active");
    btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
  } else {
    this.enableGroupMicrophone();
    btn.classList.add("active");
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
  }
  this.isGroupMicEnabled = !isEnabled;
};

/**
 * Basculer la caméra (réunion)
 */
CallManager.prototype.toggleMeetingCam = function() {
  const btn = document.getElementById("meeting-cam-btn");
  if (!btn) return;

  const isEnabled = this.isGroupCamEnabled !== false;

  if (isEnabled) {
    this.disableGroupCamera();
    btn.classList.remove("active");
    btn.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
  } else {
    this.enableGroupCamera();
    btn.classList.add("active");
    btn.innerHTML = '<i class="fa-solid fa-video"></i>';
  }
  this.isGroupCamEnabled = !isEnabled;
};

/**
 * Lever la main
 */
CallManager.prototype.toggleMeetingHand = function() {
  const btn = document.getElementById("meeting-hand-btn");
  if (!btn) return;

  if (this.handRaised) {
    btn.classList.remove("active");
    this.handRaised = false;
    // TODO: Envoyer signal au serveur
  } else {
    btn.classList.add("active");
    this.handRaised = true;
    // TODO: Envoyer signal au serveur
  }
};

/**
 * Afficher les réactions
 */
CallManager.prototype.showMeetingReactions = function() {
  // TODO: Implémenter le panel de réactions
  this.showCallToast("Réactions bientôt disponibles");
};

/**
 * Quitter la réunion
 */
CallManager.prototype.leaveMeeting = function() {
  if (confirm("Voulez-vous vraiment quitter la réunion?")) {
    this.closeMeetingScreen();
    this.endGroupCall();
  }
};

/**
 * Ouvrir le panel participants
 */
window.showMeetingParticipants = function() {
  if (window.callManager && window.meetingParticipants) {
    const meetingId = window.callManager.currentMeetingId;
    const roomId = window.callManager.groupRoomId;
    const isHost = true; // TODO: Vérifier si l'utilisateur est l'hôte
    window.meetingParticipants.show(meetingId, roomId, isHost);
  }
};

/**
 * Ouvrir le panel chat
 */
window.showMeetingChat = function() {
  if (window.callManager && window.meetingChat) {
    const meetingId = window.callManager.currentMeetingId;
    const roomId = window.callManager.groupRoomId;
    window.meetingChat.show(meetingId, roomId);
  }
};

CallManager.prototype.handleMeetingCancelled = function(data) {
  console.log("📅 [MEETING] Réunion annulée:", data.meetingId);
  this.showCallToast("Réunion annulée");
  this.closeMeetingCreatedView();
};

CallManager.prototype.handleMeetingList = function(data) {
  console.log("📅 [MEETING] Liste reçue:", data.upcoming.length, "à venir,", data.past.length, "passées");
  this.showMeetingListView(data);
};

CallManager.prototype.handleMeetingEnded = function(data) {
  console.log("📅 [MEETING] Réunion terminée:", data.meetingId, "raison:", data.reason);
  this.showCallToast("Réunion terminée: " + data.reason);
  this.closeMeetingWaitingView();
  this.closeMeetingCreatedView();
  this.closeMeetingScreen();
  // Fermer l'écran d'appel de groupe si actif
  if (this.groupRoomId) {
    this.endGroupCall();
  }
};

// ===== UI LISTE DES RÉUNIONS =====

CallManager.prototype.showMeetingListView = function(data) {
  if (this.meetingListView) {
    this.meetingListView.classList.add("active");
    this._renderMeetingList(data);
    return;
  }

  const html = `
    <div class="view-container meeting-list-view" id="meeting-list-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingListView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">Mes réunions</div>
          </div>
          <button class="icon-btn-top" onclick="window.createMeetingFromList()">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>

        <div style="flex: 1; width: 100%; overflow-y: auto; padding: 0 16px;">
          <div id="meeting-list-content"></div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingListView = document.getElementById("meeting-list-view");
  this.meetingListView.classList.add("active");

  this._renderMeetingList(data);
};

CallManager.prototype._renderMeetingList = function(data) {
  const content = document.getElementById("meeting-list-content");
  if (!content) return;

  let html = "";

  // Réunions à venir
  if (data.upcoming && data.upcoming.length > 0) {
    html += `<div style="margin-top: 16px;">
      <div style="color: #8696a0; font-size: 13px; margin-bottom: 12px; padding-left: 8px;">À venir</div>`;

    data.upcoming.forEach(meeting => {
      const date = new Date(meeting.scheduledAt);
      const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      html += `
        <div style="background: #222d34; border-radius: 12px; padding: 16px; margin-bottom: 12px; cursor: pointer;"
             onclick="window.openMeetingDetails('${meeting.id}')">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-size: 16px; font-weight: 500; color: white; margin-bottom: 4px;">${meeting.title}</div>
              <div style="font-size: 13px; color: #8696a0;">${dateStr} à ${timeStr}</div>
            </div>
            <div style="background: ${meeting.isVideo ? '#00a884' : '#374045'}; padding: 4px 8px; border-radius: 6px; font-size: 11px; color: white;">
              ${meeting.isVideo ? 'Vidéo' : 'Audio'}
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button onclick="event.stopPropagation(); window.startMeetingFromList('${meeting.code}')"
                    style="flex: 1; padding: 10px; background: #00a884; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer;">
              Démarrer
            </button>
            <button onclick="event.stopPropagation(); window.copyMeetingCode('${meeting.code}')"
                    style="padding: 10px 16px; background: #374045; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer;">
              <i class="fa-solid fa-copy"></i>
            </button>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  // Réunions passées
  if (data.past && data.past.length > 0) {
    html += `<div style="margin-top: 16px;">
      <div style="color: #8696a0; font-size: 13px; margin-bottom: 12px; padding-left: 8px;">Passées</div>`;

    data.past.forEach(meeting => {
      const date = new Date(meeting.scheduledAt);
      const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      const statusColors = {
        ended: '#8696a0',
        cancelled: '#ef5350'
      };
      const statusLabels = {
        ended: 'Terminée',
        cancelled: 'Annulée'
      };

      html += `
        <div style="background: #1f2c33; border-radius: 12px; padding: 16px; margin-bottom: 12px; opacity: 0.7;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-size: 16px; font-weight: 500; color: white; margin-bottom: 4px;">${meeting.title}</div>
              <div style="font-size: 13px; color: #8696a0;">${dateStr} à ${timeStr}</div>
            </div>
            <div style="background: ${statusColors[meeting.status] || '#374045'}; padding: 4px 8px; border-radius: 6px; font-size: 11px; color: white;">
              ${statusLabels[meeting.status] || meeting.status}
            </div>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  // Liste vide
  if (!data.upcoming || data.upcoming.length === 0) {
    html += `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 40px 16px;">
        <i class="fa-solid fa-calendar-plus" style="font-size: 48px; color: #374045;"></i>
        <div style="text-align: center; color: #8696a0; font-size: 14px;">
          Aucune réunion à venir
        </div>
        <button onclick="window.createMeetingFromList()"
                style="padding: 12px 24px; background: #00a884; border: none; border-radius: 20px; color: white; font-size: 15px; cursor: pointer;">
          Créer une réunion
        </button>
      </div>
    `;
  }

  content.innerHTML = html;
};

CallManager.prototype.closeMeetingListView = function() {
  if (this.meetingListView) {
    this.meetingListView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingListView) {
        this.meetingListView.remove();
        this.meetingListView = null;
      }
    }, 300);
  }
};

CallManager.prototype.createMeetingFromList = function() {
  this.closeMeetingListView();
  this.showMeetingCreateView();
};

CallManager.prototype.startMeetingFromList = function(code) {
  this.closeMeetingListView();
  this.startMeeting(code);
};

CallManager.prototype.openMeetingDetails = function(meetingId) {
  // Ouvrir l'écran de modification
  this.showMeetingCreateView(meetingId);
};

// ===== MÉTHODES DE RÉUNION =====

CallManager.prototype.createMeeting = function(title, scheduledAt, durationMin, isVideo, participants, description = "") {
  console.log("📅 [MEETING] createMeeting appelé - wsReadyState:", this.wsReadyState, "wsId:", this.wsId);
  
  // Pour Cordova : utiliser wsReadyState, pour navigateur : utiliser ws.readyState
  const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
  
  if (!isConnected) {
    // Tenter de connecter automatiquement
    this.showCallToast("Connexion en cours...");
    console.log("📅 [MEETING] WebSocket non connecté, tentative de connexion...");
    
    this.connectWebSocket().then(() => {
      console.log("📅 [MEETING] Connexion terminée, nouvel état wsReadyState:", this.wsReadyState);
      
      // Attendre un peu pour s'assurer que la connexion est stable
      setTimeout(() => {
        const nowConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
        if (nowConnected) {
          console.log("📅 [MEETING] WebSocket maintenant connecté, création de réunion");
          this.createMeeting(title, scheduledAt, durationMin, isVideo, participants, description);
        } else {
          console.error("📅 [MEETING] WebSocket toujours non connecté après tentative");
          this.showCallToast("Impossible de se connecter au serveur (timeout)");
        }
      }, 1000);
    });
    
    return;
  }
  
  if (!this.myId) {
    this.showCallToast("ID utilisateur requis - veuillez patienter");
    return;
  }
  
  const scheduledAtTimestamp = new Date(scheduledAt).getTime();
  if (isNaN(scheduledAtTimestamp) || scheduledAtTimestamp <= Date.now()) {
    this.showCallToast("Date invalide (doit être dans le futur)");
    return;
  }
  
  this.sendSignal({
    type: "meeting-create",
    title,
    description,
    scheduledAt: scheduledAtTimestamp,
    durationMin: parseInt(durationMin),
    isVideo: !!isVideo,
    participants: participants || [],
  });
  
  console.log("📅 [MEETING] Demande de création de réunion envoyée");
};

CallManager.prototype.joinMeeting = function(code) {
  console.log("📅 [MEETING] joinMeeting appelé - wsReadyState:", this.wsReadyState, "wsId:", this.wsId);
  
  const normalizedCode = this.normalizeMeetingCode(code);
  if (!normalizedCode) {
    this.showCallToast("Code requis");
    return;
  }

  // Stocker le code pour les réessais
  this.meetingPendingCode = normalizedCode;
  
  // Pour Cordova : utiliser wsReadyState, pour navigateur : utiliser ws.readyState
  const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
  
  if (!isConnected) {
    // Tenter de connecter automatiquement
    this.showCallToast("Connexion en cours...");
    console.log("📅 [MEETING] WebSocket non connecté, tentative de connexion...");
    
    this.connectWebSocket().then(() => {
      console.log("📅 [MEETING] Connexion terminée, nouvel état wsReadyState:", this.wsReadyState);
      
      // Attendre un peu pour s'assurer que la connexion est stable
      setTimeout(() => {
        const nowConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
        if (nowConnected) {
          console.log("📅 [MEETING] WebSocket maintenant connecté, tentative de rejoindre");
          this.joinMeeting(this.meetingPendingCode);
        } else {
          console.error("📅 [MEETING] WebSocket toujours non connecté après tentative");
          this.showCallToast("Impossible de se connecter au serveur (timeout)");
        }
      }, 1000);
    });
    
    return;
  }
  
  if (!this.myId) {
    this.showCallToast("ID utilisateur requis - veuillez patienter");
    return;
  }
  
  this.sendSignal({
    type: "meeting-join",
    code: this.meetingPendingCode,
  });
  
  console.log("📅 [MEETING] Demande de rejoindre réunion envoyée pour code:", this.meetingPendingCode);
};

CallManager.prototype.cancelMeeting = function(meetingId) {
  const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
  if (!isConnected) {
    this.showCallToast("Connexion requise");
    return;
  }
  
  this.sendSignal({
    type: "meeting-cancel",
    meetingId,
  });
  
  console.log("📅 [MEETING] Demande d'annulation envoyée pour:", meetingId);
};

CallManager.prototype.listMeetings = function() {
  const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
  if (!isConnected) {
    this.showCallToast("Connexion requise");
    return;
  }
  
  this.sendSignal({
    type: "meeting-list",
  });
  
  console.log("📅 [MEETING] Demande de liste de réunions envoyée");
};

// ===== UI RÉUNIONS =====

CallManager.prototype.showMeetingCreateView = function(editMeetingId = null) {
  this.editingMeetingId = editMeetingId;
  
  if (this.meetingCreateView) {
    this.meetingCreateView.classList.add("active");
    if (editMeetingId) {
      this.loadMeetingForEdit(editMeetingId);
    }
    return;
  }
  
  const html = `
    <div class="view-container meeting-create-view" id="meeting-create-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingCreateView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">${editMeetingId ? 'Modifier la réunion' : 'Programmer une réunion'}</div>
          </div>
          <div style="width: 40px;"></div>
        </div>
        
        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; gap: 20px; padding: 0 16px; overflow-y: auto;">
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Titre *</label>
            <input type="text" id="meeting-title" placeholder="Ex: Réunion d'équipe" maxlength="100"
                   style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045; 
                          border-radius: 8px; color: white; font-size: 15px; outline: none;">
          </div>
          
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Description (optionnel)</label>
            <textarea id="meeting-description" placeholder="Ajoutez une description..."
                      style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045; 
                             border-radius: 8px; color: white; font-size: 15px; outline: none; resize: vertical; min-height: 80px;"></textarea>
          </div>
          
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Mode de réunion</label>
            <div style="display: flex; gap: 10px;">
              <button id="meeting-mode-scheduled" class="meeting-type-btn active" onclick="window.selectMeetingMode('scheduled')">
                <i class="fa-solid fa-calendar"></i>
                <span>Planifiée</span>
              </button>
              <button id="meeting-mode-instant" class="meeting-type-btn" onclick="window.selectMeetingMode('instant')">
                <i class="fa-solid fa-bolt"></i>
                <span>Immédiate</span>
              </button>
            </div>
          </div>

          <div id="datetime-container">
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Date et heure *</label>
            <input type="datetime-local" id="meeting-datetime"
                   style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045;
                          border-radius: 8px; color: white; font-size: 15px; outline: none;">
          </div>
          
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Durée (minutes) *</label>
            <select id="meeting-duration" 
                    style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045; 
                           border-radius: 8px; color: white; font-size: 15px; outline: none; cursor: pointer;">
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60" selected>1 heure</option>
              <option value="90">1 heure 30</option>
              <option value="120">2 heures</option>
              <option value="180">3 heures</option>
              <option value="240">4 heures</option>
              <option value="480">8 heures</option>
            </select>
          </div>
          
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Type</label>
            <div style="display: flex; gap: 10px;">
              <button id="meeting-type-audio" class="meeting-type-btn" onclick="window.selectMeetingType('audio')">
                <i class="fa-solid fa-phone"></i>
                <span>Audio</span>
              </button>
              <button id="meeting-type-video" class="meeting-type-btn active" onclick="window.selectMeetingType('video')">
                <i class="fa-solid fa-video"></i>
                <span>Vidéo</span>
              </button>
            </div>
          </div>
          
          <div id="edit-actions" style="display: none; gap: 8px;">
            <button onclick="window.cancelMeeting()" 
                    style="flex: 1; padding: 12px; background: #ef5350; border: none; border-radius: 20px; 
                           color: white; font-size: 15px; font-weight: 500; cursor: pointer;">
              Annuler la réunion
            </button>
          </div>
        </div>
        
        <div style="width: 100%; padding: 0 16px;">
          <button onclick="window.confirmCreateMeeting()" 
                  style="width: 100%; padding: 14px; background: #00a884; border: none; border-radius: 24px; 
                         color: white; font-size: 16px; font-weight: 500; cursor: pointer;">
            ${editMeetingId ? 'Enregistrer les modifications' : 'Créer la réunion'}
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingCreateView = document.getElementById("meeting-create-view");
  this.meetingCreateView.classList.add("active");
  
  // Date par défaut (demain à 9h)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
  document.getElementById("meeting-datetime").value = tomorrow.toISOString().slice(0, 16);
  
  // Charger si édition
  if (editMeetingId) {
    this.loadMeetingForEdit(editMeetingId);
  }
};

CallManager.prototype.loadMeetingForEdit = async function(meetingId) {
  try {
    if (window.meetingService) {
      const meeting = await meetingService.loadMeetingById(meetingId);
      
      document.getElementById("meeting-title").value = meeting.title || "";
      document.getElementById("meeting-description").value = meeting.description || "";
      
      const date = new Date(meeting.scheduledAt);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      document.getElementById("meeting-datetime").value = date.toISOString().slice(0, 16);
      
      document.getElementById("meeting-duration").value = meeting.durationMin || 60;
      
      this.selectMeetingType(meeting.isVideo ? "video" : "audio");
      
      document.getElementById("edit-actions").style.display = "flex";
    }
  } catch (error) {
    console.error("Erreur chargement réunion pour édition:", error);
    this.showCallToast("Erreur lors du chargement");
  }
};

CallManager.prototype.closeMeetingCreateView = function() {
  if (this.meetingCreateView) {
    this.meetingCreateView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingCreateView) {
        this.meetingCreateView.remove();
        this.meetingCreateView = null;
      }
    }, 300);
  }
};

CallManager.prototype.selectMeetingType = function(type) {
  const audioBtn = document.getElementById("meeting-type-audio");
  const videoBtn = document.getElementById("meeting-type-video");

  if (type === "audio") {
    audioBtn.classList.add("active");
    videoBtn.classList.remove("active");
  } else {
    videoBtn.classList.add("active");
    audioBtn.classList.remove("active");
  }
};

CallManager.prototype.selectMeetingMode = function(mode) {
  const scheduledBtn = document.getElementById("meeting-mode-scheduled");
  const instantBtn = document.getElementById("meeting-mode-instant");
  const datetimeContainer = document.getElementById("datetime-container");

  if (mode === "scheduled") {
    scheduledBtn.classList.add("active");
    instantBtn.classList.remove("active");
    datetimeContainer.style.display = "block";
  } else {
    instantBtn.classList.add("active");
    scheduledBtn.classList.remove("active");
    datetimeContainer.style.display = "none";
  }
};

CallManager.prototype.confirmCreateMeeting = async function() {
  const title = document.getElementById("meeting-title").value.trim();
  const description = document.getElementById("meeting-description").value.trim();
  const duration = document.getElementById("meeting-duration").value;
  const isVideo = document.getElementById("meeting-type-video").classList.contains("active");
  const isInstant = document.getElementById("meeting-mode-instant").classList.contains("active");

  if (!title) {
    this.showCallToast("Veuillez entrer un titre");
    return;
  }

  if (!duration || duration < 15 || duration > 480) {
    this.showCallToast("Durée invalide (15-480 minutes)");
    return;
  }

  let scheduledAtTimestamp;
  let datetime;

  if (isInstant) {
    // Réunion immédiate: commencer dans 5 secondes
    scheduledAtTimestamp = Date.now() + 5000;
    datetime = new Date(scheduledAtTimestamp).toISOString();
  } else {
    // Réunion planifiée: date requise
    datetime = document.getElementById("meeting-datetime").value;
    if (!datetime) {
      this.showCallToast("Veuillez sélectionner une date et heure");
      return;
    }

    scheduledAtTimestamp = new Date(datetime).getTime();
    if (isNaN(scheduledAtTimestamp) || scheduledAtTimestamp <= Date.now() + 60000) {
      this.showCallToast("Date invalide (doit être dans le futur, au moins 1 minute)");
      return;
    }
  }

  // Mode édition
  if (this.editingMeetingId) {
    try {
      const updates = {
        title,
        description,
        scheduledAt: scheduledAtTimestamp,
        durationMin: parseInt(duration),
        isVideo,
        userId: this.myId
      };

      await meetingService.updateMeeting(this.editingMeetingId, updates);
      this.showCallToast("Réunion modifiée avec succès");
      this.closeMeetingCreateView();
      this.editingMeetingId = null;
    } catch (error) {
      console.error("Erreur modification réunion:", error);
      this.showCallToast("Erreur lors de la modification");
    }
    return;
  }

  // Mode création
  this.createMeeting(title, datetime, duration, isVideo, [], description);
  this.closeMeetingCreateView();

  // Si réunion immédiate, attendre un peu puis rejoindre automatiquement
  if (isInstant) {
    setTimeout(() => {
      this.showCallToast("Réunion créée, jonction automatique...");
    }, 1000);
  }
};

CallManager.prototype.cancelMeeting = async function() {
  if (!this.editingMeetingId) return;
  
  if (confirm("Êtes-vous sûr de vouloir annuler cette réunion ?")) {
    try {
      await this.cancelMeetingById(this.editingMeetingId);
      this.showCallToast("Réunion annulée");
      this.closeMeetingCreateView();
      this.editingMeetingId = null;
      
      // Rafraîchir la liste si affichée
      if (this.meetingListView) {
        this.listMeetings();
      }
    } catch (error) {
      console.error("Erreur annulation réunion:", error);
      this.showCallToast("Erreur lors de l'annulation");
    }
  }
};

CallManager.prototype.showMeetingCreatedView = function(data) {
  if (this.meetingCreatedView) {
    this.meetingCreatedView.classList.add("active");
    return;
  }
  
  const html = `
    <div class="view-container meeting-created-view" id="meeting-created-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingCreatedView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">Réunion créée</div>
          </div>
          <div style="width: 40px;"></div>
        </div>
        
        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 15px; padding: 0 16px; overflow-y: auto;">
          <div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(145deg, #00a884, #008f6f); 
                     display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <i class="fa-solid fa-calendar-check" style="font-size: 35px; color: white;"></i>
          </div>
          
          <div style="text-align: center;">
            <div style="font-size: 18px; font-weight: 500; color: white; margin-bottom: 4px;">${data.title}</div>
            <div style="font-size: 12px; color: #8696a0;">
              ${new Date(data.scheduledAt).toLocaleString('fr-FR', { 
                weekday: 'short', 
                day: 'numeric', 
                month: 'short', 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </div>
            <div style="font-size: 12px; color: #8696a0; margin-top: 2px;">
              Durée: ${data.durationMin} min • ${data.isVideo ? 'Vidéo' : 'Audio'}
            </div>
          </div>
          
          <div style="background: #222d34; padding: 12px; border-radius: 10px; width: 100%; text-align: center;">
            <div style="font-size: 11px; color: #8696a0; margin-bottom: 6px;">Code de la réunion</div>
            <div style="font-size: 22px; font-weight: 600; color: #00a884; letter-spacing: 2px; margin-bottom: 8px;">
              ${data.code}
            </div>
            <button onclick="window.copyMeetingCode('${data.code}')" 
                    style="padding: 8px 16px; background: #374045; border: none; border-radius: 16px; 
                           color: white; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-copy"></i>
              Copier
            </button>
          </div>
          
          <div style="background: #222d34; padding: 12px; border-radius: 10px; width: 100%; text-align: center;">
            <div style="font-size: 11px; color: #8696a0; margin-bottom: 6px;">Lien de partage</div>
            <div style="font-size: 12px; color: white; word-break: break-all; margin-bottom: 8px; padding: 6px; background: #1f2c33; border-radius: 6px;">
              ${data.link}
            </div>
            <button onclick="window.copyMeetingCode('${data.link}')" 
                    style="padding: 8px 16px; background: #374045; border: none; border-radius: 16px; 
                           color: white; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-copy"></i>
              Copier
            </button>
          </div>
          
          <div style="width: 100%; display: flex; flex-direction: column; gap: 8px;">
            <button onclick="window.startMeetingFromCreated('${data.code}')"
                    style="width: 100%; padding: 12px; background: #00a884; border: none; border-radius: 20px;
                           color: white; font-size: 15px; font-weight: 500; cursor: pointer; display: flex;
                           align-items: center; justify-content: center; gap: 8px;">
              <i class="fa-solid fa-play"></i>
              Démarrer maintenant
            </button>
            <button onclick="window.shareMeetingLink('${data.link}')"
                    style="width: 100%; padding: 12px; background: #374045; border: none; border-radius: 20px;
                           color: white; font-size: 15px; font-weight: 500; cursor: pointer; display: flex;
                           align-items: center; justify-content: center; gap: 8px;">
              <i class="fa-solid fa-share-nodes"></i>
              Partager
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingCreatedView = document.getElementById("meeting-created-view");
  this.meetingCreatedView.classList.add("active");
};

CallManager.prototype.closeMeetingCreatedView = function() {
  if (this.meetingCreatedView) {
    this.meetingCreatedView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingCreatedView) {
        this.meetingCreatedView.remove();
        this.meetingCreatedView = null;
      }
    }, 300);
  }
};

CallManager.prototype.copyMeetingCode = function(code) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(
      () => this.showCallToast("Code copié: " + code),
      () => this.showCallToast("Échec de la copie")
    );
  } else {
    prompt("Copiez le code:", code);
  }
};

CallManager.prototype.shareMeetingLink = function(link) {
  if (navigator.share) {
    navigator.share({
      title: "Rejoindre ma réunion",
      text: "Rejoins ma réunion via ce lien :",
      url: link,
    }).catch((err) => console.log("Share error:", err));
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(
      () => this.showCallToast("Lien copié"),
      () => this.showCallToast("Échec de la copie")
    );
  } else {
    prompt("Copiez le lien:", link);
  }
};

CallManager.prototype.startMeetingFromCreated = function(code) {
  this.closeMeetingCreatedView();
  this.startMeeting(code);
};

CallManager.prototype.startMeeting = function(code) {
  console.log("📅 [MEETING] startMeeting appelé pour code:", code);
  
  const cleanCode = this.normalizeMeetingCode(code);
  if (!cleanCode) {
    this.showCallToast("Code requis");
    return;
  }
  
  const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
  if (!isConnected) {
    this.showCallToast("Connexion requise");
    return;
  }

  // On marque immédiatement la réunion comme live côté client pour empêcher toute
  // rebasculer automatiquement en 1-à-1 tant que la confirmation serveur n'est pas revenue.
  this.groupIsMeeting = true;
  this.groupDowngradingToOneToOne = false;
  this.meetingPendingCode = cleanCode;
  this.sendSignal({
    type: "meeting-force-start",
    code: cleanCode,
  });
  
  console.log("📅 [MEETING] Demande de démarrage forcé pour:", cleanCode);
};

CallManager.prototype.showMeetingJoinView = function(prefillCode) {
  if (this.meetingJoinView) {
    this.meetingJoinView.classList.add("active");
    if (prefillCode) {
      const input = document.getElementById("meeting-code-input");
      if (input) input.value = prefillCode;
    }
    return;
  }
  
  const html = `
    <div class="view-container meeting-join-view" id="meeting-join-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingJoinView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">Rejoindre une réunion</div>
          </div>
          <div style="width: 40px;"></div>
        </div>
        
        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; padding: 0 16px;">
          <div style="width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(145deg, #2a3942, #1f2c33); 
                     display: flex; align-items: center; justify-content: center;">
            <i class="fa-solid fa-key" style="font-size: 50px; color: #8696a0;"></i>
          </div>
          
          <div style="width: 100%;">
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Code de la réunion</label>
            <input type="text" id="meeting-code-input" placeholder="ABC-123-XYZ" maxlength="11"
                   style="width: 100%; padding: 16px; background: #222d34; border: 1px solid #374045; 
                          border-radius: 12px; color: white; font-size: 20px; font-weight: 500; text-align: center; 
                          letter-spacing: 2px; text-transform: uppercase; outline: none;"
                   oninput="this.value = this.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')"
                   value="${prefillCode || ''}">
          </div>
          
          <div style="width: 100%;">
            <button onclick="window.confirmJoinMeeting()" 
                    style="width: 100%; padding: 14px; background: #00a884; border: none; border-radius: 24px; 
                           color: white; font-size: 16px; font-weight: 500; cursor: pointer;">
              Rejoindre
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingJoinView = document.getElementById("meeting-join-view");
  this.meetingJoinView.classList.add("active");
  
  setTimeout(() => {
    const input = document.getElementById("meeting-code-input");
    if (input) input.focus();
  }, 100);
};

CallManager.prototype.closeMeetingJoinView = function() {
  if (this.meetingJoinView) {
    this.meetingJoinView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingJoinView) {
        this.meetingJoinView.remove();
        this.meetingJoinView = null;
      }
    }, 300);
  }
};

// ===== ÉCRAN DE PRÉVISUALISATION (NOUVEAU) =====

CallManager.prototype.showMeetingPreviewView = async function(code) {
  if (this.meetingPreviewView) {
    this.meetingPreviewView.classList.add("active");
    return;
  }

  // Initialiser l'adaptateur média
  if (window.meetingMediaAdapter && window.callManager) {
    meetingMediaAdapter.initialize(window.callManager);
  }

  const html = `
    <div class="view-container meeting-preview-view" id="meeting-preview-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingPreviewView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">Prévisualisation</div>
          </div>
          <div style="width: 40px;"></div>
        </div>
        
        <div class="preview-container">
          <div class="meeting-info">
            <h2 id="preview-meeting-title">Chargement...</h2>
            <p id="preview-meeting-code">Code: ${code}</p>
            <div class="organizer" id="preview-meeting-organizer">
              <i class="fa-solid fa-user"></i>
              <span>Organisateur: --</span>
            </div>
          </div>
          
          <div class="preview-video" id="preview-video-container">
            <video id="preview-video" autoplay muted playsinline></video>
            <div class="avatar" id="preview-avatar" style="display: none;">
              <i class="fa-solid fa-user"></i>
            </div>
          </div>
          
          <div class="preview-controls">
            <button class="preview-control-btn active" id="preview-mic-btn" onclick="window.togglePreviewMic()">
              <i class="fa-solid fa-microphone"></i>
            </button>
            <button class="preview-control-btn active" id="preview-cam-btn" onclick="window.togglePreviewCam()">
              <i class="fa-solid fa-video"></i>
            </button>
          </div>
          
          <div class="device-selector" id="camera-selector-container" style="display: none;">
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Caméra</label>
            <select id="camera-select" onchange="window.selectCamera(this.value)">
              <option value="">Caméra par défaut</option>
            </select>
          </div>
          
          <div class="device-selector" id="mic-selector-container" style="display: none;">
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Microphone</label>
            <select id="mic-select" onchange="window.selectMicrophone(this.value)">
              <option value="">Microphone par défaut</option>
            </select>
          </div>
          
          <button class="join-button" id="join-meeting-btn" onclick="window.confirmJoinMeetingFromPreview('${code}')">
            Rejoindre la réunion
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingPreviewView = document.getElementById("meeting-preview-view");
  this.meetingPreviewView.classList.add("active");

  // Charger les infos de la réunion
  try {
    if (window.meetingService) {
      const meeting = await meetingService.loadMeetingByCode(code);
      document.getElementById("preview-meeting-title").textContent = meeting.title || "Réunion";
      document.getElementById("preview-meeting-organizer").innerHTML = `
        <i class="fa-solid fa-user"></i>
        <span>Organisateur: ${meeting.createdBy || "Inconnu"}</span>
      `;
    }
  } catch (error) {
    console.error("Erreur chargement réunion:", error);
  }

  // État de prévisualisation
  this.previewMicEnabled = true;
  this.previewCamEnabled = true;
  this.previewStream = null;

  // Charger les périphériques
  this.loadPreviewDevices();

  // Démarrer la prévisualisation
  this.startPreview();
};

CallManager.prototype.closeMeetingPreviewView = function() {
  this.stopPreview();
  
  if (this.meetingPreviewView) {
    this.meetingPreviewView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingPreviewView) {
        this.meetingPreviewView.remove();
        this.meetingPreviewView = null;
      }
    }, 300);
  }
};

CallManager.prototype.loadPreviewDevices = async function() {
  try {
    const devices = await meetingMediaAdapter.getDevices();
    
    const cameraSelect = document.getElementById("camera-select");
    const micSelect = document.getElementById("mic-select");
    
    if (devices.cameras.length > 1) {
      document.getElementById("camera-selector-container").style.display = "block";
      devices.cameras.forEach(device => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Caméra ${device.deviceId.slice(0, 8)}`;
        cameraSelect.appendChild(option);
      });
    }
    
    if (devices.microphones.length > 1) {
      document.getElementById("mic-selector-container").style.display = "block";
      devices.microphones.forEach(device => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${device.deviceId.slice(0, 8)}`;
        micSelect.appendChild(option);
      });
    }
  } catch (error) {
    console.error("Erreur chargement périphériques:", error);
  }
};

CallManager.prototype.startPreview = async function() {
  try {
    this.stopPreview();
    
    const isVideo = this.previewCamEnabled;
    this.previewStream = await meetingMediaAdapter.preparePreview(isVideo);
    
    const videoElement = document.getElementById("preview-video");
    const avatarElement = document.getElementById("preview-avatar");
    const container = document.getElementById("preview-video-container");
    
    if (isVideo && this.previewStream.getVideoTracks().length > 0) {
      videoElement.srcObject = this.previewStream;
      videoElement.style.display = "block";
      avatarElement.style.display = "none";
      container.classList.remove("audio-only");
    } else {
      videoElement.style.display = "none";
      avatarElement.style.display = "flex";
      container.classList.add("audio-only");
    }
  } catch (error) {
    console.error("Erreur démarrage prévisualisation:", error);
    this.showCallToast("Impossible d'accéder à la caméra/microphone");
  }
};

CallManager.prototype.stopPreview = function() {
  if (this.previewStream) {
    this.previewStream.getTracks().forEach(track => track.stop());
    this.previewStream = null;
  }
  meetingMediaAdapter.stopPreview();
};

CallManager.prototype.togglePreviewMic = function() {
  this.previewMicEnabled = !this.previewMicEnabled;
  
  const btn = document.getElementById("preview-mic-btn");
  if (this.previewMicEnabled) {
    btn.classList.remove("inactive");
    btn.classList.add("active");
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
  } else {
    btn.classList.remove("active");
    btn.classList.add("inactive");
    btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
  }
  
  // Redémarrer la prévisualisation avec le nouvel état
  this.startPreview();
};

CallManager.prototype.togglePreviewCam = function() {
  this.previewCamEnabled = !this.previewCamEnabled;
  
  const btn = document.getElementById("preview-cam-btn");
  if (this.previewCamEnabled) {
    btn.classList.remove("inactive");
    btn.classList.add("active");
    btn.innerHTML = '<i class="fa-solid fa-video"></i>';
  } else {
    btn.classList.remove("active");
    btn.classList.add("inactive");
    btn.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
  }
  
  // Redémarrer la prévisualisation avec le nouvel état
  this.startPreview();
};

CallManager.prototype.selectCamera = function(deviceId) {
  meetingMediaAdapter.selectCamera(deviceId);
  this.startPreview();
};

CallManager.prototype.selectMicrophone = function(deviceId) {
  meetingMediaAdapter.selectMicrophone(deviceId);
  this.startPreview();
};

CallManager.prototype.confirmJoinMeetingFromPreview = async function(code) {
  const btn = document.getElementById("join-meeting-btn");
  btn.disabled = true;
  btn.textContent = "Connexion...";
  
  try {
    // Transférer les médias à CallManager
    await meetingMediaAdapter.transferMediaToCallManager();
    
    // Rejoindre la réunion
    this.joinMeeting(code);
    this.closeMeetingPreviewView();
  } catch (error) {
    console.error("Erreur rejoindre réunion:", error);
    this.showCallToast("Erreur lors de la connexion");
    btn.disabled = false;
    btn.textContent = "Rejoindre la réunion";
  }
};

CallManager.prototype.confirmJoinMeeting = function() {
  const rawCode = document.getElementById("meeting-code-input").value;
  const code = this.normalizeMeetingCode(rawCode);
  if (!code) {
    this.showCallToast("Veuillez entrer un code");
    return;
  }
  this.closeMeetingJoinView();
  this.showMeetingPreviewView(code);
};

CallManager.prototype.showMeetingWaitingView = function(data) {
  this.meetingPendingCode = data.code;
  this.meetingPendingMeetingId = data.meetingId;

  if (this.meetingWaitingView) {
    this.meetingWaitingView.classList.add("active");
    this._updateMeetingCountdown(data);
    return;
  }

  const isCreator = data.createdBy === this.myId;

  const html = `
    <div class="view-container meeting-waiting-view" id="meeting-waiting-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingWaitingView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">${isCreator ? 'Vous êtes l\'hôte' : 'Salle d\'attente'}</div>
          </div>
          <div style="width: 40px;"></div>
        </div>

        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; padding: 0 16px;">
          <div style="width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(145deg, #2a3942, #1f2c33);
                     display: flex; align-items: center; justify-content: center;">
            <i class="fa-solid fa-hourglass-half" style="font-size: 50px; color: #8696a0;"></i>
          </div>

          <div style="text-align: center;">
            <div style="font-size: 16px; color: #8696a0; margin-bottom: 8px;">${isCreator ? 'Vous pouvez démarrer maintenant' : 'La réunion commence bientôt'}</div>
            <div style="font-size: 24px; font-weight: 500; color: white; margin-bottom: 16px;">
              Temps restant
            </div>
            <div id="meeting-countdown" style="font-size: 42px; font-weight: 600; color: #00a884;">
              --
            </div>
          </div>

          <div style="width: 100%; max-width: 300px; text-align: center; color: #8696a0; font-size: 13px; line-height: 1.5;">
            ${isCreator
              ? 'En tant qu\'hôte, vous pouvez démarrer la réunion avant l\'heure prévue. Les participants en attente seront notifiés.'
              : 'Vous serez rejoint automatiquement lorsque la réunion commencera. L\'hôte peut également la démarrer avant l\'heure prévue.'}
          </div>

          <div style="width: 100%; display: flex; flex-direction: column; gap: 8px;">
            ${isCreator ? `
              <button onclick="window.startMeeting('${data.code}')"
                      style="width: 100%; padding: 14px; background: #00a884; border: none; border-radius: 24px;
                             color: white; font-size: 16px; font-weight: 500; cursor: pointer;">
                <i class="fa-solid fa-play" style="margin-right: 8px;"></i>
                Démarrer maintenant
              </button>
            ` : ''}
            <button onclick="window.closeMeetingWaitingView()"
                    style="width: 100%; padding: 14px; background: #374045; border: none; border-radius: 24px;
                           color: white; font-size: 16px; font-weight: 500; cursor: pointer;">
              Quitter
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingWaitingView = document.getElementById("meeting-waiting-view");
  this.meetingWaitingView.classList.add("active");

  this._updateMeetingCountdown(data);
};

CallManager.prototype._updateMeetingCountdown = function(data) {
  if (this.meetingTimer) {
    clearInterval(this.meetingTimer);
  }

  const startsAt = data.startsAt || data.opensAt || data.scheduledAt;

  const update = () => {
    const now = this.clockOffset ? Date.now() + this.clockOffset : Date.now();
    const remaining = Math.max(0, startsAt - now);

    if (remaining <= 0) {
      if (this.meetingTimer) {
        clearInterval(this.meetingTimer);
        this.meetingTimer = null;
      }

      if (this.meetingPendingCode) {
        console.log("📅 [MEETING] Heure de démarrage atteinte, auto-join...");
        this.joinMeeting(this.meetingPendingCode);
        this.meetingPendingCode = null;
      }
      return;
    }

    const totalSeconds = Math.ceil(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const countdownEl = document.getElementById("meeting-countdown");
    if (countdownEl) {
      countdownEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  };

  update();
  this.meetingTimer = setInterval(update, 1000);
};

CallManager.prototype.closeMeetingWaitingView = function() {
  if (this.meetingTimer) {
    clearInterval(this.meetingTimer);
    this.meetingTimer = null;
  }
  
  if (this.meetingWaitingView) {
    this.meetingWaitingView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingWaitingView) {
        this.meetingWaitingView.remove();
        this.meetingWaitingView = null;
      }
    }, 300);
  }
};

CallManager.prototype.extractMeetingCodeFromURL = function() {
  try {
    let urlStr = window.location.href;
    
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.launcher) {
      const launchUrl = window.cordova.plugins.launcher.getLaunchUrl();
      if (launchUrl) {
        urlStr = launchUrl;
      }
    }
    
    const url = new URL(urlStr);
    let code = null;
    
    const pathMatch = url.pathname.match(/\/join\/([A-Z0-9-]{9,11})/i);
    if (pathMatch) {
      code = pathMatch[1].toUpperCase();
    }
    
    if (!code) {
      code = url.searchParams.get('code');
      if (code) {
        code = code.toUpperCase();
      }
    }
    
    if (code) {
      code = code.replace(/[^A-Z0-9-]/g, '');
      if (code.length === 9 && !code.includes('-')) {
        code = code.slice(0, 3) + '-' + code.slice(3, 6) + '-' + code.slice(6);
      }
    }
    
    if (code) {
      console.log("📅 [MEETING] Code extrait de l'URL:", code);
      return code;
    }
    
    return null;
  } catch (e) {
    console.error("❌ Erreur extraction code URL:", e);
    return null;
  }
};

CallManager.prototype.handleDeepLink = function() {
  const code = this.extractMeetingCodeFromURL();
  if (code) {
    const checkAndJoin = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.myId) {
        this.showMeetingJoinView(code);
      } else {
        if (!this.deepLinkRetries) this.deepLinkRetries = 0;
        this.deepLinkRetries++;
        if (this.deepLinkRetries < 10) {
          setTimeout(checkAndJoin, 1000);
        } else {
          console.warn("⚠️ [MEETING] Impossible de rejoindre automatiquement: connexion non établie");
        }
      }
    };
    
    setTimeout(checkAndJoin, 500);
  }
};

// ===== INITIALISATION DES PROPRIÉTÉS =====
// Initialiser les propriétés pour les réunions sur l'instance existante
if (window.callManager) {
  window.callManager.meetingCreateView = null;
  window.callManager.meetingJoinView = null;
  window.callManager.meetingWaitingView = null;
  window.callManager.meetingCreatedView = null;
  window.callManager.meetingPreviewView = null;
  window.callManager.meetingTimer = null;
  window.callManager.meetingPendingCode = null;
  window.callManager.deepLinkRetries = 0;
  window.callManager.previewMicEnabled = true;
  window.callManager.previewCamEnabled = true;
  window.callManager.previewStream = null;
}

// ===== EXPORTS GLOBAUX =====
window.showMeetingCreateView = function(meetingId) { window.callManager.showMeetingCreateView(meetingId); };
window.closeMeetingCreateView = function() { window.callManager.closeMeetingCreateView(); };
window.selectMeetingType = function(type) { window.callManager.selectMeetingType(type); };
window.confirmCreateMeeting = function() { window.callManager.confirmCreateMeeting(); };
window.cancelMeeting = function() { window.callManager.cancelMeeting(); };
window.showMeetingJoinView = function(code) { window.callManager.showMeetingJoinView(code); };
window.closeMeetingJoinView = function() { window.callManager.closeMeetingJoinView(); };
window.confirmJoinMeeting = function() { window.callManager.confirmJoinMeeting(); };
window.closeMeetingWaitingView = function() { window.callManager.closeMeetingWaitingView(); };
window.closeMeetingCreatedView = function() { window.callManager.closeMeetingCreatedView(); };
window.copyMeetingCode = function(code) { window.callManager.copyMeetingCode(code); };
window.shareMeetingLink = function(link) { window.callManager.shareMeetingLink(link); };
window.startMeetingFromCreated = function(code) { window.callManager.startMeetingFromCreated(code); };
window.showMeetingListView = function() { window.callManager.listMeetings(); };
window.closeMeetingListView = function() { window.callManager.closeMeetingListView(); };
window.createMeetingFromList = function() { window.callManager.createMeetingFromList(); };
window.startMeetingFromList = function(code) { window.callManager.startMeetingFromList(code); };
// Exports pour l'écran de prévisualisation
window.closeMeetingPreviewView = function() { window.callManager.closeMeetingPreviewView(); };
window.togglePreviewMic = function() { window.callManager.togglePreviewMic(); };
window.togglePreviewCam = function() { window.callManager.togglePreviewCam(); };
window.selectCamera = function(deviceId) { window.callManager.selectCamera(deviceId); };
window.selectMicrophone = function(deviceId) { window.callManager.selectMicrophone(deviceId); };
window.confirmJoinMeetingFromPreview = function(code) { window.callManager.confirmJoinMeetingFromPreview(code); };
window.openMeetingDetails = function(meetingId) { window.callManager.openMeetingDetails(meetingId); };

// ===== HANDLE DEEP LINK AU DÉMARRAGE =====
if (document.readyState === 'complete') {
  window.callManager.handleDeepLink();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    window.callManager.handleDeepLink();
  });
}
