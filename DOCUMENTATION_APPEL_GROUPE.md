# Documentation Complète - Appel de Groupe

## Table des matières
1. [Architecture Générale](#architecture-générale)
2. [Côté Serveur - RoomManager](#côté-serveur---roommanager)
3. [Côté Client - CallManager](#côté-client---callmanager)
4. [Flux de Données](#flux-de-données)
5. [États et Transitions](#états-et-transitions)
6. [Glossaire](#glossaire)

---

## Architecture Générale

### Design Pattern : Maillage WebRTC (Mesh)
```
     Moi ────── A
      │ \      │
      │  \    │
      │   \   │
      │    \  │
      │     \ │
      └────── B
```

**Pourquoi maillage ?**
- Pas de serveur de médias central = latence minimale
- Chaque participant envoie son flux directement à tous les autres
- Scalable jusqu'à 6 participants (limite pratique)
- Style WhatsApp : décentralisé et sécurisé

**Rôles :**
- **Serveur** : Signalisation uniquement (échange SDP, ICE, gestion des salles)
- **C6lient** : WebRTC direct entre pairs (peer-to-peer)

---

## Côté Serveur - RoomManager

### Classe principale : RoomManager

#### Propriétés principales

```javascript
this.rooms = new Map();           // Toutes les salles actives
this.MAX_PARTICIPANTS = 6;        // Maximum par salle
this.INVITE_TIMEOUT_MS = 45000;   // Délai d'expiration invitation (45s)
```

**Pourquoi ces valeurs ?**
- `M
AX_PARTICIPANTS = 6` : Limite WhatsApp, raisonnable pour maillage (N-1 connexions par participant)
- `INVITE_TIMEOUT_MS = 45000` : 45 secondes comme WhatsApp pour éviter les invitations en attente trop longtemps

---

### Fonctions du Serveur

#### 1. `createRoom(creatorId, isVideo, invitees)`
**Rôle** : Crée une nouvelle salle d'appel de groupe

**Quand elle est appelée :**
- Quand un utilisateur lance un appel de groupe depuis l'écran principal
- Quand un utilisateur transforme un appel 1-à-1 en groupe

**Ce qu'elle fait :**
1. Génère un ID unique pour la salle (ex: `room_123456789_ID-user`)
2. Crée la structure de la salle avec le créateur déjà marqué "JOINED"
3. Marque tous les invités comme "RINGING"
4. Lance des timers d'expiration pour chaque invitation

**Impact :**
- Crée la salle en mémoire RAM
- Prépare le roster pour diffusion aux participants
- Démarre le cycle de vie de l'appel

---

#### 2. `joinRoom(roomId, userId)`
**Rôle** : Ajoute un participant à une salle existante

**Quand elle est appelée :**
- Quand un utilisateur accepte une invitation de groupe
- Quand un utilisateur rejoint après avoir quitté temporairement

**Ce qu'elle fait :**
1. Vérifie que la salle existe
2. Change l'état du participant de "RINGING" à "JOINED"
3. Met à jour le roster
4. Annule le timer d'expiration pour ce participant

**Impact :**
- Le participant est officiellement dans l'appel
- Les autres reçoivent un `group-roster` mis à jour
- Le participant peut commencer à établir les connexions WebRTC

---

#### 3. `leaveRoom(roomId, userId)`
**Rôle** : Retire un participant d'une salle

**Quand elle est appelée :**
- Quand un utilisateur clique sur "Quitter l'appel"
- Quand un utilisateur raccroche
- Quand le serveur détecte une déconnexion WebSocket inattendue

**Ce qu'elle fait :**
1. Change l'état du participant à "LEFT"
2. Met à jour le roster
3. Envoie le nouveau roster à tous les participants encore JOINED
4. Supprime la salle si plus personne n'est JOINED

**Impact :**
- Les autres participants voient que quelqu'un a quitté
- Les connexions WebRTC avec ce participant sont fermées côté client
- Si tout le monde quitte, la salle est supprimée de la mémoire

---

#### 4. `getRoster(roomId)`
**Rôle** : Retourne la liste des participants d'une salle

**Quand elle est appelée :**
- Après chaque modification de la salle (join/leave)
- Pour répondre aux demandes de roster

**Ce qu'elle fait :**
1. Récupère la salle depuis la Map
2. Filtre pour ne garder que les participants non marqués "LEFT"
3. Retourne un tableau avec userId et état

**Impact :**
- Permet aux clients de savoir qui est dans l'appel
- Utilisé pour afficher la grille de participants
- Utilisé pour déterminer quand basculer 1-à-1 ↔ groupe

---

#### 5. `handleGroupInvite(ws, data)`
**Rôle** : Traite les messages "group-invite" du client

**Quand elle est appelée :**
- Quand un utilisateur crée un appel de groupe
- Quand un utilisateur transforme un appel 1-à-1 en groupe

**Ce qu'elle fait :**
1. Appelle `createRoom`
2. Pour chaque invité :
   - S'il est connecté WebSocket : envoie `group-invite` direct
   - S'il a un token FCM : envoie notification push
   - Sinon : renvoie une erreur
3. Envoie `group-created` au créateur

**Impact :**
- Lance le processus d'invitation
- Notifie les participants par WebSocket (instantané) ou Push (hors ligne)
- Le créateur reçoit confirmation que la salle est créée

---

#### 6. `handleGroupJoin(ws, data)`
**Rôle** : Traite les messages "group-join" du client

**Quand elle est appelée :**
- Quand un utilisateur accepte une invitation
- Quand un utilisateur se reconnecte après une déconnexion

**Ce qu'elle fait :**
1. Appelle `joinRoom`
2. Envoie le roster complet au participant qui rejoint
3. Diffuse le nouveau roster à tous les participants

**Impact :**
- Le participant est officiellement dans l'appel
- Tout le monde reçoit la liste à jour des participants
- Déclenche l'établissement des connexions WebRTC côté client

---

#### 7. `handleGroupLeave(ws, data)`
**Rôle** : Traite les messages "group-leave" du client

**Quand elle est appelée :**
- Quand un utilisateur clique sur "Quitter l'appel"

**Ce qu'elle fait :**
1. Appelle `leaveRoom`
2. Ferme la connexion WebSocket du participant (optionnel)

**Impact :**
- Le participant quitte proprement
- Les autres sont notifiés du départ
- La salle peut être supprimée si vide

---

#### 8. `handleGroupSignal(ws, data)`
**Rôle** : Relaye les signaux WebRTC entre participants

**Quand elle est appelée :**
- À chaque message WebRTC (offer, answer, candidate, state)

**Ce qu'elle fait :**
1. Vérifie que l'expéditeur et le destinataire sont dans la même salle
2. Relaye le message uniquement au destinataire spécifié
3. N'interprète PAS le contenu (transparence totale)

**Impact :**
- Permet l'échange SDP et ICE entre pairs
- Ne stocke rien (serverless côté médias)
- Fonctionne comme un simple relais

---

### Gestion des États (Roster)

**États possibles d'un participant :**

1. **RINGING** : L'utilisateur est invité, n'a pas encore répondu
   - Timer d'expiration actif (45s)
   - Peut passer à JOINED ou DECLINED/MISSED

2. **JOINED** : L'utilisateur a accepté et participe activement
   - Peut établir des connexions WebRTC
   - Peut quitter (LEFT)

3. **LEFT** : L'utilisateur a quitté volontairement
   - Peut revenir (re-JOINED) tant que la salle existe

4. **DECLINED** : L'utilisateur a refusé l'invitation
   - Peut rejoindre plus tard (si salle active)

5. **MISSED** : L'invitation a expiré (45s sans réponse)
   - Peut rejoindre plus tard (si salle active)

**Pourquoi ces états ?**
- Permet de suivre qui est réellement dans l'appel
- Permet les reconnexions (LEFT → JOINED)
- Permet les rejetés de changer d'avis (DECLINED → JOINED)
- Style WhatsApp : flexible et user-friendly

---

## Côté Client - CallManager

### Section Groupe (lignes ~5300-7300)

#### Propriétés principales du groupe

```javascript
groupRoomId = null;              // ID de la salle actuelle
groupIsVideo = false;            // Type d'appel (true=vidéo, false=audio)
groupRoster = [];                // Liste des participants
groupPeers = new Map();          // Connexions WebRTC (userId → {pc, stream})
groupLocalStream = null;         // Mon flux micro/caméra
groupIsMuted = false;            // Mon micro coupé ?
groupIsCamOff = false;           // Ma caméra coupée ?
groupDowngradingToOneToOne = false; // Bascule en cours vers 1-à-1
```

---

### Fonctions de Cycle de Vie

#### 1. `startGroupCall(invitees, video)`
**Rôle** : Lance un nouvel appel de groupe depuis l'écran principal

**Quand elle est appelée :**
- Quand l'utilisateur sélectionne des contacts et clique "Appel vidéo/audio"

**Ce qu'elle fait :**
1. Définit `groupIsVideo` selon le paramètre
2. Appelle `acquireGroupMedia` pour obtenir le flux micro (et caméra si vidéo)
3. Appelle `sendGroupCreate` pour créer la salle

**Impact :**
- Lance l'appel de groupe
- Prépare les médias locaux
- Notifie le serveur de créer la salle

---

#### 2. `sendGroupCreate(invitees, elapsedSeconds)`
**Rôle** : Envoie la demande de création de salle au serveur

**Quand elle est appelée :**
- Depuis `startGroupCall` (nouvel appel)
- Depuis `convertCallToGroup` (transformation 1-à-1 → groupe)

**Ce qu'elle fait :**
1. Vérifie WebSocket connecté et myId défini
2. Crée un roster provisoire (moi + invités RINGING)
3. Envoie le message "group-create" au serveur
4. Affiche l'écran de groupe

**Impact :**
- Le serveur crée la salle
- Les invitations sont envoyées aux participants
- L'écran de groupe s'affiche avec "Connexion..."

---

#### 3. `acceptGroupInvite()`
**Rôle** : Accepte une invitation d'appel de groupe reçue

**Quand elle est appelée :**
- Quand l'utilisateur clique sur "Accepter" dans la notification push ou l'écran d'invitation

**Ce qu'elle fait :**
1. Définit `groupRoomId` et `groupIsVideo` depuis l'invitation
2. Appelle `acquireGroupMedia` pour obtenir le flux
3. Prépare le roster provisoire
4. Envoie "group-join" au serveur
5. Affiche l'écran de groupe

**Impact :**
- L'utilisateur rejoint l'appel
- Les médias sont prêts
- Le serveur notifie les autres participants

---

#### 4. `convertCallToGroup(newIds)`
**Rôle** : Transforme un appel 1-à-1 en appel de groupe

**Quand elle est appelée :**
- Quand l'utilisateur clique sur "Ajouter un participant" pendant un appel 1-à-1

**Ce qu'elle fait :**
1. Appelle `handOverCallToGroup` pour transférer le flux et l'état
2. Appelle `adoptCarriedMedia` pour configurer le groupe avec ces données
3. Sauvegarde l'ancien peerConnection pour le fermer plus tard
4. Marque l'interlocuteur actuel comme "en migration"
5. Appelle `sendGroupCreate` avec l'interlocuteur + les nouveaux

**Impact :**
- L'appel 1-à-1 devient un appel de groupe
- L'interlocuteur actuel est automatiquement invité au groupe
- Les nouveaux participants sont invités
- L'appel continue sans interruption (grâce au peerConnection sauvegardé)

---

#### 5. `joinGroupFromCall(data)`
**Rôle** : Rejoint un groupe quand l'interlocuteur 1-à-1 en a créé un

**Quand elle est appelée :**
- Quand on reçoit un message "group-invite" pendant un appel 1-à-1

**Ce qu'elle fait :**
1. Appelle `handOverCallToGroup` pour transférer le flux
2. Appelle `adoptCarriedMedia` pour configurer le groupe
3. Définit `groupRoomId` et `groupIsVideo` depuis les données
4. Prépare le roster provisoire
5. Envoie "group-join" au serveur
6. Ferme l'ancien peerConnection 1-à-1

**Impact :**
- L'appel 1-à-1 se transforme automatiquement en groupe
- Pas d'interruption pour l'utilisateur
- La transition est transparente

---

#### 6. `leaveGroupCall(message)`
**Rôle** : Quitte l'appel de groupe proprement

**Quand elle est appelée :**
- Quand l'utilisateur clique sur "Quitter l'appel"

**Ce qu'elle fait :**
1. Marque `groupIsLeaving = true`
2. Envoie "group-leave" au serveur
3. Appelle `finishGroupCall` pour nettoyer

**Impact :**
- Les autres participants sont notifiés du départ
- L'utilisateur retourne à l'écran principal
- Toutes les connexions WebRTC sont fermées

---

#### 7. `finishGroupCall(message)`
**Rôle** : Nettoie l'état et ferme l'appel côté client

**Quand elle est appelée :**
- Depuis `leaveGroupCall`
- Quand l'appel se termine (tout le monde parti, timeout, etc.)

**Ce qu'elle fait :**
1. Appelle `cleanGroupState` pour nettoyer timers, connexions, médias
2. Ferme toutes les interfaces
3. Met à jour le statut "En ligne"
4. Nettoie l'état de l'appel 1-à-1 (pour désactiver le bouton d'appel)

**Impact :**
- Retour à l'état initial
- Libération des ressources (caméra, micro, CPU)
- Prêt pour un nouvel appel

---

### Fonctions de Gestion des Médias

#### 8. `acquireGroupMedia(video)`
**Rôle** : Obtient le flux micro (et caméra si vidéo)

**Quand elle est appelée :**
- Avant de créer un groupe (`startGroupCall`)
- Avant d'accepter une invitation (`acceptGroupInvite`)

**Ce qu'elle fait :**
1. Demande l'autorisation média sur iOS si nécessaire
2. Appelle `getUserMedia` avec audio (et video si paramètre true)
3. Stocke le flux dans `groupLocalStream`

**Impact :**
- Le flux micro/caméra est prêt pour être partagé
- Les permissions sont demandées à l'utilisateur
- Résolution modeste (640x480) pour économiser bande passante

---

#### 9. `toggleGroupMic()`
**Rôle** : Active/désactive le micro

**Quand elle est appelée :**
- Quand l'utilisateur clique sur le bouton micro

**Ce qu'elle fait :**
1. Inverse `groupIsMuted`
2. Active/désactive la piste audio du flux
3. Met à jour l'UI (bouton, tuile)
4. Envoie un message "state" (micMuted) à tous

**Impact :**
- Les autres voient l'icône micro coupé sur ma tuile
- Le son n'est plus envoyé si coupé
- État synchronisé avec tous les participants

---

#### 10. `toggleGroupCamera()`
**Rôle** : Active/désactive la caméra (ou l'ajoute si pas présente)

**Quand elle est appelée :**
- Quand l'utilisateur clique sur le bouton caméra

**Ce qu'elle fait :**
**Cas 1 : Pas de piste vidéo (appel audio)**
1. Obtient un nouveau flux vidéo avec `getUserMedia`
2. Ajoute la piste vidéo au `groupLocalStream`
3. Ajoute la piste à TOUTES les connexions WebRTC existantes
4. Renégocie avec chaque participant (`renegotiateWithPeer`)
5. Marque `groupIsVideo = true` et `groupIsCamOff = false`
6. Met à jour l'UI et envoie "state" à tous

**Cas 2 : Piste vidéo déjà présente**
1. Inverse `groupIsCamOff`
2. Active/désactive la piste vidéo
3. Si activation et `groupIsVideo` était false, met à true
4. Met à jour l'UI et envoie "state" à tous

**Impact :**
- **Cas 1** : Caméra activée, les autres reçoivent ma vidéo après renégociation
- **Cas 2** : Caméra allumée/éteinte instantanément (pas de renégociation)
- Message "state" notifie les autres de l'état caméra

---

#### 11. `switchGroupCamera()`
**Rôle** : Bascule entre caméra avant et arrière

**Quand elle est appelée :**
- Quand l'utilisateur clique sur le bouton "retourner caméra"

**Ce qu'elle fait :**
1. Vérifie qu'une piste vidéo existe, sinon l'active d'abord
2. Obtient un nouveau flux avec la caméra opposée
3. Pour chaque connexion WebRTC :
   - Trouve le sender vidéo
   - Appelle `replaceTrack` pour remplacer l'ancienne piste
4. Met à jour `groupLocalStream` avec la nouvelle piste
5. Inverse `groupIsFrontCamera`
6. Met à jour l'UI

**Impact :**
- La caméra change instantanément (pas de renégociation)
- Les autres voient la nouvelle caméra
- Fonctionne même pendant l'appel (sans interruption)

---

#### 12. `toggleGroupSpeaker()`
**Rôle** : Bascule entre haut-parleur et écouteur

**Quand elle est appelée :**
- Quand l'utilisateur clique sur le bouton haut-parleur

**Ce qu'elle fait :**
1. Inverse `groupSpeakerOn`
2. Android : appelle `setAudioRoute` (plugin)
3. iOS : appelle `activerAudioSessionIOS` (native)
4. Met à jour l'UI

**Impact :**
- Le son sort par le haut-parleur ou l'écouteur
- Préférence enregistrée pour les appels futurs

---

### Fonctions de Gestion des Connexions WebRTC

#### 13. `createGroupPeer(peerId)`
**Rôle** : Crée une connexion WebRTC avec un participant

**Quand elle est appelée :**
- Quand un nouveau participant JOINED et je suis l'initiateur
- Quand je rejoins un groupe (pour chaque participant déjà là)

**Ce qu'elle fait :**
1. Crée un nouveau RTCPeerConnection avec la configuration ICE
2. Attache mes pistes audio/vidéo à la connexion
3. Configure les handlers :
   - `onicecandidate` : envoie les candidats ICE au participant
   - `ontrack` : reçoit les pistes du participant
   - `onconnectionstatechange` / `oniceconnectionstatechange` : suit l'état
4. Stocke la connexion dans `groupPeers`

**Impact :**
- Une connexion WebRTC est créée avec ce participant
- Mes médias sont partagés
- Prêt à recevoir les médias du participant

---

#### 14. `sendGroupOffer(peerId)`
**Rôle** : Envoie une offre SDP à un participant

**Quand elle est appelée :**
- Juste après `createGroupPeer`
- Quand je suis l'initiateur de la connexion

**Ce qu'elle fait :**
1. Récupère la connexion du participant
2. Crée une offre avec `createOffer` (audio + vidéo toujours)
3. Définit l'offre comme description locale
4. Envoie l'offre au participant via le serveur
5. Applique la limitation de bitrate vidéo

**Impact :**
- Le participant reçoit mon offre SDP
- Il peut créer une réponse et établir la connexion
- Démarre le handshake WebRTC

---

#### 15. `handleGroupOffer(from, sdp)`
**Rôle** : Traite une offre SDP reçue d'un participant

**Quand elle est appelée :**
- Quand je reçois un message "group-signal" avec kind="offer"

**Ce qu'elle fait :**
**Cas 1 : Nouvelle connexion (pas de peer existant)**
1. Crée un nouveau peer avec `createGroupPeer`
2. Définit l'offre comme description distante
3. Applique les candidats ICE en attente
4. Crée une réponse avec `createAnswer`
5. Définit la réponse comme description locale
6. Envoie la réponse au participant
7. Applique la limitation de bitrate

**Cas 2 : Renégociation (peer existe déjà)**
1. Récupère le peer existant
2. Définit l'offre comme description distante
3. Applique les candidats ICE en attente
4. Crée une réponse
5. Définit la réponse comme description locale
6. Envoie la réponse
7. Applique la limitation de bitrate

**Impact :**
- Connexion WebRTC établie ou renégociée
- Médias peuvent commencer à circuler
- Handshake complet

---

#### 16. `handleGroupAnswer(from, sdp)`
**Rôle** : Traite une réponse SDP reçue

**Quand elle est appelée :**
- Quand je reçois un message "group-signal" avec kind="answer"

**Ce qu'elle fait :**
1. Vérifie que je suis dans l'état "have-local-offer"
2. Définit la réponse comme description distante
3. Applique les candidats ICE en attente

**Impact :**
- Handshake WebRTC complété
- Connexion prête à transmettre
- Candidats ICE appliqués

---

#### 17. `handleGroupCandidate(from, candidate)`
**Rôle** : Traite un candidat ICE reçu

**Quand elle est appelée :**
- Quand je reçois un message "group-signal" avec kind="candidate"

**Ce qu'elle fait :**
1. Récupère le peer du participant
2. Si la description distante n'est pas encore définie :
   - Met le candidat en attente dans `pendingCandidates`
3. Sinon :
   - Applique immédiatement le candidat avec `addIceCandidate`

**Impact :**
- Le chemin réseau est établi
- Médias peuvent traverser NAT/firewall
- Connexion stabilisée

---

#### 18. `renegotiateWithPeer(peerId)`
**Rôle** : Renégocie avec un participant (ex: ajout de piste vidéo)

**Quand elle est appelée :**
- Quand j'active ma caméra (ajout de piste vidéo)
- Quand un participant active sa caméra et je demande renégociation

**Ce qu'elle fait :**
1. Récupère la connexion du participant
2. Crée une nouvelle offre avec `createOffer`
3. Définit l'offre comme description locale
4. Envoie l'offre au participant

**Impact :**
- Les nouvelles pistes sont partagées
- Le participant reçoit la mise à jour
- Utile pour activation caméra pendant appel audio

---

#### 19. `handleGroupTrack(peerId, event)`
**Rôle** : Traite une piste média reçue d'un participant

**Quand elle est appelée :**
- Quand `ontrack` se déclenche sur une connexion WebRTC

**Ce qu'elle fait :**
1. Stocke le stream dans le peer
2. Si c'est une piste audio : appelle `attachGroupAudio`
3. Met à jour la tuile du participant (`updateGroupTile`)

**Impact :**
- Le flux média du participant est reçu
- L'audio est branché sur un élément <audio>
- La tuile affiche la vidéo si présente

---

#### 20. `attachGroupAudio(peerId, peer)`
**Rôle** : Branche l'audio d'un participant sur un élément <audio>

**Quand elle est appelée :**
- Depuis `handleGroupTrack` quand une piste audio arrive

**Ce qu'elle fait :**
1. Crée un élément <audio> si n'existe pas
2. Configure autoplay, playsinline, volume
3. Attache le stream à l'élément
4. Tente de jouer (avec retry en cas d'erreur)

**Impact :**
- Le son du participant est audible
- Les <video> des tuiles restent muets (évite écho)
- Audio optimisé pour la lecture

---

#### 21. `closeGroupPeer(peerId)`
**Rôle** : Ferme la connexion avec un participant

**Quand elle est appelée :**
- Quand un participant quitte le groupe
- Quand je quitte le groupe (pour tous les peers)

**Ce qu'elle fait :**
1. Supprime le peer de `groupPeers`
2. Nettoie tous les handlers (onicecandidate, ontrack, etc.)
3. Ferme la connexion WebRTC
4. Supprime l'élément <audio> associé

**Impact :**
- Connexion terminée proprement
- Ressources libérées
- Plus de réception de médias de ce participant

---

### Fonctions de Gestion de l'UI

#### 22. `showGroupScreen(elapsedSeconds)`
**Rôle** : Affiche l'écran d'appel de groupe

**Quand elle est appelée :**
- Après création de la salle (`sendGroupCreate`)
- Après acceptation d'invitation (`acceptGroupInvite`)

**Ce qu'elle fait :**
1. Affiche l'interface-4 (écran de groupe)
2. Définit data-video selon `groupIsVideo`
3. Met à jour le timer avec le temps écoulé (si fourni)
4. Affiche "Connexion..." dans le statut

**Impact :**
- L'utilisateur voit l'écran de groupe
- L'état visuel reflète le type d'appel
- Le timer est synchronisé

---

#### 23. `renderGroupGrid()`
**Rôle** : Affiche la grille des participants

**Quand elle est appelée :**
- À chaque mise à jour du roster
- Quand un participant JOINED/LEFT
- Quand je rejoins un groupe

**Ce qu'elle fait :**
1. Récupère la liste des IDs à afficher
2. Supprime les tuiles des participants qui ne sont plus dans le roster
3. Crée les tuiles des nouveaux participants
4. Réordonne les tuiles selon le roster
5. Met à jour la classe CSS du grid selon le nombre de participants

**Impact :**
- La grille affiche tous les participants
- L'ordre est synchronisé avec le serveur
- Responsive : 1-6 participants avec layouts différents

---

#### 24. `createGroupTile(userId)`
**Rôle** : Crée l'élément DOM d'une tuile de participant

**Quand elle est appelée :**
- Depuis `renderGroupGrid` pour chaque nouveau participant

**Ce qu'elle fait :**
1. Crée un <div> avec classe "group-tile"
2. Ajoute "is-self" si c'est moi
3. Insère le HTML :
   - <video> pour l'image
   - <div> avatar avec initiale
   - <i> badge micro coupé
   - <div> info (nom, statut)

**Impact :**
- Structure visuelle créée pour chaque participant
- Prête à être remplie par `updateGroupTile`

---

#### 25. `updateGroupTile(userId)`
**Rôle** : Met à jour le contenu d'une tuile

**Quand elle est appelée :**
- Quand un participant change d'état (RINGING → JOINED)
- Quand un participant active/désactive micro/caméra
- Quand une piste vidéo est reçue
- Quand un participant parle (détection orateur)

**Ce qu'elle fait :**
1. Récupère la tuile du participant
2. Détermine l'état (RINGING, JOINED, etc.)
3. Récupère le stream du participant
4. Vérifie s'il a une piste vidéo
5. Met à jour :
   - Nom du participant
   - Initiale de l'avatar
   - Statut ("Sonne...", "Connexion...", "")
   - Classes CSS (is-ringing, is-muted, is-speaking, has-video)
   - <video> : attache le stream si vidéo présente
   - Badge micro coupé : affiche si micro coupé

**Impact :**
- La tuile reflète l'état actuel du participant
- La vidéo s'affiche quand disponible
- Les badges (micro, orateur) sont à jour

---

#### 26. `updateGroupHeader()`
**Rôle** : Met à jour l'en-tête de l'écran de groupe

**Quand elle est appelée :**
- Depuis `renderGroupGrid`

**Ce qu'elle fait :**
1. Compte le nombre de participants
2. Met à jour le titre ("Appel de groupe", "Appel vidéo", etc.)
3. Met à jour le statut selon l'état des connexions

**Impact :**
- L'en-tête affiche des informations utiles
- L'utilisateur sait combien de participants sont là

---

#### 27. `updateGroupMicUI()`
**Rôle** : Met à jour le bouton micro selon l'état

**Quand elle est appelée :**
- Quand le micro est activé/désactivé
- Quand on rejoint un groupe

**Ce qu'elle fait :**
1. Met à jour l'icône du bouton (micro / micro barré)
2. Met à jour le label ("Micro" / "Muet")
3. Met à jour la classe CSS (active-mute si coupé)

**Impact :**
- Le bouton reflète l'état actuel du micro
- Feedback visuel clair pour l'utilisateur

---

#### 28. `updateGroupCamUI()`
**Rôle** : Met à jour le bouton caméra selon l'état

**Quand elle est appelée :**
- Quand la caméra est activée/désactivée
- Quand on rejoint un groupe

**Ce qu'elle fait :**
1. Met à jour l'icône du bouton (caméra / caméra barrée)
2. Met à jour la classe CSS selon l'état

**Impact :**
- Le bouton reflète l'état actuel de la caméra
- Feedback visuel clair pour l'utilisateur

---

#### 29. `updateGroupSpeakerUI()`
**Rôle** : Met à jour le bouton haut-parleur selon l'état

**Quand elle est appelée :**
- Quand le haut-parleur est activé/désactivé
- Quand on rejoint un groupe

**Ce qu'elle fait :**
1. Met à jour l'icône du bouton (volume haut / bas)
2. Met à jour la classe CSS selon l'état

**Impact :**
- Le bouton reflète l'état actuel du haut-parleur
- Feedback visuel clair pour l'utilisateur

---

### Fonctions de Gestion du Roster

#### 30. `applyGroupRoster(roster)`
**Rôle** : Applique un nouveau roster reçu du serveur

**Quand elle est appelée :**
- Quand on reçoit un message "group-roster"

**Ce qu'elle fait :**
1. Remplace `groupRoster` avec le nouveau
2. Identifie les nouveaux participants (JOINED)
3. Identifie les participants partis (LEFT)
4. Pour les nouveaux :
   - Si je suis l'initiateur, crée la connexion et envoie l'offre
5. Pour les partis :
   - Ferme la connexion avec eux
   - Supprime leur tuile
6. Pour les participants existants avec nouveaux arrivants :
   - Renégocie pour envoyer les pistes vidéo actuelles
7. Appelle `renderGroupGrid`
8. Appelle `checkGroupAlone`

**Impact :**
- L'état est synchronisé avec le serveur
- Les connexions sont créées/fermées automatiquement
- La grille est mise à jour
- Les transitions 1-à-1 ↔ groupe sont gérées

---

#### 31. `checkGroupAlone()`
**Rôle** : Vérifie si je suis seul dans l'appel

**Quand elle est appelée :**
- Depuis `applyGroupRoster`

**Ce qu'elle fait :**
1. Compte les autres participants (JOINED ou RINGING)
2. Si 0 autres :
   - Lance un timer (2s) puis quitte automatiquement
3. Si 1 autre :
   - Si pas déjà en cours, lance `downgradeGroupToOneToOne`
4. Si 2+ autres :
   - Si on était en mode 1-à-1, lance `upgradeToGroupInterface`

**Impact :**
- Quitte automatiquement si personne ne répond
- Bascule vers 1-à-1 si 2 participants restants
- Bascule vers groupe si un 3ème rejoint

---

#### 32. `downgradeGroupToOneToOne(otherId)`
**Rôle** : Bascule de l'interface de groupe vers 1-à-1

**Quand elle est appelée :**
- Quand on passe de 3+ à 2 participants

**Ce qu'elle fait :**
1. Récupère la connexion WebRTC avec l'autre participant
2. Détermine l'interface (vidéo ou audio) selon `groupIsVideo`
3. Affiche l'interface 1-à-1 appropriée
4. Si vidéo :
   - Attache la vidéo distante au <video> remote-video
   - Attache ma vidéo locale au <video> local-video
   - Masque le placeholder
   - Affiche les contrôles vidéo
5. Si audio :
   - Active les boutons de contrôle audio
6. Met à jour le nom du contact
7. Maintient la connexion WebRTC active (ne la ferme pas)
8. Met à jour `targetUserId`, `peerConnection`, `localStream`
9. Met à jour `isVideoCall` selon `groupIsVideo`

**Impact :**
- L'interface passe de groupe à 1-à-1
- La connexion continue sans interruption
- L'expérience est fluide comme WhatsApp

---

#### 33. `upgradeToGroupInterface()`
**Rôle** : Bascule de l'interface 1-à-1 vers groupe

**Quand elle est appelée :**
- Quand on passe de 2 à 3+ participants

**Ce qu'elle fait :**
1. Réaffiche l'interface de groupe
2. Met à jour data-video selon `groupIsVideo`
3. Réinitialise la grille de groupe
4. Met à jour les contrôles de groupe (micro, caméra, haut-parleur)
5. Démarre/continue le timer de groupe
6. Démarre/continue la détection de l'orateur

**Impact :**
- L'interface passe de 1-à-1 à groupe
- L'état visuel est mis à jour
- Les fonctionnalités de groupe sont réactivées

---

### Fonctions Utilitaires

#### 34. `handOverCallToGroup()`
**Rôle** : Transfère l'état de l'appel 1-à-1 au groupe

**Quand elle est appelée :**
- Depuis `convertCallToGroup`
- Depuis `joinGroupFromCall`

**Ce qu'elle fait :**
1. Récupère le stream local 1-à-1
2. Détermine si c'est vidéo (isVideoCall + caméra activée)
3. Récupère l'état (micro coupé, caméra coupée, etc.)
4. Récupère le temps écoulé
5. Sauvegarde le peerConnection actif (à fermer plus tard)
6. Détache le flux du peerConnection
7. Neutralise le peerConnection (supprime les handlers)
8. Nettoie l'état 1-à-1 partiellement

**Impact :**
- L'appel 1-à-1 est transféré au groupe
- Le flux média est conservé
- Pas d'interruption pour l'utilisateur

---

#### 35. `adoptCarriedMedia(carry)`
**Rôle** : Adopte les médias transférés de l'appel 1-à-1

**Quand elle est appelée :**
- Depuis `convertCallToGroup`
- Depuis `joinGroupFromCall`

**Ce qu'elle fait :**
1. Définit `groupLocalStream` avec le stream transféré
2. Définit `groupIsVideo` selon le transfert
3. Définit `groupIsMuted`, `groupIsCamOff`, etc.
4. Réinitialise `groupIsLeaving`

**Impact :**
- Le groupe reprend les médias de l'appel 1-à-1
- L'état est synchronisé
- Prêt pour le groupe

---

#### 36. `isGroupInitiator(peerId)`
**Rôle** : Détermine si je dois initier la connexion avec un participant

**Quand elle est appelée :**
- Dans `applyGroupRoster` pour décider qui crée la connexion

**Ce qu'elle fait :**
1. Compare mon ID avec l'ID du participant
2. Retourne true si mon ID est "plus petit" (lexicographiquement)

**Impact :**
- Évite les connexions en double
- Chaque connexion est créée par un seul participant
- Algorithme déterministe et fiable

---

#### 37. `getGroupDisplayIds()`
**Rôle** : Retourne la liste des IDs à afficher dans la grille

**Quand elle est appelée :**
- Depuis `renderGroupGrid`

**Ce qu'elle fait :**
1. Filtre le roster pour garder seulement JOINED
2. Ajoute "moi" en premier
3. Trie par ordre d'arrivée dans le roster

**Impact :**
- La grille affiche les bons participants
- L'ordre est cohérent

---

#### 38. `cleanGroupState()`
**Rôle** : Nettoie tout l'état de groupe

**Quand elle est appelée :**
- Depuis `finishGroupCall`

**Ce qu'elle fait :**
1. Annule tous les timers (alone, invite, request, migrate)
2. Met `groupDowngradingToOneToOne = false`
3. Arrête le timer de groupe
4. Arrête la détection de l'orateur
5. Ferme toutes les connexions WebRTC
6. Arrête toutes les pistes du stream local
7. Supprime toutes les tuiles de la grille
8. Vide tous les Maps (peers, states, tiles, etc.)
9. Réinitialise toutes les propriétés

**Impact :**
- Retour à l'état initial propre
- Aucune ressource n'est laissée active
- Prêt pour un nouvel appel

---

#### 39. `capGroupVideoBitrate(pc)`
**Rôle** : Limite le bitrate vidéo pour économiser la bande passante

**Quand elle est appelée :**
- Après chaque création de connexion WebRTC

**Ce qu'elle fait :**
1. Récupère tous les senders vidéo
2. Pour chaque sender :
   - Récupère les paramètres actuels
   - Applique un maxBitrate de 500 kbps
   - Applique les nouveaux paramètres

**Impact :**
- Bande passante maîtrisée
- Meilleure performance sur mobile
- Compatible avec maillage (N-1 flux envoyés)

---

#### 40. `sendGroupSignal(peerId, payload)`
**Rôle** : Envoie un signal WebRTC à un participant

**Quand elle est appelée :**
- Pour envoyer offer, answer, candidate, state

**Ce qu'elle fait :**
1. Envoie un message "group-signal" au serveur
2. Inclut le roomId, le destinataire, et le payload

**Impact :**
- Le serveur relaie le message au bon participant
- Communication peer-to-peer via le serveur

---

#### 41. `sendGroupSignalToAll(payload)`
**Rôle** : Envoie un signal à tous les participants JOINED

**Quand elle est appelée :**
- Pour envoyer l'état micro/caméra à tous

**Ce qu'elle fait :**
1. Parcourt le roster
2. Pour chaque participant JOINED (sauf moi) :
   - Appelle `sendGroupSignal`

**Impact :**
- Tous les participants reçoivent le message
- État synchronisé avec tout le monde

---

#### 42. `closePeerConnectionSilently(pc)`
**Rôle** : Ferme un peerConnection sans erreurs

**Quand elle est appelée :**
- Après que le groupe est rejoint (pour fermer l'ancien peer 1-à-1)

**Ce qu'elle fait :**
1. Nettoie tous les handlers
2. Ferme la connexion
3. Attrape les erreurs silencieusement

**Impact :**
- Fermeture propre sans logs d'erreur
- L'ancienne connexion est libérée

---

### Fonctions de Timer

#### 43. `startGroupTimer()`
**Rôle** : Démarre le timer de l'appel de groupe

**Quand elle est appelée :**
- Quand l'appel de groupe commence

**Ce qu'elle fait :**
1. Stocke le temps de début
2. Crée un intervalle (1s)
3. À chaque seconde :
   - Calcule le temps écoulé
   - Formate en HH:MM:SS
   - Met à jour l'élément #timer-group

**Impact :**
- L'utilisateur voit la durée de l'appel
- Format standard (00:00:00)

---

#### 44. `stopGroupTimer()`
**Rôle** : Arrête le timer de l'appel de groupe

**Quand elle est appelée :**
- Quand l'appel se termine

**Ce qu'elle fait :**
1. Annule l'intervalle
2. Réinitialise `groupTimerInterval`

**Impact :**
- Le timer arrête de s'incrémenter
- Ressources libérées

---

#### 45. `getGroupElapsedSeconds()`
**Rôle** : Retourne le temps écoulé en secondes

**Quand elle est appelée :**
- Quand on transforme un appel 1-à-1 en groupe (pour garder le chrono)

**Ce qu'elle fait :**
1. Lit le timer de groupe
2. Convertit en secondes
3. Retourne la valeur

**Impact :**
- Le chrono est conservé lors de la transition
- L'utilisateur ne perd pas le temps déjà écoulé

---

### Fonctions de Détection de l'Orateur

#### 46. `startGroupSpeakerDetection()`
**Rôle** : Démarre la détection de qui parle

**Quand elle est appelée :**
- Quand l'appel de groupe commence

**Ce qu'elle fait :**
1. Crée un AudioContext
2. Pour chaque participant :
   - Crée un AnalyserNode
   - Connecte l'audio à l'analyser
   - Stocke l'analyser dans une Map
3. Crée un intervalle (100ms)
4. À chaque intervalle :
   - Mesure le volume de chaque participant
   - Identifie le plus fort
   - Met à jour `groupActiveSpeakerId`
   - Met à jour les tuiles (classe is-speaking)

**Impact :**
- L'utilisateur voit qui parle (tuile surlignée)
- Améliore l'expérience utilisateur
- Style WhatsApp

---

#### 47. `stopGroupSpeakerDetection()`
**Rôle** : Arrête la détection de l'orateur

**Quand elle est appelée :**
- Quand l'appel se termine

**Ce qu'elle fait :**
1. Annule l'intervalle
2. Ferme l'AudioContext
3. Vide la Map d'analyseurs

**Impact :**
- La détection arrête
- Ressources CPU libérées
- AudioContext fermé proprement

---

## Flux de Données

### Scénario 1 : Création d'un appel de groupe

```
Utilisateur A sélectionne B et C → clique "Appel vidéo"
  ↓
startGroupCall([B, C], true)
  ↓
acquireGroupMedia(true) → getUserMedia({audio, video})
  ↓
sendGroupCreate([B, C])
  ↓
Message "group-create" au serveur
  ↓
Serveur : createRoom(A, true, [B, C])
  ↓
Serveur → A : "group-created" + roster
Serveur → B : "group-invite" (si connecté) ou Push
Serveur → C : "group-invite" (si connecté) ou Push
  ↓
A : showGroupScreen() + renderGroupGrid()
  ↓
A : applyGroupRoster() → isGroupInitiator(B)=true, isGroupInitiator(C)=true
  ↓
A : createGroupPeer(B) + sendGroupOffer(B)
A : createGroupPeer(C) + sendGroupOffer(C)
  ↓
B : reçoit "group-invite" → acceptGroupInvite()
B : acquireGroupMedia(true) + "group-join"
  ↓
B : receive "group-roster" → applyGroupRoster()
B : isGroupInitiator(A)=false → attend l'offre de A
  ↓
B : handleGroupOffer(A) → handleGroupAnswer(A)
  ↓
Connexion A ↔ B établie
```

### Scénario 2 : Transformation 1-à-1 → Groupe

```
A et B sont en appel 1-à-1
A clique "Ajouter participant" → sélectionne C
  ↓
convertCallToGroup([C])
  ↓
handOverCallToGroup() → conserve stream, peerConnection
adoptCarriedMedia(carry) → configure groupe
  ↓
sendGroupCreate([B, C])
  ↓
Serveur : createRoom(A, isVideo, [B, C])
  ↓
Serveur → A : "group-created"
Serveur → B : "group-invite" (WebSocket, pas de sonnerie)
Serveur → C : "group-invite" (sonnerie normale)
  ↓
A : showGroupScreen() + renderGroupGrid()
  ↓
B : reçoit "group-invite" pendant appel
B : joinGroupFromCall(data)
  ↓
B : handOverCallToGroup() + adoptCarriedMedia()
B : "group-join" + closePeerConnectionSilently(ancien)
  ↓
Transition transparente : appel 1-à-1 → groupe
```

### Scénario 3 : Activation caméra pendant appel audio

```
A, B, C en appel audio (groupIsVideo = false)
A clique bouton caméra
  ↓
toggleGroupCamera()
  ↓
Pas de piste vidéo → getUserMedia({video})
  ↓
addTrack(videoTrack, groupLocalStream)
  ↓
Pour chaque peer (B, C) :
  pc.addTrack(videoTrack, groupLocalStream)
  renegotiateWithPeer(peerId)
  ↓
renegotiateWithPeer(B) → createOffer + "group-signal" (offer)
renegotiateWithPeer(C) → createOffer + "group-signal" (offer)
  ↓
B : handleGroupOffer(A) → handleGroupAnswer(A)
  ↓
B : handleGroupTrack(A) → piste vidéo reçue
  ↓
B : updateGroupTile(A) → showVideo = true
  ↓
B voit la vidéo de A
(groupIsVideo reste false pour les transitions)
```

### Scénario 4 : Bascule Groupe → 1-à-1

```
A, B, C en appel de groupe
C quitte l'appel
  ↓
Serveur : leaveRoom(roomId, C)
  ↓
Serveur → A, B : "group-roster" (seulement A, B)
  ↓
A : applyGroupRoster()
  ↓
A : checkGroupAlone() → others.length === 1
  ↓
A : downgradeGroupToOneToOne(B)
  ↓
Récupère peer(B) + stream(B)
  ↓
Affiche interface-1 (audio car groupIsVideo = false)
  ↓
toggleCallButtons(true) + toggleCallControlButtons(true)
  ↓
A continue de parler avec B en interface 1-à-1
```

---

## États et Transitions

### Cycle de vie d'un participant

```
RINGING (invité, 45s max)
  ↓ acceptGroupInvite()
JOINED (actif, peut établir connexions)
  ↓ leaveGroupCall()
LEFT (quitté, peut revenir)
  ↓ rejoin
JOINED
```

```
RINGING
  ↓ expiration (45s)
MISSED (peut revenir)
  ↓ rejoin
JOINED
```

```
RINGING
  ↓ refus
DECLINED (peut changer d'avis)
  ↓ rejoin
JOINED
```

### Transitions Interface

```
Écran principal
  ↓ startGroupCall()
Écran groupe (RINGING)
  ↓ participant accepte
Écran groupe (JOINED)
  ↓ activation caméra
Écran groupe (JOINED + vidéo)
  ↓ participant quitte
Écran groupe (JOINED)
  ↓ reste 2 participants
Écran 1-à-1
  ↓ ajout participant
Écran groupe
```

---

## Glossaire

### Termes Techniques

- **SDP (Session Description Protocol)** : Format décrivant les capacités média (codecs, résolutions, etc.)
- **ICE (Interactive Connectivity Establishment)** : Protocole pour traverser NAT/firewall
- **Candidate ICE** : Adresse réseau possible pour établir la connexion
- **Signaling** : Échange de métadonnées (SDP, ICE) pour établir WebRTC
- **PeerConnection** : Objet WebRTC représentant une connexion pair-à-pair
- **MediaStream** : Flux contenant des pistes audio/vidéo
- **Track** : Piste individuelle (audio ou vidéo) dans un MediaStream
- **Renégociation** : Mise à jour d'une connexion existante (ex: ajout de piste vidéo)
- **Maillage (Mesh)** : Architecture où chaque participant est connecté à tous les autres
- **Roster** : Liste des participants dans une salle

### États du Roster

- **RINGING** : En train de sonner, n'a pas encore répondu
- **JOINED** : A accepté, participe activement
- **LEFT** : A quitté volontairement
- **DECLINED** : A refusé l'invitation
- **MISSED** : Invitation expirée (pas de réponse)

### États WebRTC

- **new** : Connexion créée, pas encore connectée
- **connecting** : En cours de connexion (échange ICE)
- **connected** : Connectée, médias peuvent circuler
- **disconnected** : Connexion perdue temporairement
- **failed** : Connexion échouée définitivement
- **closed** : Connexion fermée

---

## Bonnes Pratiques

### Côté Serveur

1. **Toujours vérifier l'état** avant de modifier une salle
2. **Nettoyer les salles vides** pour libérer la mémoire
3. **Utiliser des timers** pour les invitations expirées
4. **Relayer sans interpréter** les messages WebRTC (transparence)
5. **Diffuser le roster** après chaque modification

### Côté Client

1. **Acquérir les médias AVANT** de créer/joindre une salle
2. **Fermer proprement** les connexions (handlers, tracks, pc)
3. **Gérer les erreurs** avec try/catch (ne pas crash l'app)
4. **Utiliser des flags** pour éviter les actions en double
5. **Renégocier seulement quand nécessaire** (ajout piste vidéo)
6. **Limiter le bitrate** pour la performance mobile

### Sécurité

1. **Vérifier les IDs** (ne pas faire confiance aveuglément)
2. **Ne pas stocker de secrets** côté client
3. **Utiliser HTTPS/WSS** pour tout le trafic
4. **Valider les entrées** côté serveur
5. **Sanitiser les noms** (pas d'HTML dans les tuiles)

---

## Résumé

L'appel de groupe utilise une architecture **maillage WebRTC** où :

- **Serveur** : Gère les salles, le roster, et relaie les signaux
- **Client** : Établit des connexions directes pair-à-pair
- **Flux** : Signaling via serveur, médias via WebRTC direct
- **États** : RINGING → JOINED → LEFT (flexible comme WhatsApp)
- **UI** : Grille responsive jusqu'à 6 participants
- **Fonctionnalités** : Audio/vidéo, micro/caméra, haut-parleur, détection orateur
- **Transitions** : 1-à-1 ↔ groupe transparentes

Le système est conçu pour être **résilient**, **performant**, et **user-friendly**, en s'inspirant du comportement de WhatsApp.
