const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

// Imports Firebase Admin v10+ / v11+
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getFirestore } = require("firebase-admin/firestore");

// Initialisation de Firebase
// Essayer de lire depuis une variable d'environnement (Render) ou depuis un fichier local
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Pour Render : la clé est stockée dans une variable d'environnement
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // Pour le développement local : lire depuis un fichier
  try {
    serviceAccount = require("./serviceAccountKey.json");
  } catch (error) {
    console.error("❌ Erreur : Impossible de charger la clé Firebase. Veuillez définir la variable d'environnement FIREBASE_SERVICE_ACCOUNT ou placer un fichier serviceAccountKey.json");
    process.exit(1);
  }
}

initializeApp({
  credential: cert(serviceAccount),
});

// Initialisation de Firestore pour la persistance des réunions
const db = getFirestore();

const app = express();

// Middleware CORS permissif pour wake-up Render + tests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Carte globale persistante (RAM) pour conserver les utilisateurs et leurs tokens FCM
const users = new Map();

// Stockage temporaire en mémoire RAM pour les offres d'appel (évite de surcharger FCM)
const pendingCalls = new Map();

// =========================================================
// APPEL DE GROUPE — RoomManager (Style WhatsApp)
// =========================================================
/**
 * =========================================================
 *   GESTION DES APPELS DE GROUPE - SERVEUR
 * =========================================================
 * 
 * Classe RoomManager : Gère les salles d'appel de groupe en maillage (mesh)
 * 
 * ARCHITECTURE WEBRTC MESH :
 * - Chaque participant est connecté directement à tous les autres (maillage complet)
 * - Pas de serveur de médias central : les flux vidéo/audio circulent directement entre pairs
 * - Le serveur ne sert qu'à la signalisation (échange des offres/réponses SDP et candidats ICE)
 * 
 * COMPORTEMENT STYLE WHATSAPP :
 * - Pas d'hôte : la salle vit tant qu'au moins 1 participant est JOINED
 * - Chaque invité accepte ou refuse indépendamment
 * - Les invités peuvent rejoindre même après avoir refusé (tant que la salle est active)
 * - Chaque invitation expire après INVITE_TIMEOUT_MS (45 secondes)
 * 
 * ÉTATS D'UN PARTICIPANT :
 * - RINGING : L'utilisateur est invité et n'a pas encore répondu
 * - JOINED : L'utilisateur a accepté et participe activement à l'appel
 * - LEFT : L'utilisateur a quitté l'appel volontairement
 * - DECLINED : L'utilisateur a refusé l'invitation
 * - MISSED : L'invitation a expiré (l'utilisateur n'a pas répondu à temps)
 * 
 * CYCLE DE VIE D'UN PARTICIPANT :
 * RINGING -> JOINED -> LEFT
 * RINGING -> DECLINED
 * RINGING -> MISSED (expiration du timer)
 * DECLINED/MISSED/LEFT -> JOINED (rejoindre possible)
 * 
 * CAPACITÉ :
 * - Maximum 6 participants simultanés (JOINED + RINGING comptés ensemble)
 * - WhatsApp limite à 8, mais 6 est raisonnable pour le maillage complet
 */
class RoomManager {
  constructor() {
    // Map globale de toutes les salles actives
    // Clé : roomId (identifiant unique de la salle)
    // Valeur : { roomId, creatorId, isVideo, createdAt, participants: Map<userId, {state, invitedBy, inviteTimer}> }
    this.rooms = new Map();
    
    // Maximum de participants par salle (JOINED + RINGING)
    this.MAX_PARTICIPANTS = 6;
    
    // Délai d'expiration d'une invitation (45 secondes comme WhatsApp)
    this.INVITE_TIMEOUT_MS = 45000;
  }

  /**
   * =========================================================
   *   CRÉATION DE SALLE
   * =========================================================
   * 
   * Crée une nouvelle salle d'appel de groupe
   * 
   * UTILISATION : Quand un utilisateur lance un appel de groupe
   * - Le créateur est automatiquement ajouté comme JOINED
   * - L'ID de salle est généré : room_<timestamp>_<creatorId>
   * 
   * @param {string} creatorId - Identifiant unique du créateur de la salle
   * @param {boolean} isVideo - Type d'appel (true = vidéo, false = audio uniquement)
   * @returns {object} La salle créée avec tous ses détails
   */
  createRoom(creatorId, isVideo) {
    // Génération d'un ID unique pour la salle
    const roomId = `room_${Date.now()}_${creatorId}`;
    
    // Création de l'objet salle
    const room = {
      roomId,           // Identifiant unique de la salle
      creatorId,        // ID de l'utilisateur qui a créé la salle
      isVideo,          // true = appel vidéo, false = appel audio
      createdAt: Date.now(),  // Timestamp de création
      participants: new Map([
        [
          creatorId,
          {
            state: "JOINED",        // Le créateur est immédiatement JOINED
            invitedBy: creatorId,   // S'est invité lui-même
            inviteTimer: null,      // Pas de timer pour le créateur
          },
        ],
      ]),
    };
    
    // Ajout de la salle à la Map globale
    this.rooms.set(roomId, room);
    console.log(`🏠 Salle créée : ${roomId} par ${creatorId} (${isVideo ? "vidéo" : "audio"})`);
    return room;
  }

  /**
   * =========================================================
   *   INVITATION DE PARTICIPANTS
   * =========================================================
   * 
   * Invite des utilisateurs à une salle existante
   * 
   * VALIDATIONS :
   * - L'inviteur doit être JOINED dans la salle
   * - L'invité ne doit pas déjà être JOINED ou RINGING dans cette salle
   * - L'invité ne doit pas être occupé dans une autre salle
   * - La salle ne doit pas être pleine (max 6 participants)
   * 
   * RÉINVITATION :
   * - Si un utilisateur a LEFT/DECLINED/MISSED, il peut être réinvité
   * - Son timer est réinitialisé et son état repasse à RINGING
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {Array<string>} invitedIds - Liste des identifiants à inviter
   * @param {string} inviterId - Identifiant de celui qui invite (doit être JOINED)
   * @returns {Array<{userId, success, reason}>} Résultat pour chaque invitation
   */
  invite(roomId, invitedIds, inviterId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }

    // Garde-fou : invitedIds doit être un tableau
    const ids = Array.isArray(invitedIds) ? invitedIds : [];
    const results = [];
    const inviterState = room.participants.get(inviterId);

    // Vérifier que l'inviteur est JOINED (autorisation)
    if (!inviterState || inviterState.state !== "JOINED") {
      return ids.map((id) => ({
        userId: id,
        success: false,
        reason: "Non autorisé",
      }));
    }

