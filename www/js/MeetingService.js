/**
 * ============================================
 *  MEETING SERVICE - SERVICE ISOLÉ POUR LES RÉUNIONS
 * ============================================
 * 
 * Ce service gère toute la logique métier des réunions planifiées,
 * indépendamment du système d'appel classique (CallManager).
 * 
 * RESPONSABILITÉS:
 * - Gestion de l'état des réunions
 * - Interface avec Firebase Firestore
 * - Gestion des participants
 * - Chat de réunion
 * - Permissions
 * - Notifications de réunion
 * 
 * PRINCIPE: Ne pas modifier CallManager, utiliser MeetingMediaAdapter
 * pour l'intégration avec le système d'appel de groupe existant.
 */

class MeetingService {
  constructor() {
    // État local du service
    this.currentMeeting = null;
    this.meetingParticipants = new Map();
    this.meetingChatMessages = [];
    this.meetingPermissions = new Map();
    this.subscribers = new Map();
  }

  /**
   * Abonnement aux changements d'état
   */
  subscribe(event, callback) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, []);
    }
    this.subscribers.get(event).push(callback);
  }

  unsubscribe(event, callback) {
    if (this.subscribers.has(event)) {
      const callbacks = this.subscribers.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.subscribers.has(event)) {
      this.subscribers.get(event).forEach(callback => callback(data));
    }
  }

  /**
   * Charger une réunion par code
   */
  async loadMeetingByCode(code) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/by-code/${code}`);
      if (!response.ok) throw new Error('Réunion introuvable');
      const meeting = await response.json();
      this.currentMeeting = meeting;
      this.emit('meeting-loaded', meeting);
      return meeting;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur chargement réunion:', error);
      throw error;
    }
  }

  /**
   * Charger une réunion par ID
   */
  async loadMeetingById(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}`);
      if (!response.ok) throw new Error('Réunion introuvable');
      const meeting = await response.json();
      this.currentMeeting = meeting;
      this.emit('meeting-loaded', meeting);
      return meeting;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur chargement réunion:', error);
      throw error;
    }
  }

  /**
   * Modifier une réunion
   */
  async updateMeeting(meetingId, updates) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!response.ok) throw new Error('Échec de la modification');
      const updated = await response.json();
      this.currentMeeting = updated;
      this.emit('meeting-updated', updated);
      return updated;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur modification réunion:', error);
      throw error;
    }
  }

  /**
   * Charger les participants d'une réunion
   */
  async loadParticipants(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/participants`);
      if (!response.ok) throw new Error('Échec du chargement des participants');
      const participants = await response.json();
      this.meetingParticipants.clear();
      participants.forEach(p => this.meetingParticipants.set(p.userId, p));
      this.emit('participants-loaded', participants);
      return participants;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur chargement participants:', error);
      throw error;
    }
  }

  /**
   * Ajouter un participant à la réunion
   */
  async addParticipant(meetingId, userId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (!response.ok) throw new Error('Échec de l\'ajout');
      const participant = await response.json();
      this.meetingParticipants.set(userId, participant);
      this.emit('participant-added', participant);
      return participant;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur ajout participant:', error);
      throw error;
    }
  }

  /**
   * Retirer un participant de la réunion
   */
  async removeParticipant(meetingId, userId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/participants/${userId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Échec du retrait');
      this.meetingParticipants.delete(userId);
      this.emit('participant-removed', userId);
      return true;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur retrait participant:', error);
      throw error;
    }
  }

  /**
   * Envoyer un message de chat
   */
  async sendChatMessage(meetingId, message) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          userId: window.callManager?.myId,
          timestamp: Date.now()
        })
      });
      if (!response.ok) throw new Error('Échec de l\'envoi');
      const chatMessage = await response.json();
      this.meetingChatMessages.push(chatMessage);
      this.emit('chat-message-sent', chatMessage);
      return chatMessage;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur envoi message:', error);
      throw error;
    }
  }

  /**
   * Charger l'historique du chat
   */
  async loadChatHistory(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/chat`);
      if (!response.ok) throw new Error('Échec du chargement');
      const messages = await response.json();
      this.meetingChatMessages = messages;
      this.emit('chat-history-loaded', messages);
      return messages;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur chargement chat:', error);
      throw error;
    }
  }

  /**
   * Lever la main
   */
  async raiseHand(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/raise-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: window.callManager?.myId })
      });
      if (!response.ok) throw new Error('Échec');
      this.emit('hand-raised', { userId: window.callManager?.myId });
      return true;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur lever main:', error);
      throw error;
    }
  }

  /**
   * Baisser la main
   */
  async lowerHand(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/lower-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: window.callManager?.myId })
      });
      if (!response.ok) throw new Error('Échec');
      this.emit('hand-lowered', { userId: window.callManager?.myId });
      return true;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur baisser main:', error);
      throw error;
    }
  }

  /**
   * Envoyer une réaction
   */
  async sendReaction(meetingId, reaction) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: window.callManager?.myId,
          reaction,
          timestamp: Date.now()
        })
      });
      if (!response.ok) throw new Error('Échec');
      this.emit('reaction-sent', { userId: window.callManager?.myId, reaction });
      return true;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur réaction:', error);
      throw error;
    }
  }

  /**
   * Obtenir les permissions d'un utilisateur
   */
  async getPermissions(meetingId, userId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/permissions/${userId}`);
      if (!response.ok) throw new Error('Échec');
      const permissions = await response.json();
      this.meetingPermissions.set(userId, permissions);
      return permissions;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur permissions:', error);
      throw error;
    }
  }

  /**
   * Mettre à jour les permissions d'un utilisateur
   */
  async updatePermissions(meetingId, userId, permissions) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/permissions/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permissions)
      });
      if (!response.ok) throw new Error('Échec');
      const updated = await response.json();
      this.meetingPermissions.set(userId, updated);
      this.emit('permissions-updated', { userId, permissions: updated });
      return updated;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur mise à jour permissions:', error);
      throw error;
    }
  }

  /**
   * Réinitialiser l'état du service
   */
  reset() {
    this.currentMeeting = null;
    this.meetingParticipants.clear();
    this.meetingChatMessages = [];
    this.meetingPermissions.clear();
    this.emit('reset');
  }
}

// Instance globale
const meetingService = new MeetingService();

// Export
window.meetingService = meetingService;
