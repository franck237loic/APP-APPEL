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

CallManager.prototype.handleMeetingCreated = function(data) {
  console.log("📅 [MEETING] Réunion créée:", data);
  this.showMeetingCreatedView(data);
};

CallManager.prototype.handleMeetingLiveReady = function(data) {
  console.log("📅 [MEETING] Réunion maintenant live:", data);
  // Plus besoin de rejoindre automatiquement - le créateur rejoint comme les autres
  // en utilisant son code ou lien
};

CallManager.prototype.handleMeetingJoined = function(data) {
  console.log("📅 [MEETING] Réunion jointe, salle live:", data.roomId);
  this.closeMeetingWaitingView();
  
  // Enchaîner sur l'appel de groupe existant
  this.sendSignal({
    type: "group-join",
    roomId: data.roomId,
  });
  
  this.groupRoomId = data.roomId;
  this.groupIsVideo = data.isVideo;
  this.showGroupView();
};

CallManager.prototype.handleMeetingWaiting = function(data) {
  console.log("📅 [MEETING] Réunion en attente, temps restant:", data.waitTimeMin, "min");
  this.showMeetingWaitingView(data);
};

CallManager.prototype.handleMeetingError = function(data) {
  console.error("📅 [MEETING] Erreur:", data.reason);
  this.showCallToast("Erreur: " + data.reason);
  this.closeMeetingWaitingView();
  this.closeMeetingCreatedView();
};

CallManager.prototype.handleMeetingCancelled = function(data) {
  console.log("📅 [MEETING] Réunion annulée:", data.meetingId);
  this.showCallToast("Réunion annulée");
  this.closeMeetingCreatedView();
};

CallManager.prototype.handleMeetingList = function(data) {
  console.log("📅 [MEETING] Liste reçue:", data.upcoming.length, "à venir,", data.past.length, "passées");
};

// ===== MÉTHODES DE RÉUNION =====

CallManager.prototype.createMeeting = function(title, scheduledAt, durationMin, isVideo, participants) {
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
          this.createMeeting(title, scheduledAt, durationMin, isVideo, participants);
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
    scheduledAt: scheduledAtTimestamp,
    durationMin: parseInt(durationMin),
    isVideo: !!isVideo,
    participants: participants || [],
  });
  
  console.log("📅 [MEETING] Demande de création de réunion envoyée");
};

