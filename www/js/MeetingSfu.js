// ============================================================
// MEETING SFU — adaptateur LiveKit pour les réunions > 6
// participants (au-delà du mesh WebRTC).
// ============================================================
//
// RÔLE DE CE FICHIER
// ------------------
// En mode mesh (≤ 6 participants), chaque téléphone envoie sa vidéo
// directement aux autres (P2P). Au-delà, ça sature : c'est le SFU
// (Selective Forwarding Unit) qui prend le relais. Un SFU est un
// serveur central : chaque participant n'envoie son flux QU'À LUI,
// et c'est lui qui redistribue chaque flux à tous les autres.
// Le SFU utilisé est LiveKit (auto-hébergé ou cloud).
//
// CE FICHIER EST UN ADAPTATEUR VOLONTAIREMENT ISOLÉ
// -------------------------------------------------
// - Il ne touche à AUCUNE autre partie de l'app : ni WebSocket de
//   signalisation, ni boutons, ni CSS.
// - L'app l'appelle seulement à 2 moments :
//     • MeetingSfu.join(...)  → entrer en mode SFU ;
//     • MeetingSfu.leave()    → quitter / nettoyer.
// - En cas d'échec SFU, Meetings.js replie automatiquement sur le mesh.
//
// LES 3 DONNÉES NÉCESSAIRES POUR SE CONNECTER
// -------------------------------------------
// Elles arrivent toutes du serveur Render (jamais en dur ici) :
//     • url      → ws(s)://serveur-livekit:port
//     • roomName → le salon réservé à CETTE réunion (meeting_<id>)
//     • token    → JWT signé par le serveur (identité + droits d'accès)
// Le secret qui signe les tokens ne quitte JAMAIS le serveur :
// s'il était dans l'app, n'importe qui pourrait fabriquer des tokens
// et entrer dans toutes les réunions.

