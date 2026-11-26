// ============================================================
// MEETING SFU — adaptateur LiveKit pour les réunions > 6
// participants (au-delà du mesh WebRTC).
// ============================================================

(function () {
  "use strict";

  const state = {
    room: null,
    connected: false,
    joining: false,
    isVideo: false,
    gridEl: null,
    tiles: new Map(),
    selfTile: null,
    pollTimer: null,
    lastMicEnabled: null,
    lastCamEnabled: null,
    onFailure: null,
    localStream: null,
  };

  function lib() {
    const client = window.LivekitClient;
    if (!client) console.warn("[SFU] livekit-client non chargé (window.LivekitClient absent)");
    return client;
  }

  function toast(message) {
    if (window.callManager?.showCallToast) window.callManager.showCallToast(message);
    else console.log("[SFU]", message);
  }

  function getGrid() {
    if (!state.gridEl) state.gridEl = document.getElementById("meeting-video-grid");
    return state.gridEl;
  }

  function buildTile(identity, displayName, isSelf) {
    const grid = getGrid();
    if (!grid) return null;
    const wrap = document.createElement("div");
    wrap.className = "video-tile sfu-tile" + (isSelf ? " self" : "");
    wrap.dataset.sfuIdentity = identity;
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

  function removeTile(identity) {
    const entry = state.tiles.get(identity);
    if (!entry) return;
    if (entry.video) entry.video.srcObject = null;
    entry.wrap.remove();
    state.tiles.delete(identity);
  }

  function clearGrid() {
    state.tiles.forEach((entry) => {
      if (entry.video) entry.video.srcObject = null;
      entry.wrap.remove();
    });
    state.tiles.clear();
    state.selfTile = null;
  }

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

  function renderSelf(client, room) {
    const entry = tileFor(room.localParticipant.identity || "self", room.localParticipant.name || "Vous", true);
    if (!entry) return;
    state.selfTile = entry;
    const pub = room.localParticipant.getTrackPublication(client.Track.Source.Camera);
    if (pub?.track && !pub.isMuted) {
      try { pub.track.attach(entry.video); } catch (e) { /* ignore */ }
    }
  }

  function wireRoomEvents(client, room) {
    room.on(client.RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      const entry = tileFor(participant.identity, participant.name || participant.identity, false);
      if (!entry) return;
      try { track.attach(entry.video); } catch (e) { /* ignore */ }
      if (track.kind === "video") entry.avatar.style.display = "none";
    });
    room.on(client.RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      const entry = state.tiles.get(participant.identity);
      if (!entry) return;
      try { track.detach(entry.video); } catch (e) { /* ignore */ }
      if (track.kind === "video" && entry.video) {
        entry.video.srcObject = null;
        entry.avatar.style.display = "";
      }
    });
    room.on(client.RoomEvent.ParticipantDisconnected, (participant) => removeTile(participant.identity));
    room.on(client.RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const speakingIds = new Set(speakers.map((s) => s.identity));
      state.tiles.forEach((entry, identity) => {
        entry.wrap.classList.toggle("is-speaking", speakingIds.has(identity));
      });
    });
    room.on(client.RoomEvent.Disconnected, (reason) => {
      console.log("[SFU] Déconnecté de LiveKit :", reason || "");
      state.connected = false;
      stopPolling();
      clearGrid();
    });
  }

  // Synchronisation micro / caméra : suit l'état enabled des pistes du
  // groupLocalStream (l'UI existante ne change pas).
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

  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  // ---------- API publique ----------
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
      console.log("🛰️ [SFU] Connexion LiveKit :", info.roomName, "→", String(info.url).replace(/\/\/.*@/, "//***@"));
      await room.connect(info.url, info.token);
      console.log("🛰️ [SFU] Connecté (identité:", room.localParticipant.identity, ")");
      renderSelf(client, room);
      await publishLocal(client, room);
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

  function isConnected() { return state.connected && !!state.room; }

  window.MeetingSfu = { join, leave, isConnected };
})();
