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

      // Priorité au roster live (WebRTC) — source de vérité pendant la réunion
      if (window.callManager && Array.isArray(window.callManager.groupRoster) && window.callManager.groupRoster.length) {
        const roster = window.callManager.groupRoster.map(r => {
          const st = window.callManager.groupPeerStates?.get(r.userId) || {};
          const isSelf = r.userId === window.callManager.myId;
          return {
            userId: r.userId,
            state: r.state || "JOINED",
            micEnabled: isSelf ? !window.callManager.groupIsMuted : !st.micMuted,
            camEnabled: isSelf ? !window.callManager.groupIsCamOff : !st.camOff,
          };
        });
        this.renderParticipants(roster);
        return;
      }

      if (window.meetingService) {
        const participants = await meetingService.loadParticipants(this.currentMeetingId);
        this.renderParticipants(participants);
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

    const hostId = window.callManager?.meetingCreatedBy || null;
    const myId = window.callManager?.myId;
    let html = "";
    participants.forEach(p => {
      const userId = p.userId || p.id;
      const state = p.state || "JOINED";
      const isOrganizer = hostId && userId === hostId;
      const isSelf = userId === myId;
      const micEnabled = p.micEnabled !== false;
      const camEnabled = p.camEnabled !== false;

      html += `
        <div class="participant-item" data-user-id="${userId}">
          <div class="participant-avatar">
            ${String(userId).slice(-2).toUpperCase()}
          </div>
          <div class="participant-info">
            <div class="participant-name">
              ${isSelf ? "Vous" : userId}
              ${isOrganizer ? '<span style="color: #00a884; font-size: 11px; margin-left: 4px;">(Organisateur)</span>' : ''}
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
          ${this.isHost && !isSelf ? `
            <div class="participant-actions">
              <button class="participant-action-btn" onclick="window.hostMuteParticipant('${userId}', 'mic', true)" title="Couper le micro">
                <i class="fa-solid fa-microphone-slash"></i>
              </button>
              <button class="participant-action-btn" onclick="window.hostMuteParticipant('${userId}', 'cam', true)" title="Couper la caméra">
                <i class="fa-solid fa-video-slash"></i>
              </button>
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