    // Traitement de chaque invitation
    for (const invitedId of ids) {
      // Vérifier que l'invité n'est pas déjà dans la salle (sauf LEFT/DECLINED/MISSED qu'on peut réinviter)
      const existingParticipant = room.participants.get(invitedId);
      if (existingParticipant && (existingParticipant.state === "JOINED" || existingParticipant.state === "RINGING")) {
        results.push({
          userId: invitedId,
          success: false,
          reason: "Déjà dans la salle",
        });
        continue;
      }

      // Vérifier que l'invité n'est pas déjà dans une autre salle (seulement JOINED/RINGING bloquent)
      if (this.isUserInAnyRoom(invitedId)) {
        results.push({
          userId: invitedId,
          success: false,
          reason: "Occupé",
        });
        continue;
      }

      // Vérifier la capacité maximale de la salle
      const totalParticipants = room.participants.size;
      if (totalParticipants >= this.MAX_PARTICIPANTS) {
        results.push({
          userId: invitedId,
          success: false,
          reason: "Salle pleine",
        });
        continue;
      }

      // Cas 1 : L'utilisateur existe déjà (LEFT/DECLINED/MISSED) -> réinviter
      if (existingParticipant) {
        // Annuler l'ancien timer d'invitation s'il existe
        if (existingParticipant.inviteTimer) {
          clearTimeout(existingParticipant.inviteTimer);
        }

        // Réinitialiser à RINGING avec nouveau timer d'expiration
        const inviteTimer = setTimeout(() => {
          this.markMissed(roomId, invitedId);
        }, this.INVITE_TIMEOUT_MS);

        existingParticipant.state = "RINGING";
        existingParticipant.invitedBy = inviterId;
        existingParticipant.inviteTimer = inviteTimer;

        console.log(`📩 ${invitedId} réinvité à la salle ${roomId} par ${inviterId} (état précédent: ${existingParticipant.state})`);
        results.push({
          userId: invitedId,
          success: true,
        });
      } else {
        // Cas 2 : Nouvel invité -> ajouter avec état RINGING
        const inviteTimer = setTimeout(() => {
          this.markMissed(roomId, invitedId);
        }, this.INVITE_TIMEOUT_MS);

        room.participants.set(invitedId, {
          state: "RINGING",
          invitedBy: inviterId,
          inviteTimer,
        });

        console.log(`📩 ${invitedId} invité à la salle ${roomId} par ${inviterId}`);
        results.push({
          userId: invitedId,
          success: true,
        });
      }
    }

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    return results;
  }

  /**
   * =========================================================
   *   REJOINDRE UNE SALLE
   * =========================================================
   * 
   * Un utilisateur rejoint une salle (accepte l'invitation ou rejoint après avoir refusé)
   * 
   * VALIDATIONS :
   * - La salle doit exister
   * - Si l'utilisateur n'est pas dans la salle : vérifier la capacité
   * - Si l'utilisateur n'est pas dans la salle : vérifier qu'il n'est pas dans une autre salle
   * 
   * EFFETS :
   * - L'état passe à JOINED
   * - Le timer d'invitation est annulé
   * - Le roster est diffusé à tous les participants
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si rejoint avec succès, false sinon
   */
  join(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(userId);

    // Cas 1 : L'utilisateur n'est pas encore dans la salle
    if (!participant) {
      // Vérifier la capacité maximale
      if (room.participants.size >= this.MAX_PARTICIPANTS) {
        return false;
      }

      // Vérifier qu'il n'est pas déjà dans une autre salle
      if (this.isUserInAnyRoom(userId)) {
        return false;
      }

      // Ajouter comme JOINED
      room.participants.set(userId, {
        state: "JOINED",
        invitedBy: userId,
        inviteTimer: null,
      });
      console.log(`👤 ${userId} a rejoint la salle ${roomId}`);
    } else {
      // Cas 2 : L'utilisateur est déjà dans la salle (LEFT/DECLINED/MISSED/RINGING)
      // Changer son état à JOINED
      // Annuler le timer d'invitation s'il existe
      if (participant.inviteTimer) {
        clearTimeout(participant.inviteTimer);
        participant.inviteTimer = null;
      }

      participant.state = "JOINED";
      console.log(`👤 ${userId} a rejoint la salle ${roomId} (état mis à jour)`);
    }

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    return true;
  }

  /**
   * =========================================================
   *   REFUSER UNE INVITATION
   * =========================================================
   * 
   * Un utilisateur refuse une invitation d'appel de groupe
   * 
   * VALIDATIONS :
   * - La salle doit exister
   * - L'utilisateur doit être en état RINGING
   * 
   * EFFETS :
   * - L'état passe à DECLINED
   * - Le timer d'invitation est annulé
   * - Le roster est diffusé à tous les participants
   * - La salle peut être fermée si plus personne n'est actif
   * 
   * NOTE : L'utilisateur peut être réinvité plus tard
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si refusé avec succès, false sinon
   */
  decline(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(userId);
    if (!participant || participant.state !== "RINGING") {
      return false;
    }

    // Annuler le timer d'invitation
    if (participant.inviteTimer) {
      clearTimeout(participant.inviteTimer);
      participant.inviteTimer = null;
    }

    participant.state = "DECLINED";
    console.log(`🚫 ${userId} a refusé l'invitation à la salle ${roomId}`);

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    // Vérifier si la salle doit être fermée (plus personne actif)
    this.checkRoomClosure(roomId);

    return true;
  }

  /**
   * =========================================================
   *   QUITTER UNE SALLE
   * =========================================================
   * 
   * Un utilisateur quitte volontairement une salle en cours d'appel
   * 
   * VALIDATIONS :
   * - La salle doit exister
   * - L'utilisateur doit être dans la salle
   * 
   * EFFETS :
   * - L'état passe à LEFT
   * - Le timer d'invitation est annulé
   * - Le roster est diffusé à tous les participants
   * - La salle peut être fermée si plus personne n'est actif
   * 
   * NOTE : L'utilisateur peut être réinvité plus tard
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si quitté avec succès, false sinon
   */
  leave(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(userId);
    if (!participant) {
      return false;
    }

    // Annuler le timer d'invitation s'il existe
    if (participant.inviteTimer) {
      clearTimeout(participant.inviteTimer);
      participant.inviteTimer = null;
    }

    participant.state = "LEFT";
    console.log(`👋 ${userId} a quitté la salle ${roomId}`);

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    // Vérifier si la salle doit être fermée (plus personne actif)
    this.checkRoomClosure(roomId);

    return true;
  }

  /**
   * =========================================================
   *   MARQUER APPEL MANQUÉ
   * =========================================================
   * 
   * Marque un utilisateur comme MISSED quand son invitation expire
   * 
   * VALIDATIONS :
   * - La salle doit exister
   * - L'utilisateur doit être en état RINGING
   * 
   * EFFETS :
   * - L'état passe à MISSED
   * - Le timer est supprimé
   * - Une notification FCM est envoyée (appel manqué)
   * - Le roster est diffusé à tous les participants
   * - La salle peut être fermée si plus personne n'est actif
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   */
  markMissed(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const participant = room.participants.get(userId);
    if (!participant || participant.state !== "RINGING") {
      return;
    }

    participant.state = "MISSED";
    participant.inviteTimer = null;
    console.log(`⏰ Invitation expirée pour ${userId} dans la salle ${roomId}`);

    // Envoyer notification FCM d'appel manqué
    const user = users.get(userId);
    if (user?.pushToken) {
      envoyerNotificationAppelManque(
        user.pushToken,
        room.creatorId,
        room.isVideo,
        null, // Pas de notId spécifique pour les appels de groupe
      );
    }

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    // Vérifier si la salle doit être fermée (plus personne actif)
    this.checkRoomClosure(roomId);
  }

  /**
   * =========================================================
   *   RÉCUPÉRER LE ROSTER
   * =========================================================
   * 
   * Récupère la liste de tous les participants avec leur état
   * 
   * @param {string} roomId - Identifiant de la salle
   * @returns {Array<{userId, state}>} Roster ou null si salle inexistante
   */
  getRoster(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    const roster = [];
    for (const [userId, data] of room.participants.entries()) {
      roster.push({
        userId,
        state: data.state,
      });
    }
    return roster;
  }

  /**
   * =========================================================
   *   COMPTER LES PARTICIPANTS ACTIFS
   * =========================================================
   * 
   * Compte le nombre de participants JOINED dans une salle
   * 
   * UTILISATION : Pour vérifier si l'appel est en cours
   * 
   * @param {string} roomId - Identifiant de la salle
   * @returns {number} Nombre de participants JOINED
   */
  countJoined(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return 0;
    }

    let count = 0;
    for (const participant of room.participants.values()) {
      if (participant.state === "JOINED") {
        count++;
      }
    }
    return count;
  }

  /**
   * =========================================================
   *   COMPTER LES PARTICIPANTS EN ATTENTE
   * =========================================================
   * 
   * Compte le nombre de participants RINGING dans une salle
   * 
   * UTILISATION : Pour vérifier combien de personnes sont en train de sonner
   * 
   * @param {string} roomId - Identifiant de la salle
   * @returns {number} Nombre de participants RINGING
   */
  countRinging(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return 0;
    }

    let count = 0;
    for (const participant of room.participants.values()) {
      if (participant.state === "RINGING") {
        count++;
      }
    }
    return count;
  }

  /**
   * =========================================================
   *   DIFFUSER LE ROSTER
   * =========================================================
   * 
   * Diffuse le roster à tous les participants JOINED d'une salle
   * 
   * BUT : Informer tous les participants actifs des changements
   *       (quelqu'un a rejoint, quitté, refusé, etc.)
   * 
   * MESSAGE : { type: "group-roster", roomId, roster }
   * 
   * IMPORTANT : 
   * - Seuls les participants JOINED reçoivent le message
   * - Le roster envoyé ne contient QUE les participants JOINED
   *   (pas RINGING, LEFT, DECLINED, MISSED) pour éviter que les participants
   *   existants ne voient l'interface de ceux qui sonnent
   * 
   * @param {string} roomId - Identifiant de la salle
   */
  broadcastRoster(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    // IMPORTANT : Filtrer le roster pour n'envoyer que les participants JOINED
    // Cela évite que les participants existants ne voient ceux qui sonnent
    const joinedRoster = [];
    for (const [userId, data] of room.participants.entries()) {
      if (data.state === "JOINED") {
        joinedRoster.push({
          userId,
          state: data.state,
        });
      }
    }

    const message = {
      type: "group-roster",
      roomId,
      roster: joinedRoster,
    };

    // Envoyer uniquement aux participants JOINED
    for (const [userId, data] of room.participants.entries()) {
      if (data.state === "JOINED") {
        const user = users.get(userId);
        if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
          user.ws.send(JSON.stringify(message));
        }
      }
    }
  }

  /**
   * =========================================================
   *   VÉRIFIER LA FERMETURE DE SALLE
   * =========================================================
   * 
   * Vérifie si une salle doit être fermée et la ferme si nécessaire
   * 
   * CONDITION DE FERMETURE :
   * - countJoined === 0 ET countRinging === 0
   * - C'est-à-dire : plus personne n'est actif ou en attente
   * 
   * @param {string} roomId - Identifiant de la salle
   */
  checkRoomClosure(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const joinedCount = this.countJoined(roomId);
    const ringingCount = this.countRinging(roomId);

    // Fermer la salle si plus personne n'est actif ou en attente
    if (joinedCount === 0 && ringingCount === 0) {
      this.closeRoom(roomId, "Plus aucun participant");
    }
  }

  /**
   * =========================================================
   *   FERMER UNE SALLE
   * =========================================================
   *
   * Ferme une salle et notifie tous les participants
   *
   * EFFETS :
   * - Annule tous les timers d'invitation
   * - Notifie tous les participants (y compris LEFT, DECLINED, MISSED)
   * - Supprime la salle de la Map globale
   * - Notifie le MeetingManager si c'est une salle de réunion
   *
   * MESSAGE : { type: "group-ended", roomId, reason }
   *
   * @param {string} roomId - Identifiant de la salle
   * @param {string} reason - Raison de la fermeture
   */
  closeRoom(roomId, reason) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    console.log(`🗑️ Fermeture de la salle ${roomId} : ${reason}`);

    // Annuler tous les timers d'invitation en cours
    for (const participant of room.participants.values()) {
      if (participant.inviteTimer) {
        clearTimeout(participant.inviteTimer);
      }
    }

    // Notifier tous les participants (y compris LEFT, DECLINED, MISSED)
    const message = {
      type: "group-ended",
      roomId,
      reason,
    };

    for (const userId of room.participants.keys()) {
      const user = users.get(userId);
      if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify(message));
      }
    }

    // Supprimer la salle de la Map globale
    this.rooms.delete(roomId);

    // Notifier le MeetingManager si c'est une salle de réunion
    if (typeof meetingManager !== 'undefined') {
      meetingManager.markEndedByRoom(roomId);
    }
  }

  /**
   * =========================================================
   *   VÉRIFIER SI UTILISATEUR OCCUPÉ
   * =========================================================
   * 
   * Vérifie si un utilisateur est activement dans une salle
   * 
   * CONDITIONS :
   * - Retourne true si l'utilisateur est JOINED ou RINGING dans une salle
   * - LEFT / DECLINED / MISSED ne bloquent pas les nouvelles invitations
   * 
   * UTILISATION : Empêcher un utilisateur d'être invité à une autre salle
   *             alors qu'il est déjà occupé
   * 
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si l'utilisateur est JOINED ou RINGING dans une salle
   */
  isUserInAnyRoom(userId) {
    for (const room of this.rooms.values()) {
      const p = room.participants.get(userId);
      if (p && (p.state === "JOINED" || p.state === "RINGING")) {
        return true;
      }
    }
    return false;
  }

  /**
   * =========================================================
   *   VÉRIFIER SI UTILISATEUR DANS SALLE SPÉCIFIQUE
   * =========================================================
   * 
   * Vérifie si un utilisateur est dans une salle spécifique avec un état JOINED
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si l'utilisateur est JOINED dans la salle
   */
  isJoinedInRoom(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }
    const participant = room.participants.get(userId);
    return participant && participant.state === "JOINED";
  }

  /**
   * =========================================================
   *   RÉCUPÉRER LES SALLES D'UN UTILISATEUR
   * =========================================================
   * 
   * Récupère toutes les salles dans lesquelles un utilisateur participe
   * 
   * UTILISATION : Pour quitter toutes les salles lors d'une déconnexion
   * 
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {Array<string>} Liste des roomId des salles de l'utilisateur
   */
  getUserRooms(userId) {
    const userRooms = [];
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.participants.has(userId)) {
        userRooms.push(roomId);
      }
    }
    return userRooms;
  }

  /**
   * =========================================================
   *   MARQUER UTILISATEUR PARTI TOUTES LES SALLES
   * =========================================================
   * 
   * Marque un utilisateur comme LEFT dans toutes ses salles
   * 
   * UTILISATION : Appelé automatiquement lors d'une déconnexion WebSocket
   *             pour nettoyer proprement l'état de l'utilisateur
   * 
   * @param {string} userId - Identifiant de l'utilisateur
   */
  markLeftInAllRooms(userId) {
    const userRooms = this.getUserRooms(userId);
    for (const roomId of userRooms) {
      this.leave(roomId, userId);
    }
  }
}

