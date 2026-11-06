/**
 * ============================================
 *  MEETING PARTICIPANTS - GESTION DES PARTICIPANTS
 * ============================================
 * 
 * Ce fichier gère l'affichage et la gestion des participants
 * pendant une réunion en cours.
 */

class MeetingParticipants {
  constructor() {
    this.panel = null;
    this.participants = new Map();
    this.currentMeetingId = null;
    this.currentRoomId = null;
    this.isHost = false;
  }

  /**
   * Afficher le panneau des participants
   */
  show(meetingId, roomId, isHost = false) {
    this.currentMeetingId = meetingId;
    this.currentRoomId = roomId;
    this.isHost = isHost;

    if (this.panel) {
      this.panel.classList.add("open");
      this.loadParticipants();
      return;
    }

    const html = `
      <div class="meeting-participants-panel" id="meeting-participants-panel">
        <div class="chat-header">
          <button class="icon-btn-top" onclick="window.meetingParticipants.close()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="chat-title">Participants</div>
          <div style="width: 40px;"></div>
        </div>
        
        <div class="participants-list" id="participants-list">
          <div class="loading-spinner"></div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", html);
    this.panel = document.getElementById("meeting-participants-panel");
    this.panel.classList.add("open");

    this.loadParticipants();
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
   * Charger les participants
   */
  async loadParticipants() {
    try {
      const listContainer = document.getElementById("participants-list");
      if (!listContainer) return;

      // Charger depuis MeetingService
      if (window.meetingService) {
        const participants = await meetingService.loadParticipants(this.currentMeetingId);
        this.renderParticipants(participants);
      } else {
        // Fallback: utiliser le roster de CallManager
        if (window.callManager && window.callManager.groupRoster) {
          this.renderParticipants(window.callManager.groupRoster);
        }
      }
    } catch (error) {
      console.error("Erreur chargement participants:", error);
    }
  }

  /**
   * Afficher les participants
   */
  renderParticipants(participants) {
    const listContainer = document.getElementById("participants-list");
    if (!listContainer) return;

    if (!participants || participants.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-users"></i>
          <div class="empty-state-text">Aucun participant</div>
        </div>
      `;
      return;
    }

    let html = "";
    participants.forEach(p => {
      const userId = p.userId || p.id;
      const state = p.state || "JOINED";
      const isCreator = this.isHost && userId === window.callManager?.myId;
      const micEnabled = p.micEnabled !== false;
      const camEnabled = p.camEnabled !== false;

      html += `
        <div class="participant-item">
          <div class="participant-avatar">
            ${userId.slice(-2).toUpperCase()}
          </div>
          <div class="participant-info">
            <div class="participant-name">
              ${userId}
              ${isCreator ? '<span style="color: #00a884; font-size: 11px; margin-left: 4px;">(Organisateur)</span>' : ''}
            </div>
            <div class="participant-role">${state}</div>
          </div>
          <div class="participant-media-status">
            <span class="media-status ${micEnabled ? 'enabled' : 'disabled'}" title="Microphone">
              <i class="fa-solid ${micEnabled ? 'fa-microphone' : 'fa-microphone-slash'}"></i>
            </span>
            <span class="media-status ${camEnabled ? 'enabled' : 'disabled'}" title="Caméra">
              <i class="fa-solid ${camEnabled ? 'fa-video' : 'fa-video-slash'}"></i>
            </span>
          </div>
          ${this.isHost && !isCreator ? `
            <div class="participant-actions">
              <button class="participant-action-btn" onclick="window.meetingParticipants.removeParticipant('${userId}')" title="Retirer">
                <i class="fa-solid fa-user-minus"></i>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    });

    listContainer.innerHTML = html;
  }

  /**
   * Retirer un participant
   */
  async removeParticipant(userId) {
    if (!confirm(`Retirer ${userId} de la réunion ?`)) return;

    try {
      if (window.meetingService) {
        await meetingService.removeParticipant(this.currentMeetingId, userId);
        this.showCallToast("Participant retiré");
        this.loadParticipants();
      }
    } catch (error) {
      console.error("Erreur retrait participant:", error);
      this.showCallToast("Erreur lors du retrait");
    }
  }

  /**
   * Mettre à jour en temps réel
   */
  updateParticipant(userId, state) {
    const existing = this.participants.get(userId) || { userId };
    this.participants.set(userId, { ...existing, state });
    this.renderParticipants(Array.from(this.participants.values()));
  }

  /**
   * Mettre à jour l'état média d'un participant
   */
  updateParticipantMedia(userId, mediaState) {
    const existing = this.participants.get(userId) || { userId };
    this.participants.set(userId, { ...existing, ...mediaState });
    this.renderParticipants(Array.from(this.participants.values()));
  }

  /**
   * Réinitialiser
   */
  reset() {
    this.close();
    this.participants.clear();
    this.currentMeetingId = null;
    this.currentRoomId = null;
    this.isHost = false;
  }
}

// Instance globale
const meetingParticipants = new MeetingParticipants();

// Export
window.meetingParticipants = meetingParticipants;
