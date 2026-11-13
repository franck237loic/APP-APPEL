/**
 * ============================================
 *  MEETING CHAT - CHAT INTÉGRÉ AUX RÉUNIONS
 * ============================================
 * 
 * Ce fichier gère le chat de réunion avec envoi/réception
 * de messages en temps réel.
 */

class MeetingChat {
  constructor() {
    this.panel = null;
    this.messages = [];
    this.currentMeetingId = null;
    this.currentRoomId = null;
    this.pendingSend = null;
    this.pendingSendTimeout = null;
  }

  /**
   * Afficher le panneau de chat
   */
  show(meetingId, roomId) {
    if (this.currentMeetingId !== meetingId) {
      this.messages = this.messages.filter(message => message.meetingId === meetingId);
    }
    this.currentMeetingId = meetingId;
    this.currentRoomId = roomId;

    if (this.panel) {
      this.panel.classList.add("open");
      this.loadHistory();
      return;
    }

    const html = `
      <div class="meeting-chat-panel" id="meeting-chat-panel">
        <div class="chat-header">
          <button class="icon-btn-top" onclick="window.meetingChat.close()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="chat-title">Chat</div>
          <div style="width: 40px;"></div>
        </div>
        
        <div class="chat-messages" id="chat-messages">
          <div class="loading-spinner"></div>
        </div>
        
        <div class="chat-input-container">
          <input type="text" id="chat-input" class="chat-input" maxlength="1000" placeholder="Écrire un message..."
                 onkeypress="if(event.key === 'Enter') window.meetingChat.sendMessage()">
          <button class="chat-send-btn" onclick="window.meetingChat.sendMessage()">
            <i class="fa-solid fa-paper-plane"></i>
          </button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", html);
    this.panel = document.getElementById("meeting-chat-panel");
    this.panel.classList.add("open");

    this.loadHistory();
  }

  /**
   * Fermer le panneau
   */
  close() {
    if (this.panel) {
      this.panel.classList.remove("open");
    }
  }

  /**
   * Charger l'historique des messages
   */
  async loadHistory() {
    const requestedMeetingId = this.currentMeetingId;
    try {
      const messagesContainer = document.getElementById("chat-messages");
      if (!messagesContainer) return;

      if (window.meetingService) {
        const history = await meetingService.loadChatHistory(requestedMeetingId);
        if (requestedMeetingId !== this.currentMeetingId) return;
        // Les messages WebSocket reçus pendant le chargement ne doivent pas
        // disparaître lorsque l'historique REST revient.
        this.messages = this.mergeMessages(history, this.messages);
        this.renderMessages();
      }
    } catch (error) {
      console.error("Erreur chargement historique:", error);
      if (requestedMeetingId === this.currentMeetingId && this.messages.length === 0) {
        const messagesContainer = document.getElementById("chat-messages");
        if (messagesContainer) {
          messagesContainer.innerHTML = '<div class="empty-state"><div class="empty-state-text">Historique indisponible. Vous pouvez toujours envoyer un message.</div></div>';
        }
      }
    }
  }

  /**
   * Afficher les messages
   */
  renderMessages() {
    const messagesContainer = document.getElementById("chat-messages");
    if (!messagesContainer) return;

    if (!this.messages || this.messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-comments"></i>
          <div class="empty-state-text">Aucun message</div>
        </div>
      `;
      return;
    }