// =========================================================
// RÉUNIONS PLANIFIÉES — MeetingManager
// =========================================================
/**
 * =========================================================
 *   GESTION DES RÉUNIONS PLANIFIÉES - SERVEUR
 * =========================================================
 *
 * Classe MeetingManager : Gère les réunions planifiées (type Google Meet)
 *
 * ARCHITECTURE :
 * - Les réunions sont persistées dans Firebase Firestore (collection "meetings")
 * - À l'heure programmée, la réunion ouvre une salle live via RoomManager
 * - Les participants rejoignent via un code court unique (ex: ABC-123-XYZ)
 *
 * ÉTATS D'UNE RÉUNION :
 * - scheduled : Réunion programmée, pas encore commencée
 * - live : Réunion en cours (salle live ouverte)
 * - ended : Réunion terminée (tous partis ou time-out)
 * - cancelled : Réunion annulée par l'hôte
 *
 * RÈGLES MÉTIER :
 * - Fenêtre d'accès : 15 minutes avant scheduledAt jusqu'à endsAt
 * - Host = créateur (seul peut annuler)
 * - Code unique non devinable (9 caractères alphanumériques)
 * - MAX participants = 6 (comme les groupes actuels)
 * - Transition scheduled→live automatique à l'heure ou premier join
 */
class MeetingManager {
  constructor() {
    // Fenêtre d'accès avant l'heure programmée (15 minutes)
    this.ACCESS_WINDOW_BEFORE_MS = 15 * 60 * 1000;

    // Code unique déjà utilisés (éviter collisions)
    this.usedCodes = new Set();

    // Map en RAM pour les timers de transition scheduled→live
    this.scheduleTimers = new Map();
  }

  /**
   * =========================================================
   *   GÉNÉRER UN CODE COURT UNIQUE
   * =========================================================
   *
   * Génère un code court de 9 caractères (format: XXX-XXX-XXX)
   * Utilise des caractères alphanumériques majuscules pour éviter les ambiguïtés
   *
   * @returns {string} Code unique (ex: "ABC-123-XYZ")
   */
  _generateCode() {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      code = "";
      for (let i = 0; i < 9; i++) {
        if (i === 3 || i === 6) {
          code += "-";
        } else {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      }
      attempts++;
    } while (this.usedCodes.has(code) && attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error("Impossible de générer un code unique après 100 tentatives");
    }

    this.usedCodes.add(code);
    return code;
  }