CallManager.prototype.joinMeeting = function(code) {
  console.log("📅 [MEETING] joinMeeting appelé - wsReadyState:", this.wsReadyState, "wsId:", this.wsId);
  
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
          this.joinMeeting(code);
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
  
  if (!code || code.trim().length === 0) {
    this.showCallToast("Code requis");
    return;
  }
  
  const cleanCode = code.trim().toUpperCase();
  
  this.sendSignal({
    type: "meeting-join",
    code: cleanCode,
  });
  
  console.log("📅 [MEETING] Demande de rejoindre réunion envoyée pour code:", cleanCode);
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

CallManager.prototype.showMeetingCreateView = function() {
  if (this.meetingCreateView) {
    this.meetingCreateView.classList.add("active");
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
            <div class="contact-name">Programmer une réunion</div>
          </div>
          <div style="width: 40px;"></div>
        </div>
        
        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; gap: 20px; padding: 0 16px;">
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Titre</label>
            <input type="text" id="meeting-title" placeholder="Ex: Réunion d'équipe" 
                   style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045; 
                          border-radius: 8px; color: white; font-size: 15px; outline: none;">
          </div>
          
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Date et heure</label>
            <input type="datetime-local" id="meeting-datetime" 
                   style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045; 
                          border-radius: 8px; color: white; font-size: 15px; outline: none;">
          </div>
          
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Durée (minutes)</label>
            <input type="number" id="meeting-duration" value="60" min="15" max="480"
                   style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045; 
                          border-radius: 8px; color: white; font-size: 15px; outline: none;">
          </div>
          
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Participants maximum (optionnel)</label>
            <input type="number" id="meeting-participants" placeholder="Max 6" min="2" max="6"
                   style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045; 
                          border-radius: 8px; color: white; font-size: 15px; outline: none;">
          </div>
          
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Type</label>
            <div style="display: flex; gap: 10px;">
              <button id="meeting-type-audio" class="meeting-type-btn active" onclick="window.selectMeetingType('audio')">
                <i class="fa-solid fa-phone"></i>
                <span>Audio</span>
              </button>
              <button id="meeting-type-video" class="meeting-type-btn" onclick="window.selectMeetingType('video')">
                <i class="fa-solid fa-video"></i>
                <span>Vidéo</span>
              </button>
            </div>
          </div>
        </div>
        
        <div style="width: 100%; padding: 0 16px;">
          <button onclick="window.confirmCreateMeeting()" 
                  style="width: 100%; padding: 14px; background: #00a884; border: none; border-radius: 24px; 
                         color: white; font-size: 16px; font-weight: 500; cursor: pointer;">
            Créer la réunion
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingCreateView = document.getElementById("meeting-create-view");
  this.meetingCreateView.classList.add("active");
  
  // Date par défaut
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
  document.getElementById("meeting-datetime").value = tomorrow.toISOString().slice(0, 16);
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

CallManager.prototype.confirmCreateMeeting = function() {
  const title = document.getElementById("meeting-title").value.trim();
  const datetime = document.getElementById("meeting-datetime").value;
  const duration = document.getElementById("meeting-duration").value;
  const participants = document.getElementById("meeting-participants").value;
  const isVideo = document.getElementById("meeting-type-video").classList.contains("active");
  
  if (!title) {
    this.showCallToast("Veuillez entrer un titre");
    return;
  }
  
  if (!datetime) {
    this.showCallToast("Veuillez sélectionner une date et heure");
    return;
  }
  
  if (!duration || duration < 15 || duration > 480) {
    this.showCallToast("Durée invalide (15-480 minutes)");
    return;
  }
  
  // Participants optionnel : si vide, pas de limite
  let participantIds = [];
  if (participants && participants > 0) {
    // Pour l'instant, on ne stocke que le nombre max
    // Plus tard, on pourrait permettre d'ajouter des IDs spécifiques
    console.log("📅 [MEETING] Participants max:", participants);
  }
  
  this.createMeeting(title, datetime, duration, isVideo, participantIds);
  this.closeMeetingCreateView();
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
        
        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; padding: 0 16px;">
          <div style="width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(145deg, #00a884, #008f6f); 
                     display: flex; align-items: center; justify-content: center;">
            <i class="fa-solid fa-calendar-check" style="font-size: 50px; color: white;"></i>
          </div>
          
          <div style="text-align: center;">
            <div style="font-size: 22px; font-weight: 500; color: white; margin-bottom: 8px;">${data.title}</div>
            <div style="font-size: 14px; color: #8696a0;">
              ${new Date(data.scheduledAt).toLocaleString('fr-FR', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </div>
            <div style="font-size: 14px; color: #8696a0; margin-top: 4px;">
              Durée: ${data.durationMin} min • ${data.isVideo ? 'Vidéo' : 'Audio'}
            </div>
          </div>
          
          <div style="background: #222d34; padding: 20px; border-radius: 12px; width: 100%; text-align: center;">
            <div style="font-size: 13px; color: #8696a0; margin-bottom: 8px;">Code de la réunion</div>
            <div style="font-size: 28px; font-weight: 600; color: #00a884; letter-spacing: 2px; margin-bottom: 12px;">
              ${data.code}
            </div>
            <button onclick="window.copyMeetingCode('${data.code}')" 
                    style="padding: 10px 20px; background: #374045; border: none; border-radius: 20px; 
                           color: white; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-copy"></i>
              Copier le code
            </button>
          </div>
          
          <div style="background: #222d34; padding: 20px; border-radius: 12px; width: 100%; text-align: center;">
            <div style="font-size: 13px; color: #8696a0; margin-bottom: 8px;">Lien de partage</div>
            <div style="font-size: 14px; color: white; word-break: break-all; margin-bottom: 12px; padding: 8px; background: #1f2c33; border-radius: 8px;">
              ${data.link}
            </div>
            <button onclick="window.copyMeetingCode('${data.link}')" 
                    style="padding: 10px 20px; background: #374045; border: none; border-radius: 20px; 
                           color: white; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-copy"></i>
              Copier le lien
            </button>
          </div>
          
          <div style="width: 100%;">
            <button onclick="window.shareMeetingLink('${data.link}')" 
                    style="width: 100%; padding: 14px; background: #00a884; border: none; border-radius: 24px; 
                           color: white; font-size: 16px; font-weight: 500; cursor: pointer; display: flex; 
                           align-items: center; justify-content: center; gap: 10px; margin-bottom: 10px;">
              <i class="fa-solid fa-share-nodes"></i>
              Partager
            </button>
            <button onclick="window.joinMeetingFromCreated('${data.code}')" 
                    style="width: 100%; padding: 14px; background: #374045; border: none; border-radius: 24px; 
                           color: white; font-size: 16px; font-weight: 500; cursor: pointer; display: flex; 
                           align-items: center; justify-content: center; gap: 10px;">
              <i class="fa-solid fa-right-to-bracket"></i>
              Rejoindre maintenant
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

CallManager.prototype.joinMeetingFromCreated = function(code) {
  this.closeMeetingCreatedView();
  this.joinMeeting(code);
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

CallManager.prototype.confirmJoinMeeting = function() {
  const code = document.getElementById("meeting-code-input").value.trim();
  if (!code) {
    this.showCallToast("Veuillez entrer un code");
    return;
  }
  this.joinMeeting(code);
  this.closeMeetingJoinView();
};

CallManager.prototype.showMeetingWaitingView = function(data) {
  this.meetingPendingCode = data.code;
  
  if (this.meetingWaitingView) {
    this.meetingWaitingView.classList.add("active");
    this._updateMeetingCountdown(data);
    return;
  }
  
  const html = `
    <div class="view-container meeting-waiting-view" id="meeting-waiting-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingWaitingView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">En attente</div>
          </div>
          <div style="width: 40px;"></div>
        </div>
        
        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; padding: 0 16px;">
          <div style="width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(145deg, #2a3942, #1f2c33); 
                     display: flex; align-items: center; justify-content: center;">
            <i class="fa-solid fa-clock" style="font-size: 50px; color: #8696a0;"></i>
          </div>
          
          <div style="text-align: center;">
            <div style="font-size: 18px; color: white; margin-bottom: 8px;">La réunion commence dans</div>
            <div id="meeting-countdown" style="font-size: 36px; font-weight: 600; color: #00a884;">
              --
            </div>
          </div>
          
          <div style="width: 100%;">
            <button onclick="window.closeMeetingWaitingView()" 
                    style="width: 100%; padding: 14px; background: #374045; border: none; border-radius: 24px; 
                           color: white; font-size: 16px; font-weight: 500; cursor: pointer;">
              Annuler
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
  
  const update = () => {
    const now = Date.now();
    const remaining = data.scheduledAt - now;
    
    if (remaining <= 0) {
      if (this.meetingTimer) {
        clearInterval(this.meetingTimer);
        this.meetingTimer = null;
      }
      
      if (this.meetingPendingCode) {
        this.joinMeeting(this.meetingPendingCode);
        this.meetingPendingCode = null;
      }
      return;
    }
    
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    
    const countdownEl = document.getElementById("meeting-countdown");
    if (countdownEl) {
      countdownEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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
  window.callManager.meetingTimer = null;
  window.callManager.meetingPendingCode = null;
  window.callManager.deepLinkRetries = 0;
}

// ===== EXPORTS GLOBAUX =====
window.showMeetingCreateView = function() { window.callManager.showMeetingCreateView(); };
window.closeMeetingCreateView = function() { window.callManager.closeMeetingCreateView(); };
window.selectMeetingType = function(type) { window.callManager.selectMeetingType(type); };
window.confirmCreateMeeting = function() { window.callManager.confirmCreateMeeting(); };
window.showMeetingJoinView = function(code) { window.callManager.showMeetingJoinView(code); };
window.closeMeetingJoinView = function() { window.callManager.closeMeetingJoinView(); };
window.confirmJoinMeeting = function() { window.callManager.confirmJoinMeeting(); };
window.closeMeetingWaitingView = function() { window.callManager.closeMeetingWaitingView(); };
window.closeMeetingCreatedView = function() { window.callManager.closeMeetingCreatedView(); };
window.copyMeetingCode = function(code) { window.callManager.copyMeetingCode(code); };
window.shareMeetingLink = function(link) { window.callManager.shareMeetingLink(link); };

// ===== HANDLE DEEP LINK AU DÉMARRAGE =====
if (document.readyState === 'complete') {
  window.callManager.handleDeepLink();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    window.callManager.handleDeepLink();
  });
}
