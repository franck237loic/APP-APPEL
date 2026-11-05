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
  }

  /**
   * Afficher le panneau de chat
   */
  show(meetingId, roomId) {
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
          <input type="text" id="chat-input" class="chat-input" placeholder="Écrire un message..." 
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
    try {
      const messagesContainer = document.getElementById("chat-messages");
      if (!messagesContainer) return;

      if (window.meetingService) {
        this.messages = await meetingService.loadChatHistory(this.currentMeetingId);
        this.renderMessages();
      }
    } catch (error) {
      console.error("Erreur chargement historique:", error);
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
      const time = new Date(msg.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      
      html += `
        <div class="chat-message ${isOwn ? 'own' : 'other'}">
          <div class="chat-message-content">${this.escapeHtml(msg.message)}</div>
          <div class="chat-message-meta">
            ${!isOwn ? `${msg.userId} • ` : ''}${time}
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

    try {
      if (window.meetingService) {
        const sent = await meetingService.sendChatMessage(this.currentMeetingId, message);
        this.messages.push(sent);
        this.renderMessages();
        input.value = "";
      }
    } catch (error) {
      console.error("Erreur envoi message:", error);
      this.showCallToast("Erreur lors de l'envoi");
    }
  }

  /**
   * Recevoir un message (via WebSocket)
   */
  receiveMessage(message) {
    this.messages.push(message);
    this.renderMessages();
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
    this.messages = [];
    this.currentMeetingId = null;
    this.currentRoomId = null;
  }
}

// Instance globale
const meetingChat = new MeetingChat();

// Export
window.meetingChat = meetingChat;