  /**
   * =========================================================
   *   CRÉER UNE RÉUNION
   * =========================================================
   *
   * Crée une nouvelle réunion planifiée et la persiste dans Firestore
   *
   * @param {object} params - Paramètres de la réunion
   * @param {string} params.title - Titre de la réunion
   * @param {number} params.scheduledAt - Timestamp de l'heure programmée
   * @param {number} params.durationMin - Durée en minutes
   * @param {boolean} params.isVideo - true = vidéo, false = audio
   * @param {string} params.createdBy - ID du créateur (host)
   * @param {Array<string>} params.participants - Liste des participants invités
   * @returns {Promise<object>} Réunion créée avec meetingId, code, link
   */
  async create({ title, scheduledAt, durationMin, isVideo, createdBy, participants }) {
    const meetingId = `meeting_${Date.now()}_${createdBy}`;
    const code = this._generateCode();
    const endsAt = scheduledAt + (durationMin * 60 * 1000);
    const link = `https://app-appel.onrender.com/join/${code}`;

    const meeting = {
      meetingId,
      code,
      title,
      scheduledAt,
      durationMin,
      endsAt,
      isVideo,
      createdBy,
      participants: participants || [],
      status: "scheduled",
      roomId: null,
      createdAt: Date.now(),
      link,
    };

    // Persister dans Firestore
    await db.collection("meetings").doc(meetingId).set(meeting);

    // ❌ PLUS de transition automatique - la salle sera créée quand le premier participant rejoint
    // C'est le comportement de Google Meet et Zoom : le premier participant "démarre" la réunion

    console.log(`📅 Réunion créée : ${meetingId} (${code}) pour ${scheduledAt}`);
    return meeting;
  }

  /**
   * =========================================================
   *   RÉCUPÉRER UNE RÉUNION PAR CODE
   * =========================================================
   *
   * @param {string} code - Code de la réunion
   * @returns {Promise<object|null>} Réunion ou null si introuvable
   */
  async getByCode(code) {
    const snapshot = await db.collection("meetings").where("code", "==", code).limit(1).get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  /**
   * =========================================================
   *   REJOINDRE UNE RÉUNION
   * =========================================================
   *
   * Valide l'accès à une réunion et ouvre la salle live si nécessaire
   *
   * VALIDATIONS :
   * - La réunion doit exister
   * - Statut doit être scheduled ou live
   * - Doit être dans la fenêtre d'accès (15 min avant → endsAt)
   *
   * TRANSITION :
   * - Si status=scheduled et dans la fenêtre → passer à live, créer salle RoomManager
   * - Si status=live → retourner roomId existant
   *
   * @param {string} code - Code de la réunion
   * @param {string} userId - ID de l'utilisateur qui rejoint
   * @returns {Promise<object>} Résultat (waiting, joined, error)
   */
  async join(code, userId) {
    const meeting = await this.getByCode(code);

    if (!meeting) {
      return { success: false, reason: "Code invalide" };
    }

    if (meeting.status === "cancelled") {
      return { success: false, reason: "Réunion annulée" };
    }

    if (meeting.status === "ended") {
      return { success: false, reason: "Réunion terminée" };
    }

    const now = Date.now();
    const windowStart = meeting.scheduledAt - this.ACCESS_WINDOW_BEFORE_MS;

    // Trop tôt : retourner waiting avec temps restant
    if (now < windowStart) {
      const waitTimeMs = windowStart - now;
      const waitTimeMin = Math.ceil(waitTimeMs / 60000);
      return {
        success: false,
        status: "waiting",
        reason: "Trop tôt",
        waitTimeMs,
        waitTimeMin,
        scheduledAt: meeting.scheduledAt,
      };
    }

    // Trop tard : réunion expirée
    if (now > meeting.endsAt) {
      await this._updateStatus(meeting.id, "ended");
      return { success: false, reason: "Réunion expirée" };
    }

    // Dans la fenêtre d'accès : ouvrir ou utiliser la salle live
    if (meeting.status === "scheduled") {
      // Transition scheduled → live : créer la salle RoomManager
      // Utiliser une transaction pour éviter que plusieurs personnes ne créent plusieurs salles
      const roomRef = db.collection("meetings").doc(meeting.id);
      
      let room;
      await db.runTransaction(async (transaction) => {
        const freshMeeting = await transaction.get(roomRef);
        if (!freshMeeting.exists) {
          throw "Réunion introuvable";
        }
        
        const freshData = freshMeeting.data();
        
        // Si quelqu'un d'autre a déjà créé la salle, l'utiliser
        if (freshData.status === "live" && freshData.roomId) {
          const existingRoom = roomManager.rooms.get(freshData.roomId);
          if (existingRoom) {
            room = existingRoom;
            return;
          }
        }
        
        // Sinon, créer la salle
        room = roomManager.createRoom(meeting.createdBy, meeting.isVideo);
        
        // Mettre à jour Firestore dans la transaction
        transaction.update(roomRef, {
          status: "live",
          roomId: room.roomId,
        });
      });

      // Annuler le timer de transition automatique (déjà fait manuellement)
      const timer = this.scheduleTimers.get(meeting.id);
      if (timer) {
        clearTimeout(timer);
        this.scheduleTimers.delete(meeting.id);
      }

      console.log(`📅 Réunion ${meeting.id} passée à live (salle ${room.roomId})`);

      return {
        success: true,
        meetingId: meeting.id,
        roomId: room.roomId,
        isVideo: meeting.isVideo,
        title: meeting.title,
      };
    }

    // Status déjà live : retourner roomId existant
    if (meeting.status === "live" && meeting.roomId) {
      return {
        success: true,
        meetingId: meeting.id,
        roomId: meeting.roomId,
        isVideo: meeting.isVideo,
        title: meeting.title,
      };
    }

    return { success: false, reason: "État invalide" };
  }

  /**
   * =========================================================
   *   ANNULER UNE RÉUNION
   * =========================================================
   *
   * Annule une réunion (réservé à l'hôte)
   *
   * @param {string} meetingId - ID de la réunion
   * @param {string} userId - ID de l'utilisateur qui demande l'annulation
   * @returns {Promise<object>} Résultat
   */
  async cancel(meetingId, userId) {
    const doc = await db.collection("meetings").doc(meetingId).get();

    if (!doc.exists) {
      return { success: false, reason: "Réunion introuvable" };
    }

    const meeting = doc.data();

    // Vérifier que l'utilisateur est l'hôte
    if (meeting.createdBy !== userId) {
      return { success: false, reason: "Non autorisé (seul l'hôte peut annuler)" };
    }

    // Vérifier que la réunion n'est pas déjà terminée
    if (meeting.status === "ended" || meeting.status === "cancelled") {
      return { success: false, reason: "Réunion déjà terminée" };
    }

    // Annuler le timer de transition si existant
    const timer = this.scheduleTimers.get(meetingId);
    if (timer) {
      clearTimeout(timer);
      this.scheduleTimers.delete(meetingId);
    }

    // Fermer la salle live si elle existe
    if (meeting.status === "live" && meeting.roomId) {
      roomManager.closeRoom(meeting.roomId, "Réunion annulée");
    }

    // Mettre à jour Firestore
    await db.collection("meetings").doc(meetingId).update({
      status: "cancelled",
    });

    console.log(`📅 Réunion ${meetingId} annulée par ${userId}`);
    return { success: true };
  }

  /**
   * =========================================================
   *   LISTER LES RÉUNIONS D'UN UTILISATEUR
   * =========================================================
   *
   * @param {string} userId - ID de l'utilisateur
   * @returns {Promise<Array>} Liste des réunions (à venir et passées)
   */
  async listForUser(userId) {
    const now = Date.now();

    // Réunions créées par l'utilisateur
    const createdSnapshot = await db
      .collection("meetings")
      .where("createdBy", "==", userId)
      .orderBy("scheduledAt", "desc")
      .get();

    // Réunions où l'utilisateur est participant
    const participatedSnapshot = await db
      .collection("meetings")
      .where("participants", "array-contains", userId)
      .orderBy("scheduledAt", "desc")
      .get();

    const meetings = new Map();

    // Fusionner les résultats (éviter les doublons)
    createdSnapshot.forEach((doc) => {
      meetings.set(doc.id, { id: doc.id, ...doc.data() });
    });

    participatedSnapshot.forEach((doc) => {
      if (!meetings.has(doc.id)) {
        meetings.set(doc.id, { id: doc.id, ...doc.data() });
      }
    });

    // Séparer en à venir et passées
    const upcoming = [];
    const past = [];

    for (const meeting of meetings.values()) {
      if (meeting.scheduledAt > now && meeting.status !== "cancelled" && meeting.status !== "ended") {
        upcoming.push(meeting);
      } else {
        past.push(meeting);
      }
    }

    return { upcoming, past };
  }

  /**
   * =========================================================
   *   PROGRAMMER LA TRANSITION SCHEDULED→LIVE
   * =========================================================
   *
   * ❌ PLUS UTILISÉ - La salle est créée quand le premier participant rejoint
   * (comportement Google Meet/Zoom)
   *
   * @param {string} meetingId - ID de la réunion
   * @param {number} scheduledAt - Timestamp de l'heure programmée
   */
  _scheduleMeetingTransition(meetingId, scheduledAt) {
    // Plus de transition automatique
    console.log(`ℹ️ Réunion ${meetingId} : pas de transition automatique (salle créée au premier join)`);
  }

  /**
   * =========================================================
   *   TRANSITION AUTOMATIQUE SCHEDULED→LIVE
   * =========================================================
   *
   * ❌ PLUS UTILISÉ - La salle est créée dans join() quand le premier participant arrive
   *
   * @param {string} meetingId - ID de la réunion
   */
  async _transitionToLive(meetingId) {
    // Plus utilisé
    console.log(`ℹ️ _transitionToLive appelé mais plus utilisé`);
  }

  /**
   * =========================================================
   *   METTRE À JOUR LE STATUT D'UNE RÉUNION
   * =========================================================
   *
   * @param {string} meetingId - ID de la réunion
   * @param {string} status - Nouveau statut
   */
  async _updateStatus(meetingId, status) {
    await db.collection("meetings").doc(meetingId).update({ status });
  }

  /**
   * =========================================================
   *   MARQUER UNE RÉUNION COMME TERMINÉE
   * =========================================================
   *
   * Appelé quand la salle live est fermée (plus de participants)
   *
   * @param {string} roomId - ID de la salle live
   */
  async markEndedByRoom(roomId) {
    const snapshot = await db.collection("meetings").where("roomId", "==", roomId).limit(1).get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      await db.collection("meetings").doc(doc.id).update({
        status: "ended",
      });
      console.log(`📅 Réunion ${doc.id} marquée ended (salle ${roomId} fermée)`);
    }
  }
}