(function () {
  "use strict";

  // ------------------------------------------------------------
  // ÉTAT INTERNE (privé — inaccessible depuis l'extérieur du fichier)
  // ------------------------------------------------------------
  const state = {
    room: null,          // L'objet Room du SDK LiveKit (la connexion au SFU)
    connected: false,    // true = connecté au SFU et flux publiés
    joining: false,      // true = connexion en cours (anti double-join)
    isVideo: false,      // Réunion vidéo ou audio seulement ?
    gridEl: null,        // L'élément DOM #meeting-video-grid (la grille)
    tiles: new Map(),    // Annuaire : identité participant → tuile DOM
    selfTile: null,      // Ma propre tuile (vidéo locale, muette)
    pollTimer: null,     // Timer du sondage micro/caméra (400 ms)
    lastMicEnabled: null, // Dernier état connu du micro (pour détecter les changements)
    lastCamEnabled: null, // Dernier état connu de la caméra
    onFailure: null,     // Callback d'échec fournie par Meetings.js (repli mesh)
    localStream: null,   // Le flux local de l'app, réutilisé (jamais dupliqué)
  };

  // ------------------------------------------------------------
  // lib() — récupère le SDK LiveKit
  // ------------------------------------------------------------
  // Le SDK est chargé dans index.html (CDN, version figée 2.13.3,
  // avec repli local). Il expose la variable globale window.LivekitClient.
  // Cette fonction vérifie simplement qu'il est bien là avant usage —
  // si le CDN et la copie locale ont tous deux échoué, on renvoie null
  // et l'appelant déclenchera le repli mesh.
  function lib() {
    const client = window.LivekitClient;
    if (!client) console.warn("[SFU] livekit-client non chargé (window.LivekitClient absent)");
    return client;
  }

  // ------------------------------------------------------------
  // toast(message) — affiche un message à l'utilisateur
  // ------------------------------------------------------------
  // Utilise la fonction de toast de l'app si disponible (CallManager) ;
  // sinon, se contente de logger dans la console (mode dégradé).
  function toast(message) {
    if (window.callManager?.showCallToast) window.callManager.showCallToast(message);
    else console.log("[SFU]", message);
  }

  // ------------------------------------------------------------
  // getGrid() — retrouve la grille vidéo des réunions
  // ------------------------------------------------------------
  // Renvoie l'élément #meeting-video-grid (la grille où s'affichent
  // les tuiles). Mise en cache : le DOM n'est cherché qu'une fois.
  function getGrid() {
    if (!state.gridEl) state.gridEl = document.getElementById("meeting-video-grid");
    return state.gridEl;
  }

  // ------------------------------------------------------------
  // buildTile(identity, displayName, isSelf) — crée une tuile vidéo
  // ------------------------------------------------------------
  // Construit le bloc DOM d'un participant, AVEC LE MÊME LOOK que le
  // mesh (classes communes video-tile / group-video / group-avatar...),
  // pour que le CSS existant s'applique sans changement :
  //   - <video>          → le flux (muted si c'est moi : jamais d'écho)
  //   - avatar + initiale → affiché tant qu'il n'y a pas de vidéo
  //   - badge micro coupé → affiché selon l'état du micro distant
  //   - nom du participant
  // Ajoute la tuile à la grille et la renvoie. Renvoie null si la
  // grille n'existe pas (ex: écran de réunion déjà fermé).
  function buildTile(identity, displayName, isSelf) {
    const grid = getGrid();
    if (!grid) return null;
    const wrap = document.createElement("div");
    wrap.className = "video-tile sfu-tile" + (isSelf ? " self" : "");
    wrap.dataset.sfuIdentity = identity; // repère pour retrouver la tuile
    wrap.innerHTML = `
      <video class="group-video" autoplay playsinline muted></video>
      <div class="group-avatar"><span class="group-initial"></span></div>
      <i class="fa-solid fa-microphone-slash group-badge-mute" style="display:none"></i>
      <div class="group-tile-info video-tile-info">
        <span class="group-tile-name user-name"></span>
      </div>`;
    wrap.querySelector(".group-tile-name").textContent = displayName;
    wrap.querySelector(".group-initial").textContent = (displayName || "?").substring(0, 1).toUpperCase();
    const video = wrap.querySelector("video");
    video.muted = isSelf; // jamais d'écho local
    wrap.style.setProperty("position", "relative", "important");
    grid.appendChild(wrap);
    return wrap;
  }

  // ------------------------------------------------------------
  // tileFor(identity, displayName, isSelf) — retrouve OU crée la tuile
  // ------------------------------------------------------------
  // Renvoie la tuile existante du participant `identity`, ou en crée
  // une (via buildTile) et l'enregistre dans la Map `state.tiles`.
  // La Map sert d'annuaire : une seule tuile par participant, jamais
  // de doublon même si plusieurs pistes arrivent en même temps.
  function tileFor(identity, displayName, isSelf) {
    if (state.tiles.has(identity)) return state.tiles.get(identity);
    const wrap = buildTile(identity, displayName, isSelf);
    if (!wrap) return null;
    const entry = {
      wrap: wrap,
      video: wrap.querySelector("video"),
      avatar: wrap.querySelector(".group-avatar"),
    };
    state.tiles.set(identity, entry);
    return entry;
  }

  // ------------------------------------------------------------
  // removeTile(identity) — supprime la tuile d'un participant parti
  // ------------------------------------------------------------
  // Détache le flux de la <video> (sinon la piste reste vivante en
  // mémoire), retire le bloc DOM de la grille et supprime l'entrée
  // de l'annuaire. Appelé quand un participant quitte la réunion.
  function removeTile(identity) {
    const entry = state.tiles.get(identity);
    if (!entry) return;
    if (entry.video) entry.video.srcObject = null;
    entry.wrap.remove();
    state.tiles.delete(identity);
  }

  // ------------------------------------------------------------
  // clearGrid() — vide complètement la grille
  // ------------------------------------------------------------
  // Supprime TOUTES les tuiles (départ de réunion, échec SFU,
  // bascule mesh→SFU...). Détache chaque flux avant de retirer le DOM.
  function clearGrid() {
    state.tiles.forEach((entry) => {
      if (entry.video) entry.video.srcObject = null;
      entry.wrap.remove();
    });
    state.tiles.clear();
    state.selfTile = null;
  }

  // ------------------------------------------------------------
  // publishLocal(client, room) — publie mon flux vers le SFU
  // ------------------------------------------------------------
  // POINT CLÉ : on RÉUTILISE le flux déjà acquis par l'app (celui de
  // l'aperçu ou de la salle d'attente, passé via options.localStream).
  // → Pas de nouvelle permission, pas de 2e caméra ouverte, et les
  //   boutons Micro/Caméra EXISTANTS de l'app continuent de piloter
  //   ce même flux (voir startPolling).
  // S'il n'existe pas encore (cas improbable), on l'acquiert en secours.
  // Puis on publie au SFU :
  //   - la piste audio (source Microphone, dtx=true = suspend l'envoi
  //     quand personne ne parle → économie de bande passante) ;
  //   - la piste vidéo (source Camera) si la réunion est en vidéo.
  async function publishLocal(client, room) {
    const lp = room.localParticipant;
    // Réutilise le flux déjà acquis (aperçu / salle d'attente / mesh) :
    // les boutons micro/vidéo EXISTANTS restent les mêmes.
    let stream = state.localStream;
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: state.isVideo });
      state.localStream = stream;
    }
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) await lp.publishTrack(audioTrack, { source: client.Track.Source.Microphone, dtx: true });
    if (state.isVideo) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) await lp.publishTrack(videoTrack, { source: client.Track.Source.Camera });
    }
  }

  // ------------------------------------------------------------
  // renderSelf(client, room) — affiche ma propre tuile
  // ------------------------------------------------------------
  // Crée ma tuile (isSelf=true → vidéo muette pour éviter l'écho) et
  // y attache ma piste caméra locale si elle est publiée et active.
  // S'appelle juste après la connexion, AVANT de recevoir les autres.
  function renderSelf(client, room) {
    const entry = tileFor(room.localParticipant.identity || "self", room.localParticipant.name || "Vous", true);
    if (!entry) return;
    state.selfTile = entry;
    const pub = room.localParticipant.getTrackPublication(client.Track.Source.Camera);
    if (pub?.track && !pub.isMuted) {
      try { pub.track.attach(entry.video); } catch (e) { /* ignore */ }
    }
  }

  // ------------------------------------------------------------
  // wireRoomEvents(client, room) — branche les événements du SFU
  // ------------------------------------------------------------
  // C'est le cœur réactif : le SDK prévient à chaque changement dans
  // la salle, et on met l'UI à jour. Équivalent exact des
  // room.on(...) de la page de test, mais avec tuiles + états.
  function wireRoomEvents(client, room) {
    // Une piste distante (vidéo ou audio) vient d'arriver → l'attacher
    // à la tuile du participant. Une vidéo valide masque l'avatar.
    room.on(client.RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      const entry = tileFor(participant.identity, participant.name || participant.identity, false);
      if (!entry) return;
      try { track.attach(entry.video); } catch (e) { /* ignore */ }
      if (track.kind === "video") entry.avatar.style.display = "none";
    });
    // Une piste distante s'en va (participant a coupé sa caméra ou quitte)
    // → détacher, vider la <video>, réafficher l'avatar.
    room.on(client.RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      const entry = state.tiles.get(participant.identity);
      if (!entry) return;
      try { track.detach(entry.video); } catch (e) { /* ignore */ }
      if (track.kind === "video" && entry.video) {
        entry.video.srcObject = null;
        entry.avatar.style.display = "";
      }
    });
    // Un participant quitte la salle → sa tuile disparaît.
    room.on(client.RoomEvent.ParticipantDisconnected, (participant) => removeTile(participant.identity));
    // Le SFU indique qui parle (niveaux audio analysés côté serveur) →
    // bordure « en train de parler » sur les tuiles concernées.
    room.on(client.RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const speakingIds = new Set(speakers.map((s) => s.identity));
      state.tiles.forEach((entry, identity) => {
        entry.wrap.classList.toggle("is-speaking", speakingIds.has(identity));
      });
    });
    // Déconnexion du SFU (coupure réseau, serveur down, kick...) →
    // nettoyer l'état. NB : pas de repli automatique ICI ; le repli
    // mesh est géré par Meetings.js / le serveur.
    room.on(client.RoomEvent.Disconnected, (reason) => {
      console.log("[SFU] Déconnecté de LiveKit :", reason || "");
      state.connected = false;
      stopPolling();
      clearGrid();
    });
  }

  // ------------------------------------------------------------
  // startPolling(client, room) — synchronise les boutons avec le SFU
  // ------------------------------------------------------------
  // ASTUCE D'INTÉGRATION : l'app ne parle pas directement au SFU quand
  // tu appuies sur Micro/Caméra. Tes boutons existants coupent/activent
  // les pistes du flux LOCAL (track.enabled). Ce sondage (toutes les
  // 400 ms) compare l'état local au dernier état connu et, s'il a
  // changé, applique mute()/unmute() sur la publication SFU.
  // → Toute l'interface existante fonctionne sans être modifiée.
  function startPolling(client, room) {
    stopPolling();
    state.lastMicEnabled = null;
    state.lastCamEnabled = null;
    state.pollTimer = setInterval(() => {
      if (!state.connected || !state.room) { stopPolling(); return; }
      const lp = state.room.localParticipant;
      const micPub = lp.getTrackPublication(client.Track.Source.Microphone);
      const camPub = lp.getTrackPublication(client.Track.Source.Camera);
      const localMic = state.localStream?.getAudioTracks()[0];
      const localCam = state.localStream?.getVideoTracks()[0];
      if (micPub?.track && localMic && localMic.enabled !== state.lastMicEnabled) {
        state.lastMicEnabled = localMic.enabled;
        if (localMic.enabled) micPub.track.unmute(); else micPub.track.mute();
        console.log("[SFU] Micro", localMic.enabled ? "activé" : "coupé", "→ SFU");
      }
      if (camPub?.track && state.isVideo && localCam && localCam.enabled !== state.lastCamEnabled) {
        state.lastCamEnabled = localCam.enabled;
        if (localCam.enabled) camPub.track.unmute(); else camPub.track.mute();
        console.log("[SFU] Caméra", localCam.enabled ? "activée" : "désactivée", "→ SFU");
      }
    }, 400);
  }

  // ------------------------------------------------------------
  // stopPolling() — arrête le sondage micro/caméra
  // ------------------------------------------------------------
  // Appelé à la déconnexion et au leave pour ne laisser AUCUN timer
  // tourner en arrière-plan (économie de batterie).
  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  // ============================================================
  // API PUBLIQUE — les 3 seules portes d'entrée (window.MeetingSfu)
  // ============================================================

  // ------------------------------------------------------------
  // join(info, options) — entre en mode SFU
  // ------------------------------------------------------------
  // info    = { url, roomName, token } — envoyés par le serveur Render
  //           dans meeting-joined (champ sfu) ou meeting-sfu-switch.
  // options = { localStream, isVideo, onFailure } — le flux local à
  //           réutiliser, le type de réunion, et le callback d'échec
  //           (Meetings.js s'en sert pour replier sur le mesh).
  // Renvoie true si connecté, false en cas d'échec.
  // DÉROULÉ :
  //   1. SDK absent → échec immédiat (repli mesh) ;
  //   2. déjà connecté / en cours → ignore (anti double-join) ;
  //   3. prépare l'état + vide la grille (au cas où) ;
  //   4. crée la Room + branche les événements ;
  //   5. room.connect(url, token) — LE moment clé (signalisation,
  //      SDP, ICE : tout est géré par le SDK) ;
  //   6. affiche ma tuile, publie mon flux ;
  //   7. crée les tuiles des participants DÉJÀ présents ;
  //   8. démarre le sondage micro/caméra.
  // En cas d'échec (URL injoignable, token refusé...) : nettoyage
  // complet + callback onFailure → repli mesh par Meetings.js.
  // join({ url, roomName, token }, { localStream, isVideo, onFailure })
  async function join(info, options) {
    const client = lib();
    if (!client) {
      if (options?.onFailure) options.onFailure("SFU indisponible (SDK non chargé)");
      else toast("Connexion à la réunion impossible (SFU)");
      return false;
    }
    if (state.connected || state.joining) {
      console.warn("[SFU] Déjà connecté / connexion en cours — join ignoré");
      return true;
    }
    state.joining = true;
    state.isVideo = !!options?.isVideo;
    state.localStream = options?.localStream || state.localStream;
    state.onFailure = options?.onFailure || null;
    state.gridEl = document.getElementById("meeting-video-grid");
    clearGrid();
    try {
      const room = new client.Room({ adaptiveStream: true, dynacast: true });
      state.room = room;
      wireRoomEvents(client, room);
      // Log sans jamais afficher un token embarqué dans l'URL (sécurité).
      console.log("🛰️ [SFU] Connexion LiveKit :", info.roomName, "→", String(info.url).replace(/\/\/.*@/, "//***@"));
      await room.connect(info.url, info.token);
      console.log("🛰️ [SFU] Connecté (identité:", room.localParticipant.identity, ")");
      renderSelf(client, room);
      await publishLocal(client, room);
      // Tuiles pour les participants déjà dans la salle avant nous
      // (leurs pistes arriveront ensuite via TrackSubscribed).
      room.remoteParticipants.forEach((participant) => {
        tileFor(participant.identity, participant.name || participant.identity, false);
      });
      state.connected = true;
      state.joining = false;
      startPolling(client, room);
      return true;
    } catch (error) {
      console.error("[SFU] Échec connexion LiveKit :", error);
      state.joining = false;
      state.connected = false;
      clearGrid();
      if (state.onFailure) state.onFailure("Connexion à la réunion impossible (SFU) — repli…");
      else toast("Connexion à la réunion impossible (SFU)");
      return false;
    }
  }

  // ------------------------------------------------------------
  // leave() — quitte le SFU et nettoie TOUT
  // ------------------------------------------------------------
  // Appelé quand on quitte la réunion (Meetings.js resetMeetingState).
  // Nettoyage complet : arrêt du sondage, déconnexion de la salle,
  // suppression des tuiles, remise à zéro de chaque champ d'état.
  // Le flux local n'est PAS fermé ici : il appartient à l'app
  // (CallManager/Meetings gèrent son cycle de vie).
  async function leave() {
    stopPolling();
    const room = state.room;
    if (room) {
      try { await room.disconnect(); } catch (e) { /* ignore */ }
    }
    clearGrid();
    state.connected = false;
    state.joining = false;
    state.room = null;
    state.localStream = null;
    state.onFailure = null;
    console.log("[SFU] Session quittée");
  }

  // ------------------------------------------------------------
  // isConnected() — suis-je actuellement connecté au SFU ?
  // ------------------------------------------------------------
  // Utilisé par l'app pour savoir si les flux passent par LiveKit
  // (true) ou par le mesh (false).
  function isConnected() { return state.connected && !!state.room; }

  // Exposition publique : le seul objet posé sur window.
  window.MeetingSfu = { join, leave, isConnected };
})();
