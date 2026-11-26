# SFU LiveKit — réunions de plus de 6 participants

## Fonctionnement (mode hybride)

- **≤ 6 participants** : mesh WebRTC actuel, **aucun changement**.
- **> 6 participants** : le serveur bascule automatiquement la réunion sur le
  SFU LiveKit (relais vidéo central, scalabilité jusqu'à ~100).
- Les participants **déjà présents en mesh** reçoivent `meeting-sfu-switch` et
  basculent tous ensemble, sans quitter la réunion.
- **Sans configuration LiveKit**, tout reste en mesh : dégradation gracieuse,
  aucun plantage.

## Configuration Render (obligatoire pour activer le SFU)

Créer un projet gratuit sur [LiveKit Cloud](https://cloud.livekit.io), puis
définir ces 3 variables d'environnement sur le service Render :

| Variable           | Exemple                        | Rôle                                  |
|--------------------|--------------------------------|---------------------------------------|
| `LIVEKIT_URL`      | `wss://monprojet-xxxx.livekit.cloud` | URL WebSocket du projet LiveKit |
| `LIVEKIT_API_KEY`  | `APIxxxxxxxxxx`                | Clé API du projet                     |
| `LIVEKIT_API_SECRET` | `xxxxxxxxxxxxxxxx`           | Secret API (génère les tokens)        |

Après ajout des variables, Render redéploie automatiquement. Vérifier dans les
logs : les réunions prévues pour plus de 6 invités doivent renvoyer un champ
`sfu` dans `meeting-joined`.

## Architecture

- **Serveur** (`server/serveur.js`, section « SFU LIVEKIT ») :
  - `LIVEKIT_SFU_THRESHOLD = 6` — seuil de bascule.
  - `livekitConfigured()` — true seulement si les 3 variables env sont définies.
  - `buildLiveKitToken(meetingId, identity, displayName)` — token 6 h
    (publish / subscribe / data), salon `meeting_<meetingId>`.
  - `meetingSfuInfo(...)` — infos SFU à joindre à `meeting-joined`.
  - `broadcastSfuSwitch(...)` — notifie les présents en mesh.
  - Route REST `GET /api/meeting/:meetingId/sfu-token` — re-tokenisation.
- **Client** (`www/js/MeetingSfu.js`, SDK `www/js/vendor/livekit-client.umd.js`) :
  - Rejoue le flux local déjà acquis (aucun nouveau getUserMedia si possible).
  - Grille vidéo LiveKit dans `#meeting-video-grid`, mêmes styles que le mesh.
  - Les boutons micro / caméra existants continuent de fonctionner (poll 400 ms
    sur l'état enabled des pistes locales → mute/unmute SFU).
  - En cas d'échec SFU : repli automatique sur le mesh.

## Tests

`node test/meeting-integration-test.js` — Test 15 couvre le côté SFU
(helpers serveur, route, adaptateur client, script tags). Total attendu : 15/15.