// Instance globale du RoomManager
const roomManager = new RoomManager();

// Instance globale du MeetingManager
const meetingManager = new MeetingManager();

app.get("/", (req, res) => {
  res.send("Serveur WebSocket actif");
});

// =========================================================
// HEARTBEAT (Garde les connexions actives)
// =========================================================
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log(`⚠️ Client inactif expulsé : ${ws.userId || "Inconnu"}`);
      if (ws.userId && users.get(ws.userId)?.ws === ws) {
        // Déconnexion : Passe le socket à null sans supprimer l'utilisateur de la Map
        const existingUser = users.get(ws.userId);
        users.set(ws.userId, {
          ws: null,
          pushToken: existingUser.pushToken,
        });

        // =========================================================
        // APPEL DE GROUPE — Nettoyage des salles lors de l'expulsion
        // =========================================================
        // Marquer l'utilisateur comme LEFT dans toutes ses salles
        roomManager.markLeftInAllRooms(ws.userId);
      }
      return ws.terminate();
    }

    ws.isAlive = false;

    try {
      ws.ping();
      ws.send(JSON.stringify({ type: "ping" }));
    } catch (e) {
      console.error("Erreur envoi ping :", e);
    }
  });
}, 30000);

wss.on("close", () => {
  clearInterval(interval);
});