    let html = "";
    this.messages.forEach(msg => {
      const isOwn = msg.userId === window.callManager?.myId;
      const time = new Date(Number(msg.timestamp) || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      
      html += `
        <div class="chat-message ${isOwn ? 'own' : 'other'}">
          <div class="chat-message-content">${this.escapeHtml(msg.message)}</div>
          <div class="chat-message-meta">
            ${!isOwn ? `${this.escapeHtml(msg.displayName || msg.userId || 'Participant')} • ` : ''}${time}
          </div>
        </div>
      `;
    });

    messagesContainer.innerHTML = html;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * Envoyer un message
   */
  async sendMessage() {
    const input = document.getElementById("chat-input");
    if (!input) return;

    const message = input.value.trim();
    if (!message) return;

    // Essayer d'envoyer via WebSocket en premier
    if (window.callManager && window.callManager.groupRoomId) {
      if (this.pendingSend) return;
      const payload = {
        type: "meeting-chat-message",
        roomId: this.currentRoomId || window.callManager.groupRoomId,
        meetingId: this.currentMeetingId || window.callManager.currentMeetingId,
        message,
        clientMessageId: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      };
      this.pendingSend = { id: payload.clientMessageId, text: message };
      input.disabled = true;
      const sendButton = document.querySelector("#meeting-chat-panel .chat-send-btn");
      if (sendButton) sendButton.disabled = true;
      const sent = window.callManager.sendSignal(payload);
      if (!sent) {
        window.callManager.showCallToast("Connexion en cours, message en attente…");
      }
      clearTimeout(this.pendingSendTimeout);
      this.pendingSendTimeout = setTimeout(() => {
        if (!this.pendingSend) return;
        input.disabled = false;
        input.value = this.pendingSend.text;
        if (sendButton) sendButton.disabled = false;
        this.pendingSend = null;
        this.pendingSendTimeout = null;
        window.callManager?.showCallToast("Message non confirmé. Vous pouvez réessayer.");
      }, 12000);
      return;
    }

    // Fallback REST
    try {
      if (window.meetingService) {
        const sent = await meetingService.sendChatMessage(this.currentMeetingId, message);
        this.receiveMessage(sent);
        input.value = "";
      }
    } catch (error) {
      console.error("Erreur envoi message:", error);
      window.callManager?.showCallToast("Erreur lors de l'envoi");
    }
  }

  /**
   * Recevoir un message (via WebSocket)
   */
  receiveMessage(message) {
    if (!message) return;
    const normalized = message.message && typeof message.message === "object"
      ? message.message
      : message;
    if (normalized.meetingId && this.currentMeetingId && normalized.meetingId !== this.currentMeetingId) return;
    if (this.pendingSend && normalized.clientMessageId === this.pendingSend.id) {
      clearTimeout(this.pendingSendTimeout);
      this.pendingSendTimeout = null;
      this.pendingSend = null;
      const input = document.getElementById("chat-input");
      const sendButton = document.querySelector("#meeting-chat-panel .chat-send-btn");
      if (input) {
        input.value = "";
        input.disabled = false;
        input.focus();
      }
      if (sendButton) sendButton.disabled = false;
    }
    this.messages = this.mergeMessages(this.messages, [normalized]);
    this.renderMessages();
  }

  handleSendError(error) {
    if (!this.pendingSend || (error.clientMessageId && error.clientMessageId !== this.pendingSend.id)) return;
    clearTimeout(this.pendingSendTimeout);
    this.pendingSendTimeout = null;
    const input = document.getElementById("chat-input");
    const sendButton = document.querySelector("#meeting-chat-panel .chat-send-btn");
    if (input) {
      input.value = this.pendingSend.text;
      input.disabled = false;
    }
    if (sendButton) sendButton.disabled = false;
    this.pendingSend = null;
  }

  mergeMessages(...groups) {
    const byKey = new Map();
    groups.flat().forEach(message => {
      if (!message || typeof message.message !== "string") return;
      const key = message.id || message.clientMessageId ||
        `${message.userId || ""}|${message.timestamp || 0}|${message.message}`;
      byKey.set(key, { ...byKey.get(key), ...message });
    });
    return [...byKey.values()].sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
  }

  /**
   * Échapper le HTML pour éviter XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Réinitialiser
   */
  reset() {
    this.close();
    clearTimeout(this.pendingSendTimeout);
    this.pendingSendTimeout = null;
    this.pendingSend = null;
    this.messages = [];
    this.currentMeetingId = null;
    this.currentRoomId = null;
  }
}

// Instance globale
const meetingChat = new MeetingChat();

// Export
window.meetingChat = meetingChat;
