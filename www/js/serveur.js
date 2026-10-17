const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

// Imports Firebase Admin v10+ / v11+
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

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
 * Classe RoomManager : Gère les salles d'appel de groupe en maillage (mesh)
 * Comportement style WhatsApp :
 * - Pas d'hôte : la salle vit tant qu'au moins 1 participant est JOINED
 * - Chaque invité accepte ou refuse indépendamment
 * - Les invités peuvent rejoindre même après avoir refusé (tant que la salle est active)
 * - Chaque invitation expire après INVITE_TIMEOUT_MS (45 secondes)
 *
 * Cycle de vie d'un participant :
 * RINGING -> JOINED -> LEFT
 * RINGING -> DECLINED
 * RINGING -> MISSED (expiration du timer)
 * DECLINED/MISSED/LEFT -> JOINED (rejoindre possible)
 */
class RoomManager {
  constructor() {
    // Map : roomId -> { roomId, creatorId, isVideo, createdAt, participants: Map<userId, {state, invitedBy, inviteTimer}> }
    this.rooms = new Map();
    this.MAX_PARTICIPANTS = 6; // JOINED + RINGING comptés ensemble
    this.INVITE_TIMEOUT_MS = 45000; // 45 secondes pour accepter une invitation
  }

  /**
   * Crée une nouvelle salle d'appel de groupe
   * @param {string} creatorId - Identifiant du créateur de la salle
   * @param {boolean} isVideo - Type d'appel (true = vidéo, false = audio)
   * @returns {object} La salle créée
   */
  createRoom(creatorId, isVideo) {
    const roomId = `room_${Date.now()}_${creatorId}`;
    const room = {
      roomId,
      creatorId,
      isVideo,
      createdAt: Date.now(),
      participants: new Map([
        [
          creatorId,
          {
            state: "JOINED",
            invitedBy: creatorId,
            inviteTimer: null,
          },
        ],
      ]),
    };
    this.rooms.set(roomId, room);
    console.log(`🏠 Salle créée : ${roomId} par ${creatorId} (${isVideo ? "vidéo" : "audio"})`);
    return room;
  }

  /**
   * Invite des utilisateurs à une salle
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

    // Vérifier que l'inviteur est JOINED
    if (!inviterState || inviterState.state !== "JOINED") {
      return ids.map((id) => ({
        userId: id,
        success: false,
        reason: "Non autorisé",
      }));
    }

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

      // Vérifier la capacité
      const totalParticipants = room.participants.size;
      if (totalParticipants >= this.MAX_PARTICIPANTS) {
        results.push({
          userId: invitedId,
          success: false,
          reason: "Salle pleine",
        });
        continue;
      }

      // Si l'utilisateur existe déjà (LEFT/DECLINED/MISSED), réinviter
      if (existingParticipant) {
        // Annuler l'ancien timer s'il existe
        if (existingParticipant.inviteTimer) {
          clearTimeout(existingParticipant.inviteTimer);
        }

        // Réinitialiser à RINGING avec nouveau timer
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
        // Nouvel invité : ajouter avec état RINGING
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

    // Diffuser le roster mis à jour
    this.broadcastRoster(roomId);

    return results;
  }

  /**
   * Un utilisateur rejoint une salle (accepte l'invitation ou rejoint après avoir refusé)
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si rejoint, false sinon
   */
  join(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(userId);

    // Si l'utilisateur n'est pas dans la salle, vérifier la capacité
    if (!participant) {
      if (room.participants.size >= this.MAX_PARTICIPANTS) {
        return false;
      }

      // Vérifier qu'il n'est pas dans une autre salle
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
      // L'utilisateur est déjà dans la salle, changer son état à JOINED
      // Annuler le timer s'il existe
      if (participant.inviteTimer) {
        clearTimeout(participant.inviteTimer);
        participant.inviteTimer = null;
      }

      participant.state = "JOINED";
      console.log(`👤 ${userId} a rejoint la salle ${roomId} (état mis à jour)`);
    }

    // Diffuser le roster mis à jour
    this.broadcastRoster(roomId);

    return true;
  }