// =========================================================
// GESTION DES CONNEXIONS WEBSOCKET
// =========================================================
wss.on("connection", (ws) => {
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", async (message) => {
    ws.isAlive = true;

    try {
      const data = JSON.parse(message);
      // Récupération de la propriété isVideo transmise par le client
      const {
        type,
        userId,
        pushToken,
        targetId,
        offer,
        answer,
        candidate,
        isVideo,
        isVideoUpgrade,
        callId,
      } = data;

      if (type === "pong") {
        return;
      }

      // 1. Enregistrement / Reconnexion de l'utilisateur
      if (type === "register-user") {
        ws.userId = userId;

        // VÉRIFICATION DE LA PRÉSENCE DANS LA MAP
        if (users.has(userId)) {
          const existingUser = users.get(userId);
          console.log(
            `🔄 Utilisateur ${userId} déjà présent dans la Map. Mise à jour de la connexion...`,
          );

          // Fermer l'ancien socket s'il existe et qu'il est encore actif
          if (existingUser.ws && existingUser.ws !== ws) {
            existingUser.ws.userId = null;
            existingUser.ws.terminate();
          }

          // Mise à jour : Nouveau socket + mise à jour du token
          users.set(userId, {
            ws: ws,
            pushToken: pushToken || existingUser.pushToken || null,
          });
        } else {
          // Nouvel utilisateur
          console.log(
            `✨ Nouvel utilisateur enregistré dans la Map : ${userId}`,
          );
          users.set(userId, {
            ws: ws,
            pushToken: pushToken || null,
          });
        }

        const currentUser = users.get(userId);
        console.log(
          `👤 Statut : ${userId} | Token FCM : ${currentUser.pushToken || "Aucun"}`,
        );
        console.log(
          "👥 Liste globale des utilisateurs enregistrés :",
          Array.from(users.keys()),
        );

        ws.send(
          JSON.stringify({
            type: "registered",
            userId: userId,
          }),
        );
        return;
      }

      // 1. Mise à jour dans 'call-user' pour inclure le statut RINGING et le notId
      // Dans wss.on("message"):
      if (type === "call-user") {
        const targetUser = users.get(targetId);
        const targetWs = targetUser?.ws;
        const callTypeLabel = isVideo ? "vidéo" : "audio";

        const newCallId = `call_${Date.now()}_${ws.userId}`;
        const notificationId =
          data.notId || Math.floor(100000 + Math.random() * 900000);

        // Enregistrement de l'appel avec le statut RINGING
        pendingCalls.set(newCallId, {
          from: ws.userId,
          targetId: targetId,
          offer: offer,
          isVideo: !!isVideo,
          status: "RINGING",
          notId: notificationId,
        });

        setTimeout(() => pendingCalls.delete(newCallId), 45000);

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "incoming-call",
              callId: newCallId,
              from: ws.userId,
              offer: offer,
              isVideo: !!isVideo,
              notId: notificationId,
            }),
          );

          if (targetUser.pushToken) {
            await envoyerNotificationPush(
              targetUser.pushToken,
              ws.userId,
              `Appel ${callTypeLabel} de ${ws.userId}`,
              ws.userId,
              newCallId,
              isVideo,
              notificationId,
            );
          }
        } else if (targetUser?.pushToken) {
          await envoyerNotificationPush(
            targetUser.pushToken,
            ws.userId,
            `Appel ${callTypeLabel} de ${ws.userId}`,
            ws.userId,
            newCallId,
            isVideo,
            notificationId,
          );

          ws.send(JSON.stringify({ type: "user-offline", targetId: targetId }));
        } else {
          ws.send(JSON.stringify({ type: "user-offline", targetId: targetId }));
        }
        return;
      }

      // 3. Récupérer l'offre SDP complète si l'application est ouverte via la notification FCM
      if (type === "get-offer") {
        const callData = pendingCalls.get(callId);
        if (callData) {
          ws.send(
            JSON.stringify({
              type: "call-offer-details",
              callId: callId,
              from: callData.from,
              offer: callData.offer,
              isVideo: callData.isVideo,
            }),
          );
        } else {
          ws.send(
            JSON.stringify({
              type: "call-expired",
              callId: callId,
            }),
          );
        }
        return;
      }

      // 4. Transmettre la réponse (B -> A)
      // Envoyé par : B (celui qui répond) -> Reçu par : A (l'appelant)
      // Pourquoi : Transmettre la réponse SDP à l'appelant
      if (type === "answer-call") {
        // Retrouver l'appel associé et passer son statut à ACCEPTED
        for (const [cId, callData] of pendingCalls.entries()) {
          if (callData.from === targetId || callData.targetId === ws.userId) {
            callData.status = "ACCEPTED";
            break;
          }
        }

        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "call-answered",
              answer: answer,
              from: ws.userId, // Ajout de l'identifiant de l'expéditeur
            }),
          );
        }
        return;
      }

      // 5. Échanger les candidats ICE
      // Envoyé par : A ou B -> Reçu par : l'autre participant
      // Pourquoi : Relayer les candidats ICE pour établir la connexion WebRTC
      if (type === "ice-candidate") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "ice-candidate",
              candidate: candidate,
              from: ws.userId, // Ajout de l'identifiant de l'expéditeur
            }),
          );
        }
        return;
      }

      // 6. Refus d'un appel
      if (type === "call-refused") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "call-refused",
              from: ws.userId,
            }),
          );
        }
        return;
      }

      // 7. Fin d'un appel
      if (type === "call-end") {
        // Recherche si l'appel était toujours au statut RINGING lors du raccrochage
        for (const [cId, callData] of pendingCalls.entries()) {
          if (callData.from === ws.userId && callData.targetId === targetId) {
            if (callData.status === "RINGING") {
              const targetUser = users.get(targetId);
              if (targetUser && targetUser.pushToken) {
                // Envoi de la notification d'appel manqué avec le même notId pour remplacer l'ancienne
                envoyerNotificationAppelManque(
                  targetUser.pushToken,
                  ws.userId,
                  callData.isVideo,
                  callData.notId,
                );
              }
            }
            pendingCalls.delete(cId);
            break;
          }
        }

        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: type,
              from: ws.userId,
              target: targetId,
            }),
          );
        }
        return;
      }

      // 8. Restart ICE
      // Envoyé par : A ou B -> Reçu par : l'autre participant
      // Pourquoi : Relancer la négociation ICE suite à un changement de réseau
      if (type === "restart-offer") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "restart-offer",
              offer: offer,
              from: ws.userId, // Ajout de l'identifiant de l'expéditeur
              isVideo: data.isVideo,
              isVideoUpgrade: data.isVideoUpgrade, // Relayé pour gérer la transition audio → vidéo
            }),
          );
        }
        return;
      }

      // 9. Partage d'écran (1-à-1)
      // Envoyé par : A ou B -> Reçu par : l'autre participant
      // Pourquoi : Relayer l'état du partage d'écran
      if (type === "screen-share-state") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "screen-share-state",
              active: !!data.active,
              from: ws.userId,
            }),
          );
        }
        return;
      }

      // =========================================================
      // APPEL DE GROUPE — Gestion des messages de groupe (Style WhatsApp)
      // =========================================================

      // 9. Création d'une salle d'appel de groupe
      // Envoyé par : Créateur -> Reçu par : Créateur (confirmation) + Invités (invitation)
      // Pourquoi : Créer une nouvelle salle et inviter les participants simultanément
      if (type === "group-create") {
        try {
          const { isVideo, invitedIds } = data;

          console.log(`[GROUPE] group-create reçu de ${ws.userId || "?"} avec invitedIds:`, invitedIds);

          // a. Vérifier que ws.userId est défini (utilisateur enregistré via register-user)
          if (!ws.userId) {
            console.error(`[GROUPE] group-create refusé : utilisateur non enregistré`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId: null,
                reason: "Non enregistré",
              }),
            );
            return;
          }

          // b. Valider invitedIds : Array.isArray && length > 0
          if (!Array.isArray(invitedIds) || invitedIds.length === 0) {
            console.error(`[GROUPE] group-create refusé : invitedIds invalide`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId: null,
                reason: "invitedIds invalide",
              }),
            );
            return;
          }

          // c. createRoom(ws.userId, isVideo)
          const room = roomManager.createRoom(ws.userId, isVideo);
          console.log(`[GROUPE] Salle créée : ${room.roomId}`);

          // d. invite(roomId, invitedIds, ws.userId) AVANT de construire le roster
          const inviteResults = roomManager.invite(room.roomId, invitedIds, ws.userId);
          console.log(`[GROUPE] Résultats invitation :`, inviteResults);

          // e. getRoster(roomId) → roster COMPLET (créateur JOINED + invités RINGING)
          const roster = roomManager.getRoster(room.roomId);
          console.log(`[GROUPE] Roster complet :`, roster);

          // f. Envoyer IMMÉDIATEMENT au créateur, AVANT toute notif push
          ws.send(
            JSON.stringify({
              type: "group-created",
              roomId: room.roomId,
              roster,
            }),
          );
          console.log(`[GROUPE] group-created envoyé au créateur ${ws.userId}`);

          // g. Ensuite seulement : boucle invitations (ws ouvert → group-invite, sinon pushToken → push, sinon group-error)
          for (const result of inviteResults) {
            if (result.success) {
              const invitedUser = users.get(result.userId);
              if (invitedUser?.ws && invitedUser.ws.readyState === WebSocket.OPEN) {
                invitedUser.ws.send(
                  JSON.stringify({
                    type: "group-invite",
                    roomId: room.roomId,
                    from: ws.userId,
                    isVideo: isVideo,
                    roster,
                  }),
                );
                console.log(`[GROUPE] group-invite envoyé à ${result.userId} (WebSocket)`);
              } else if (invitedUser?.pushToken) {
                // Utilisateur hors-ligne : envoyer notification Push
                const notId = Math.floor(100000 + Math.random() * 900000);
                await envoyerNotificationPush(
                  invitedUser.pushToken,
                  ws.userId,
                  `Appel ${isVideo ? "vidéo" : "audio"} de groupe`,
                  ws.userId,
                  room.roomId,
                  isVideo,
                  notId,
                  "group-invite",
                );
                console.log(`[GROUPE] notification push envoyée à ${result.userId}`);
              } else {
                // Ni connecté ni token FCM → introuvable
                ws.send(
                  JSON.stringify({
                    type: "group-error",
                    roomId: room.roomId,
                    reason: `Introuvable: ${result.userId}`,
                  }),
                );
                console.log(`[GROUPE] utilisateur introuvable : ${result.userId}`);
              }
            } else if (result.reason === "Occupé") {
              // h. Pour reason === "Occupé" → envoyer group-busy au créateur
              ws.send(
                JSON.stringify({
                  type: "group-busy",
                  roomId: room.roomId,
                  userId: result.userId,
                }),
              );
              console.log(`[GROUPE] utilisateur occupé : ${result.userId}`);
            }
          }
        } catch (error) {
          // i. Tout le handler dans un try/catch : en cas d'exception, envoyer group-error au créateur
          console.error(`[GROUPE] Erreur dans group-create :`, error);
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId: null,
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }

      // 10. Ajouter des participants à une salle existante
      // Envoyé par : Participant JOINED -> Reçu par : Nouveaux invités (invitation)
      // Pourquoi : Permettre d'ajouter des personnes pendant l'appel
      if (type === "group-add") {
        try {
          const { roomId, invitedIds } = data;

          console.log(`[GROUPE] group-add reçu de ${ws.userId || "?"} pour salle ${roomId} avec invitedIds:`, invitedIds);

          // Vérifier que l'émetteur est JOINED dans la salle
          if (!roomManager.isJoinedInRoom(roomId, ws.userId)) {
            console.error(`[GROUPE] group-add refusé : ${ws.userId || "?"} n'est pas JOINED dans ${roomId}`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId,
                reason: "Non autorisé",
              }),
            );
            return;
          }

          // Validation : invitedIds doit être un tableau non vide
          if (!Array.isArray(invitedIds) || invitedIds.length === 0) {
            console.error(`[GROUPE] group-add refusé : invitedIds invalide`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId,
                reason: "invitedIds invalide",
              }),
            );
            return;
          }

          const room = roomManager.rooms.get(roomId);
          if (!room) {
            console.error(`[GROUPE] group-add refusé : salle ${roomId} introuvable`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId,
                reason: "Salle introuvable",
              }),
            );
            return;
          }

          // Inviter AVANT de lire le roster → roster complet
          const inviteResults = roomManager.invite(roomId, invitedIds, ws.userId);
          console.log(`[GROUPE] Résultats invitation (group-add) :`, inviteResults);

          const roster = roomManager.getRoster(roomId);
          console.log(`[GROUPE] Roster complet (group-add) :`, roster);

          // Envoyer les invitations
          for (const result of inviteResults) {
            if (result.success) {
              const invitedUser = users.get(result.userId);
              if (invitedUser?.ws && invitedUser.ws.readyState === WebSocket.OPEN) {
                invitedUser.ws.send(
                  JSON.stringify({
                    type: "group-invite",
                    roomId,
                    from: ws.userId,
                    isVideo: room.isVideo,
                    roster,
                  }),
                );
                console.log(`[GROUPE] group-invite envoyé à ${result.userId} (WebSocket)`);
              } else if (invitedUser?.pushToken) {
                const notId = Math.floor(100000 + Math.random() * 900000);
                await envoyerNotificationPush(
                  invitedUser.pushToken,
                  ws.userId,
                  `Appel ${room.isVideo ? "vidéo" : "audio"} de groupe`,
                  ws.userId,
                  roomId,
                  room.isVideo,
                  notId,
                  "group-invite",
                );
                console.log(`[GROUPE] notification push envoyée à ${result.userId}`);
              } else {
                // Ni connecté ni token FCM → introuvable
                ws.send(
                  JSON.stringify({
                    type: "group-error",
                    roomId,
                    reason: `Introuvable: ${result.userId}`,
                  }),
                );
                console.log(`[GROUPE] utilisateur introuvable : ${result.userId}`);
              }
            } else if (result.reason === "Occupé") {
              ws.send(
                JSON.stringify({
                  type: "group-busy",
                  roomId,
                  userId: result.userId,
                }),
              );
              console.log(`[GROUPE] utilisateur occupé : ${result.userId}`);
            }
          }
        } catch (error) {
          console.error(`[GROUPE] Erreur dans group-add :`, error);
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId: data.roomId || null,
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }

      // 11. Rejoindre une salle (accepter l'invitation ou rejoindre après refus)
      // Envoyé par : Invité -> Reçu par : Invité (confirmation) + Autres JOINED (roster)
      // Pourquoi : Accepter une invitation ou rejoindre une salle active
      if (type === "group-join") {
        const { roomId } = data;

        // Vérifier que la salle existe
        const room = roomManager.rooms.get(roomId);
        if (!room) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Salle introuvable",
            }),
          );
          return;
        }

        // Vérifier que l'utilisateur n'est pas déjà dans une autre salle
        if (roomManager.isUserInAnyRoom(ws.userId) && !room.participants.has(ws.userId)) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Occupé",
            }),
          );
          return;
        }

        // Rejoindre la salle
        const joined = roomManager.join(roomId, ws.userId);
        if (!joined) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Impossible de rejoindre",
            }),
          );
          return;
        }

        // Répondre au participant avec le roster
        const roster = roomManager.getRoster(roomId);
        ws.send(
          JSON.stringify({
            type: "group-joined",
            roomId,
            roster,
          }),
        );
        return;
      }

      // 12. Refuser une invitation
      // Envoyé par : Invité -> Reçu par : Tous JOINED (roster mis à jour)
      // Pourquoi : Refuser une invitation sans fermer l'appel pour les autres
      if (type === "group-decline") {
        const { roomId } = data;

        const declined = roomManager.decline(roomId, ws.userId);
        if (!declined) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Impossible de refuser",
            }),
          );
        }
        return;
      }

      // 13. Quitter une salle
      // Envoyé par : Participant JOINED -> Reçu par : Tous JOINED (roster mis à jour)
      // Pourquoi : Quitter l'appel sans couper pour les autres
      if (type === "group-leave") {
        const { roomId } = data;

        // Vérifier que l'utilisateur est JOINED dans la salle
        if (!roomManager.isJoinedInRoom(roomId, ws.userId)) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Non JOINED dans cette salle",
            }),
          );
          return;
        }

        const left = roomManager.leave(roomId, ws.userId);
        if (!left) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Impossible de quitter",
            }),
          );
        }
        return;
      }

      // 14. Demander les informations d'une salle (application ouverte via notification)
      // Envoyé par : Utilisateur -> Reçu par : Utilisateur (infos) ou group-ended (si fermée)
      // Pourquoi : Récupérer les infos de la salle quand l'app est ouverte via notification
      if (type === "group-get-info") {
        const { roomId } = data;

        const room = roomManager.rooms.get(roomId);
        if (!room) {
          ws.send(
            JSON.stringify({
              type: "group-ended",
              roomId,
              reason: "Salle fermée",
            }),
          );
          return;
        }

        const roster = roomManager.getRoster(roomId);
        ws.send(
          JSON.stringify({
            type: "group-info",
            roomId,
            isVideo: room.isVideo,
            roster,
          }),
        );
        return;
      }

      // 15. Signal WebRTC entre participants d'un groupe
      // Envoyé par : Participant A JOINED -> Reçu par : Participant B JOINED
      // Pourquoi : Relayer les signaux WebRTC (offer, answer, ICE candidate) entre participants
      if (type === "group-signal") {
        const { roomId, targetId, payload } = data;

        // Vérifier que l'expéditeur est JOINED dans la salle
        if (!roomManager.isJoinedInRoom(roomId, ws.userId)) {
          console.warn(`⚠️ Utilisateur ${ws.userId} n'est pas JOINED dans la salle ${roomId}`);
          return;
        }

        // Vérifier que le destinataire est JOINED dans la salle
        if (!roomManager.isJoinedInRoom(roomId, targetId)) {
          console.warn(`⚠️ Destinataire ${targetId} n'est pas JOINED dans la salle ${roomId}`);
          return;
        }

        // Relayer le signal vers le destinataire
        const targetUser = users.get(targetId);
        if (targetUser?.ws && targetUser.ws.readyState === WebSocket.OPEN) {
          targetUser.ws.send(
            JSON.stringify({
              type: "group-signal",
              roomId,
              from: ws.userId,
              payload,
            }),
          );
        }
        return;
      }

      // =========================================================
      // RÉUNIONS PLANIFIÉES — Gestion des messages meeting-*
      // =========================================================

      // 16. Créer une réunion planifiée
      // Envoyé par : Utilisateur -> Reçu par : Utilisateur (confirmation)
      // Pourquoi : Créer une réunion planifiée avec un code partageable
      if (type === "meeting-create") {
        try {
          const { title, scheduledAt, durationMin, isVideo, participants } = data;

          console.log(`[MEETING] meeting-create reçu de ${ws.userId || "?"}`);

          if (!ws.userId) {
            console.error(`[MEETING] meeting-create refusé : utilisateur non enregistré`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Non enregistré",
              }),
            );
            return;
          }

          // Valider les champs obligatoires
          if (!title || !scheduledAt || !durationMin) {
            console.error(`[MEETING] meeting-create refusé : champs manquants`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Champs manquants (title, scheduledAt, durationMin)",
              }),
            );
            return;
          }

          // Créer la réunion
        const meeting = await meetingManager.create({
          title,
          scheduledAt,
          durationMin,
          isVideo: !!isVideo,
          createdBy: ws.userId,
          participants: participants || [],
        });

        ws.send(
          JSON.stringify({
            type: "meeting-created",
            meetingId: meeting.meetingId,
            code: meeting.code,
            link: meeting.link,
            title: meeting.title,
            scheduledAt: meeting.scheduledAt,
            endsAt: meeting.endsAt,
            durationMin: meeting.durationMin,  // ← ici, dans l’objet
            isVideo: meeting.isVideo,
          }),
        );
        console.log(`[MEETING] meeting-created envoyé à ${ws.userId}`);
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-create :`, error);
          ws.send(
            JSON.stringify({
              type: "meeting-error",
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }

      // 17. Rejoindre une réunion par code
      // Envoyé par : Utilisateur -> Reçu par : Utilisateur (waiting/joined/error)
      // Pourquoi : Rejoindre une réunion planifiée via son code
      if (type === "meeting-join") {
        try {
          const { code } = data;

          console.log(`[MEETING] meeting-join reçu de ${ws.userId || "?"} pour code ${code}`);

          if (!ws.userId) {
            console.error(`[MEETING] meeting-join refusé : utilisateur non enregistré`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Non enregistré",
              }),
            );
            return;
          }

          if (!code) {
            console.error(`[MEETING] meeting-join refusé : code manquant`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Code manquant",
              }),
            );
            return;
          }

          const result = await meetingManager.join(code, ws.userId);

          if (result.success) {
            // Réunion live : retourner roomId pour enchaîner sur group-join
            ws.send(
              JSON.stringify({
                type: "meeting-joined",
                meetingId: result.meetingId,
                roomId: result.roomId,
                isVideo: result.isVideo,
                title: result.title,
              }),
            );
            console.log(`[MEETING] meeting-joined envoyé à ${ws.userId} (salle ${result.roomId})`);
          } else if (result.status === "waiting") {
            // Trop tôt : afficher compte à rebours
            ws.send(
              JSON.stringify({
                type: "meeting-waiting",
                waitTimeMs: result.waitTimeMs,
                waitTimeMin: result.waitTimeMin,
                scheduledAt: result.scheduledAt,
              }),
            );
            console.log(`[MEETING] meeting-waiting envoyé à ${ws.userId} (${result.waitTimeMin}min restantes)`);
          } else {
            // Erreur (code invalide, expiré, etc.)
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: result.reason,
              }),
            );
            console.log(`[MEETING] meeting-error envoyé à ${ws.userId} (${result.reason})`);
          }
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-join :`, error);
          ws.send(
            JSON.stringify({
              type: "meeting-error",
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }

      // 18. Annuler une réunion
      // Envoyé par : Host -> Reçu par : Host (confirmation)
      // Pourquoi : Annuler une réunion planifiée (réservé à l'hôte)
      if (type === "meeting-cancel") {
        try {
          const { meetingId } = data;

          console.log(`[MEETING] meeting-cancel reçu de ${ws.userId || "?"} pour ${meetingId}`);

          if (!ws.userId) {
            console.error(`[MEETING] meeting-cancel refusé : utilisateur non enregistré`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Non enregistré",
              }),
            );
            return;
          }

          if (!meetingId) {
            console.error(`[MEETING] meeting-cancel refusé : meetingId manquant`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "meetingId manquant",
              }),
            );
            return;
          }

          const result = await meetingManager.cancel(meetingId, ws.userId);

          if (result.success) {
            ws.send(
              JSON.stringify({
                type: "meeting-cancelled",
                meetingId,
              }),
            );
            console.log(`[MEETING] meeting-cancelled envoyé à ${ws.userId}`);
          } else {
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: result.reason,
              }),
            );
            console.log(`[MEETING] meeting-error envoyé à ${ws.userId} (${result.reason})`);
          }
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-cancel :`, error);
          ws.send(
            JSON.stringify({
              type: "meeting-error",
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }

      // 19. Lister les réunions d'un utilisateur
      // Envoyé par : Utilisateur -> Reçu par : Utilisateur (liste)
      // Pourquoi : Récupérer les réunions à venir et passées
      if (type === "meeting-list") {
        try {
          console.log(`[MEETING] meeting-list reçu de ${ws.userId || "?"}`);

          if (!ws.userId) {
            console.error(`[MEETING] meeting-list refusé : utilisateur non enregistré`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Non enregistré",
              }),
            );
            return;
          }

          const { upcoming, past } = await meetingManager.listForUser(ws.userId);

          ws.send(
            JSON.stringify({
              type: "meeting-list",
              upcoming,
              past,
            }),
          );
          console.log(`[MEETING] meeting-list envoyé à ${ws.userId} (${upcoming.length} à venir, ${past.length} passées)`);
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-list :`, error);
          ws.send(
            JSON.stringify({
              type: "meeting-error",
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }
    } catch (error) {
      console.error("❌ Erreur de lecture du message :", error);
    }
  });

  // Nettoyage à la déconnexion
  ws.on("close", () => {
    if (ws.userId) {
      const existingUser = users.get(ws.userId);
      if (existingUser?.ws === ws) {
        users.set(ws.userId, {
          ws: null,
          pushToken: existingUser.pushToken,
        });
        console.log(
          `❌ Socket déconnecté pour ${ws.userId} (Utilisateur et Token FCM conservés)`,
        );

        // =========================================================
        // APPEL DE GROUPE — Nettoyage des salles à la déconnexion
        // =========================================================
        // Marquer l'utilisateur comme LEFT dans toutes ses salles
        roomManager.markLeftInAllRooms(ws.userId);
      }
    }
  });

  ws.on("error", (error) => {
    console.error(
      `❌ Erreur WebSocket sur l'utilisateur ${ws.userId || "Inconnu"} :`,
      error,
    );
  });
});