  /**
   * Un utilisateur refuse une invitation
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si refusé, false sinon
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

    // Annuler le timer
    if (participant.inviteTimer) {
      clearTimeout(participant.inviteTimer);
      participant.inviteTimer = null;
    }

    participant.state = "DECLINED";
    console.log(`🚫 ${userId} a refusé l'invitation à la salle ${roomId}`);

    // Diffuser le roster mis à jour
    this.broadcastRoster(roomId);

    // Vérifier si la salle doit être fermée
    this.checkRoomClosure(roomId);

    return true;
  }

  /**
   * Un utilisateur quitte une salle (état LEFT)
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si quitté, false sinon
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

    // Annuler le timer s'il existe
    if (participant.inviteTimer) {
      clearTimeout(participant.inviteTimer);
      participant.inviteTimer = null;
    }

    participant.state = "LEFT";
    console.log(`👋 ${userId} a quitté la salle ${roomId}`);

    // Diffuser le roster mis à jour
    this.broadcastRoster(roomId);

    // Vérifier si la salle doit être fermée
    this.checkRoomClosure(roomId);

    return true;
  }

  /**
   * Marque un utilisateur comme MISSED (invitation expirée)
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

    // Envoyer notification d'appel manqué
    const user = users.get(userId);
    if (user?.pushToken) {
      envoyerNotificationAppelManque(
        user.pushToken,
        room.creatorId,
        room.isVideo,
        null, // Pas de notId spécifique pour les appels de groupe
      );
    }

    // Diffuser le roster mis à jour
    this.broadcastRoster(roomId);

    // Vérifier si la salle doit être fermée
    this.checkRoomClosure(roomId);
  }

  /**
   * Récupère le roster (liste des participants avec leur état)
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
   * Compte le nombre de participants JOINED dans une salle
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
   * Compte le nombre de participants RINGING dans une salle
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
   * Diffuse le roster à tous les participants JOINED d'une salle
   * @param {string} roomId - Identifiant de la salle
   */
  broadcastRoster(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const roster = this.getRoster(roomId);
    const message = {
      type: "group-roster",
      roomId,
      roster,
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
   * Vérifie si une salle doit être fermée et la ferme si nécessaire
   * Fermeture si : countJoined === 0 ET countRinging === 0
   * @param {string} roomId - Identifiant de la salle
   */
  checkRoomClosure(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const joinedCount = this.countJoined(roomId);
    const ringingCount = this.countRinging(roomId);

    if (joinedCount === 0 && ringingCount === 0) {
      this.closeRoom(roomId, "Plus aucun participant");
    }
  }

  /**
   * Ferme une salle et notifie les participants
   * @param {string} roomId - Identifiant de la salle
   * @param {string} reason - Raison de la fermeture
   */
  closeRoom(roomId, reason) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    console.log(`🗑️ Fermeture de la salle ${roomId} : ${reason}`);

    // Annuler tous les timers
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

    // Supprimer la salle
    this.rooms.delete(roomId);
  }

  /**
   * Vérifie si un utilisateur est activement dans une salle (JOINED ou RINGING uniquement).
   * LEFT / DECLINED / MISSED ne bloquent plus les nouvelles invitations.
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
   * Vérifie si un utilisateur est dans une salle spécifique avec un état JOINED
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
   * Récupère toutes les salles dans lesquelles un utilisateur participe
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
   * Marque un utilisateur comme LEFT dans toutes ses salles (déconnexion)
   * @param {string} userId - Identifiant de l'utilisateur
   */
  markLeftInAllRooms(userId) {
    const userRooms = this.getUserRooms(userId);
    for (const roomId of userRooms) {
      this.leave(roomId, userId);
    }
  }
}

// Instance globale du RoomManager
const roomManager = new RoomManager();

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