/**
 * Fonction d'envoi de notification Push FCM optimisée (Taille < 500 octets)
 */
async function envoyerNotificationPush(
  tokenDestinataire,
  nomExpediteur,
  texteMessage,
  from,
  callId,
  isVideo = false,
  notId = null,  // ✅ FIX : accepter le notId fourni par l'appelant
  notificationType = "incoming-call", // Type de notification (incoming-call ou group-invite)
) {
  if (!tokenDestinataire) {
    console.warn(
      "⚠️ Impossible d'envoyer la notification : Aucun token FCM fourni.",
    );
    return;
  }

  // ✅ FIX : utiliser le notId fourni, sinon en générer un
  if (notId === null) notId = Math.floor(100000 + Math.random() * 900000);

  // Construction du payload de base
  const baseData = {
    title: isVideo ? "📹 Appel vidéo entrant" : "📞 Appel entrant",
    message: texteMessage || `Appel de ${from}`,
    type: notificationType,
    callerId: String(from),
    callerName: String(nomExpediteur || from),
    isVideo: String(isVideo),
    notId: String(notId),
  };

  // Ajout de champs spécifiques selon le type de notification
  if (notificationType === "incoming-call") {
    baseData.callId = String(callId);
    baseData.actions = JSON.stringify([
      {
        title: "Refuser",
        callback: "reject",
        foreground: false,
      },
      {
        title: "Accepter",
        callback: "accept",
        foreground: true,
      },
    ]);
  } else if (notificationType === "group-invite") {
    baseData.roomId = String(callId); // Pour group-invite, callId contient le roomId
    baseData.from = String(from);
    baseData.actions = JSON.stringify([
      {
        title: "Refuser",
        callback: "reject",
        foreground: false,
      },
      {
        title: "Accepter",
        callback: "accept",
        foreground: true,
      },
    ]);
  }

  const payload = {
    token: tokenDestinataire,
    data: baseData,
    android: {
      priority: "high",
    },
  };

  try {
    const response = await getMessaging().send(payload);
    console.log("📲 Notification Push FCM envoyée avec succès, ID :", response);
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi FCM :", error);
  }
}

// 5. Ajout de la fonction pour envoyer la notification "Appel manqué"
async function envoyerNotificationAppelManque(
  tokenDestinataire,
  nomExpediteur,
  isVideo,
  notId,
  isGroup = false, // Indique si c'est un appel de groupe
) {
  const payload = {
    token: tokenDestinataire,
    data: {
      type: "missed-call",
      title: isGroup ? "Appel de groupe manqué" : "Appel manqué",
      message: isGroup
        ? `Vous avez manqué un appel ${isVideo ? "vidéo" : "audio"} de groupe`
        : `Vous avez manqué un appel ${isVideo ? "vidéo" : "audio"} de ${nomExpediteur}`,
      callerId: String(nomExpediteur),
      notId: notId ? String(notId) : null,
      isGroup: String(isGroup),
    },
    android: {
      priority: "high",
    },
  };

  try {
    await getMessaging().send(payload);
    console.log(`📵 Notification Appel Manqué envoyée (${isGroup ? "groupe" : "1-à-1"})`);
  } catch (error) {
    console.error(
      "❌ Erreur lors de l'envoi de la notification appel manqué :",
      error,
    );
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Serveur WebSocket actif sur le port ${PORT}`),
);