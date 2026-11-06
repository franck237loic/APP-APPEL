# PLAN TECHNIQUE - AMÉLIORATION DU MODULE MEETING
## PHASE 2 - PLAN D'AMÉLIORATION PRIORISÉ

**Date:** 2026-11-05
**Basé sur:** AUDIT_COMPLET_MODULE_MEETING.md
**Objectif:** Rendre le module Meeting professionnel, fiable et sécurisé

---

## RÉSUMÉ DES PRIORITÉS

| Priorité | Nombre d'items | Estimation totale |
|----------|---------------|-------------------|
| 🔴 Critique | 8 | ~3-4 jours |
| 🟡 Important | 12 | ~5-7 jours |
| 🟢 Amélioration | 10 | ~4-5 jours |
| ⚪ Optionnel | 8 | ~3-4 jours |
| **TOTAL** | **38** | **~15-20 jours** |

---

## 🔴 PRIORITÉ CRITIQUE

### C1. Correction handler duplicé `handleMeetingHostStarted`
**Description:** Supprimer la duplication de la fonction définie deux fois dans Meetings.js
**Fichier concerné:** `www/js/Meetings.js` (lignes 96-107 et 116-127)
**Risque:** Si non corrigé, comportement imprévisible des notifications de démarrage
**Effort:** 5 minutes
**Dépendances:** Aucune
**Action:**
- Supprimer la seconde définition (lignes 116-127)
- Conserver la première (lignes 96-107)
- Tester que les notifications fonctionnent correctement

---

### C2. Correction sync `waitingUsers` incomplète
**Description:** S'assurer que les participants en attente reçoivent la notification même s'ils ne sont pas connectés au moment de la notification
**Fichiers concernés:**
- `www/js/serveur.js` (méthode `_notifyWaitingUsersStarted`)
- `www/js/Meetings.js` (handler `meeting-host-started`)
**Risque:** Participants bloqués en salle d'attente sans notification
**Effort:** 2-3 heures
**Dépendances:** Aucune
**Action:**
- Ajouter un mécanisme de retry pour les participants déconnectés
- Stocker l'état "notifié" dans Firestore
- Lors de la reconnexion d'un participant, vérifier s'il a une notification en attente
- Tester le scénario: participant se déconnecte puis se reconnecte

---

### C3. Amélioration recréation salle après crash serveur
**Description:** Lors du redémarrage du serveur, recréer les salles live ET tenter de reconnecter les participants
**Fichiers concernés:**
- `www/js/serveur.js` (méthode `loadMeetingsOnStartup`)
- `www/js/Meetings.js` (handler `meeting-joined`)
**Risque:** Réunion live mais salle vide en RAM après crash
**Effort:** 4-5 heures
**Dépendances:** Aucune
**Action:**
- Dans `loadMeetingsOnStartup`, après recréation de la salle:
  - Envoyer un message "meeting-reconnect" à tous les participants de la réunion
  - Les clients reçoivent le message et tentent de rejoindre automatiquement
- Ajouter un handler côté client pour `meeting-reconnect`
- Tester: crash serveur pendant réunion, redémarrage, vérification reconnexion

---

### C4. Amélioration gestion erreurs WebSocket
**Description:** Implémenter une reconnexion automatique robuste avec backoff exponentiel
**Fichiers concernés:**
- `www/js/CallManager.js` (méthode `connectWebSocket`)
- `www/js/Meetings.js` (tous les handlers)
**Risque:** Déconnexion silencieuse, utilisateur ne sait pas que la connexion est perdue
**Effort:** 3-4 heures
**Dépendances:** Aucune
**Action:**
- Implémenter reconnexion automatique avec délai exponentiel (1s, 2s, 4s, 8s, max 30s)
- Afficher indicateur visuel "Reconnexion en cours..."
- Après reconnexion réussie, ré-envoyer l'état actuel (meeting status, roster)
- Tester: déconnexion réseau pendant réunion, vérification reconnexion

---

### C5. Amélioration gestion erreurs WebRTC
**Description:** Détecter et gérer les erreurs WebRTC (ICE failed, connection failed)
**Fichiers concernés:**
- `www/js/CallManager.js` (méthodes WebRTC)
- `www/js/Meetings.js` (interface meeting)
**Risque:** Vidéo figée, audio coupé sans feedback utilisateur
**Effort:** 4-5 heures
**Dépendances:** C4 (reconnexion WebSocket)
**Action:**
- Ajouter listeners sur `iceconnectionstatechange`
- Si état = "failed" ou "disconnected":
  - Afficher message d'erreur
  - Tenter de renégocier la connexion
  - Si échec, proposer de quitter ou réessayer
- Tester: simulation erreur réseau pendant appel

---

### C6. Ajout rate limiting sur tentatives de join
**Description:** Limiter le nombre de tentatives de join par IP/ID pour éviter les attaques
**Fichiers concernés:**
- `www/js/serveur.js` (handler `meeting-join`)
**Risque:** Attaques par force brute sur les codes de réunion
**Effort:** 2-3 heures
**Dépendances:** Aucune
**Action:**
- Implémenter un rate limiter (ex: 10 tentatives par minute par IP)
- Stocker les tentatives en RAM avec expiration
- Retourner erreur "Trop de tentatives, réessayez plus tard"
- Tester: tentatives multiples de join avec code invalide

---

### C7. Validation stricte des messages WebSocket
**Description:** Valider tous les champs des messages WebSocket côté serveur
**Fichiers concernés:**
- `www/js/serveur.js` (tous les handlers WebSocket)
**Risque:** Injection de données malveillantes, crash serveur
**Effort:** 3-4 heures
**Dépendances:** Aucune
**Action:**
- Créer une fonction de validation commune
- Valider types, longueurs, formats
- Sanitiser les entrées (titre, description)
- Tester: envoi de messages malformés

---

### C8. Amélioration authentification utilisateur
**Description:** Ajouter un système de token JWT pour valider l'identité des utilisateurs
**Fichiers concernés:**
- `www/js/serveur.js` (handlers WebSocket)
- `www/js/CallManager.js` (connexion)
**Risque:** Usurpation d'identité possible
**Effort:** 1-2 jours
**Dépendances:** Étude faisabilité impact sur appels classiques
**Action:**
- **ATTENTION:** Peut impacter les appels classiques - présenter à l'utilisateur d'abord
- Générer un JWT token lors de l'inscription/connexion
- Inclure le token dans tous les messages WebSocket
- Valider le token côté serveur
- Si modification requise sur CallManager, STOP et demander validation

---

## 🟡 PRIORITÉ IMPORTANTE

### I1. Implémentation salle d'attente avec approbation
**Description:** Ajouter un système d'approbation/refus pour les participants qui rejoignent
**Fichiers concernés:**
- `www/js/serveur.js` (MeetingManager, handlers)
- `www/js/Meetings.js` (UI salle d'attente)
- `www/js/MeetingParticipants.js` (UI approbation)
- `www/css/meeting.css` (styles)
**Risque:** Impact sur flow actuel des réunions
**Effort:** 2-3 jours
**Dépendances:** Aucune
**Action:**
- Ajouter état "pending" aux participants
- Ajouter champ `accessPolicy` aux réunions (direct/approval)
- Créer UI pour l'hôte: liste des demandes en attente avec boutons Accepter/Refuser
- Ajouter handlers WebSocket: `meeting-approve`, `meeting-reject`
- Envoyer notification au participant quand accepté/refusé
- Si refusé, afficher message explicatif
- Tester: flux complet d'approbation

---

### I2. Synchronisation temps réel des participants
**Description:** Synchroniser l'état des participants (mute, caméra, hand raised) en temps réel
**Fichiers concernés:**
- `www/js/serveur.js` (handlers)
- `www/js/Meetings.js` (handlers)
- `www/js/MeetingParticipants.js` (UI)
**Risque:** Impact sur performance si trop de messages
**Effort:** 1-2 jours
**Dépendances:** I1 (salle d'attente)
**Action:**
- Ajouter champs aux participants: `isMuted`, `isVideoOff`, `handRaised`
- Diffuser les changements via WebSocket (`participant-state-changed`)
- Mettre à jour l'UI en temps réel
- Ajouter indicateur visuel pour "hand raised"
- Tester: sync mute/caméra entre participants

---

### I3. Implémentation chat temps réel via WebSocket
**Description:** Remplacer l'API REST par WebSocket pour le chat de réunion
**Fichiers concernés:**
- `www/js/serveur.js` (handlers WebSocket)
- `www/js/MeetingChat.js` (UI)
- `www/js/Meetings.js` (handlers)
**Risque:** Architecture différente, possible régression
**Effort:** 1-2 jours
**Dépendances:** Aucune
**Action:**
- Ajouter handlers WebSocket: `meeting-chat-send`, `meeting-chat-message`
- Stocker les messages dans Firestore (pour historique)
- Diffuser les messages en temps réel via WebSocket
- Supprimer l'API REST chat (ou garder pour historique)
- Ajouter notification visuelle pour nouveaux messages
- Tester: chat temps réel entre plusieurs participants

---

### I4. Amélioration gestion permissions serveur
**Description:** Implémenter la vérification des permissions côté serveur pour toutes les actions
**Fichiers concernés:**
- `www/js/serveur.js` (MeetingManager, API REST)
- `www/js/MeetingService.js` (frontend)
**Risque:** Impact sur flow actuel
**Effort:** 2-3 jours
**Dépendances:** I1 (salle d'attente), I2 (sync participants)
**Action:**
- Définir les permissions: host, co-host, participant
- Ajouter vérification avant chaque action sensible:
  - Retirer participant (host uniquement)
  - Mute/unmute autre (host/co-host uniquement)
  - Approuver/refuser (host uniquement)
- Renvoyer erreur 403 si non autorisé
- Mettre à jour l'UI pour masquer les boutons selon le rôle
- Tester: tentative d'action non autorisée

---

### I5. Amélioration UI participants
**Description:** Améliorer l'interface des participants avec plus d'informations et d'actions
**Fichiers concernés:**
- `www/js/MeetingParticipants.js` (UI)
- `www/css/meeting.css` (styles)
**Risque:** UI plus complexe
**Effort:** 1 jour
**Dépendances:** I2 (sync participants), I4 (permissions)
**Action:**
- Afficher l'état: microphone (on/off), caméra (on/off), hand raised
- Afficher la photo de profil au lieu de l'avatar générique
- Ajouter actions: mute, retirer, promouvoir co-host
- Ajouter recherche dans la liste
- Ajouter filtre (tous / mains levées)
- Tester: UI avec plusieurs participants

---

### I6. Implémentation distinction Quitter vs Terminer
**Description:** Ajouter deux actions distinctes: "Quitter la réunion" et "Terminer pour tous"
**Fichiers concernés:**
- `www/js/Meetings.js` (UI meeting)
- `www/js/serveur.js` (handlers)
**Risque:** Impact sur comportement actuel
**Effort:** 4-5 heures
**Dépendances:** Aucune
**Action:**
- Remplacer le bouton "Quitter" par deux boutons:
  - "Quitter" (pour soi-même)
  - "Terminer" (pour tous, visible uniquement pour l'hôte)
- Ajouter confirmation avant "Terminer pour tous"
- Si terminer pour tous:
  - Envoyer message `meeting-end-for-all`
  - Fermer la salle live
  - Marquer la réunion comme "ended"
  - Notifier tous les participants
- Définir la politique si l'hôte quitte sans terminer:
  - Option 1: Transférer le rôle d'hôte au participant le plus ancien
  - Option 2: Continuer sans hôte (comportement actuel)
- Tester: les deux scénarios

---

### I7. Amélioration prévisualisation médias
**Description:** Améliorer l'écran de prévisualisation avec test des périphériques
**Fichiers concernés:**
- `www/js/Meetings.js` (UI preview)
- `www/js/MeetingMediaAdapter.js` (logique)
- `www/css/meeting.css` (styles)
**Risque:** Plus complexe, possibles problèmes de compatibilité
**Effort:** 1 jour
**Dépendances:** Aucune
**Action:**
- Ajouter indicateur de niveau audio (barre visualisant le volume)
- Tester les permissions caméra/micro avant d'entrer
- Si permission refusée:
  - Expliquer clairement la situation
  - Permettre de rejoindre en audio-only si caméra refusée
  - Permettre de rejoindre en lecture seule si micro refusé
- Ajouter bouton "Tester la connexion"
- Afficher la qualité réseau estimée
- Tester: refus permissions caméra/micro

---

### I8. Amélioration grille vidéo adaptative
**Description:** Rendre la grille vidéo vraiment adaptative selon le nombre de participants
**Fichiers concernés:**
- `www/js/Meetings.js` (UI meeting)
- `www/css/meeting.css` (styles)
**Risque:** Complexité CSS, possibles bugs de layout
**Effort:** 1 jour
**Dépendances:** Aucune
**Action:**
- Implémenter différents layouts selon le nombre:
  - 1-2 participants: vue principale + mini vue
  - 3-4 participants: grille 2x2
  - 5-9 participants: grille 3x3
  - 10+ participants: grille avec scroll
- Ajouter mode "Speaker view" (mise en avant du participant qui parle)
- Ajouter mode "Gallery view" (grille égale)
- Bouton pour switcher entre modes
- Tester: avec différents nombres de participants

---

### I9. Implémentation réactions (emoji)
**Description:** Implémenter le système de réactions avec emoji flottants
**Fichiers concernés:**
- `www/js/Meetings.js` (UI)
- `www/js/serveur.js` (handlers)
- `www/css/meeting.css` (animations)
**Risque:** Impact performance si trop d'animations
**Effort:** 1 jour
**Dépendances:** Aucune
**Action:**
- Créer un panel de réactions (👍, 👏, ❤️, 😂, 😮, 😢)
- Handler WebSocket: `meeting-reaction`
- Diffuser la réaction à tous les participants
- Afficher l'emoji flottant sur la vidéo du participant
- Animation CSS (float up + fade out)
- Rate limit: max 1 réaction par seconde par participant
- Tester: réactions entre participants

---

### I10. Amélioration timer synchronisé
**Description:** Synchroniser le timer de réunion avec le serveur
**Fichiers concernés:**
- `www/js/Meetings.js` (timer)
- `www/js/serveur.js` (envoi timestamp serveur)
**Risque:** Faible
**Effort:** 2-3 heures
**Dépendances:** Aucune
**Action:**
- Envoyer le timestamp serveur dans `meeting-joined`
- Calculer le décalage d'horloge côté client
- Utiliser ce décalage pour le timer
- Afficher le timer basé sur l'heure serveur
- Tester: décalage horaire entre client et serveur

---

### I11. Amélioration historique des réunions
**Description:** Ajouter plus d'informations dans l'historique
**Fichiers concernés:**
- `www/js/serveur.js` (MeetingManager)
- `www/js/Meetings.js` (UI liste)
**Risque:** Impact sur performances Firestore
**Effort:** 1 jour
**Dépendances:** Aucune
**Action:**
- Enregistrer la durée réelle de la réunion
- Enregistrer le nombre de participants max
- Enregistrer la date de fin réelle
- Afficher ces informations dans l'historique
- Ajouter filtre: toutes / créées / participées
- Tester: création/join/fin de réunion, vérification historique

---

### I12. Ajout notifications dans l'app
**Description:** Ajouter des notifications visuelles dans l'app pour les événements temps réel
**Fichiers concernés:**
- `www/js/Meetings.js` (handlers)
- `www/css/meeting.css` (styles)
**Risque:** Trop de notifications peuvent être intrusives
**Effort:** 1 jour
**Dépendances:** I2 (sync participants), I3 (chat temps réel)
**Action:**
- Notification quand un participant rejoint
- Notification quand un participant quitte
- Notification pour nouveaux messages chat
- Notification pour levée de main
- Notification pour réactions
- Notifications discrètes (toast en bas de l'écran)
- Tester: flux de notifications pendant réunion

---

## 🟢 PRIORITÉ AMÉLIORATION

### A1. Implémentation partage d'écran
**Description:** Intégrer le plugin Cordova de partage d'écran
**Fichiers concernés:**
- `local_plugins/cordova-plugin-screenshare-live/` (plugin)
- `www/js/Meetings.js` (UI)
- `www/js/serveur.js` (signalisation)
**Risque:** Compatibilité limitée selon plateforme
**Effort:** 2-3 jours
**Dépendances:** Aucune
**Action:**
- Étudier la documentation du plugin
- Ajouter bouton "Partager l'écran" dans l'UI
- Ajouter handler WebSocket pour le stream de partage d'écran
- Envoyer le stream via WebRTC (nouveau track)
- Afficher l'écran partagé aux autres participants
- Gérer les permissions système
- Tester sur Android et iOS

---

### A2. Refactorisation Meetings.js
**Description:** Découper Meetings.js en modules plus petits
**Fichiers concernés:**
- `www/js/Meetings.js` (découpage)
- Nouveaux fichiers: `MeetingUI.js`, `MeetingHandlers.js`, `MeetingState.js`
**Risque:** Impact sur CallManager si extension mal gérée
**Effort:** 2-3 jours
**Dépendances:** Aucune
**Action:**
- Créer `MeetingUI.js`: méthodes d'affichage (showMeetingScreen, showMeetingCreateView, etc.)
- Créer `MeetingHandlers.js`: handlers WebSocket (handleMeetingCreated, etc.)
- Créer `MeetingState.js`: gestion de l'état local
- Mettre à jour Meetings.js pour importer et étendre ces modules
- Tests: vérifier que tout fonctionne après refactor

---

### A3. Amélioration gestion des périphériques
**Description:** Permettre le changement de périphérique pendant la réunion
**Fichiers concernés:**
- `www/js/MeetingMediaAdapter.js` (logique)
- `www/js/Meetings.js` (UI)
**Risque:** WebRTC peut ne pas supporter le changement de périphérique dynamique
**Effort:** 1 jour
**Dépendances:** Aucune
**Action:**
- Ajouter un menu "Paramètres" dans l'UI de réunion
- Permettre de changer de caméra/micro/haut-parleur
- Implémenter le changement de track sans couper la connexion
- Tester: changement de caméra pendant réunion

---

### A4. Ajout état de connexion visuel
**Description:** Afficher l'état de connexion (connected, reconnecting, poor connection)
**Fichiers concernés:**
- `www/js/Meetings.js` (UI)
- `www/css/meeting.css` (styles)
**Risque:** Faible
**Effort:** 4-5 heures
**Dépendances:** C4 (reconnexion WebSocket)
**Action:**
- Détecter la qualité de connexion (latence, packet loss)
- Afficher un indicateur dans le header:
  - 🟢 Bonne connexion
  - 🟡 Connexion instable
  - 🔴 Mauvaise connexion
- Afficher "Reconnexion..." lors de la reconnexion
- Tester: simulation mauvaise connexion

---

### A5. Amélioration recherche de code
**Description:** Améliorer la recherche de code dans Firestore avec index
**Fichiers concernés:**
- `www/js/serveur.js` (MeetingManager.getByCode)
- `FIRESTORE_INDEXES.md` (documentation)
**Risque:** Faible
**Effort:** 2-3 heures
**Dépendances:** Aucune
**Action:**
- Créer un index Firestore sur le champ `code`
- Mettre à jour `FIRESTORE_INDEXES.md`
- Tester: recherche de code avec beaucoup de réunions

---

### A6. Amélioration layout mobile
**Description:** Optimiser l'interface pour les petits écrans
**Fichiers concernés:**
- `www/css/meeting.css` (media queries)
**Risque:** Faible
**Effort:** 1 jour
**Dépendances:** A8 (grille adaptative)
**Action:**
- Améliorer les media queries existantes
- Optimiser la taille des boutons sur mobile
- Optimiser la grille vidéo sur petit écran
- Tester sur différents appareils (iPhone SE, Android petit)

---

### A7. Ajout mode sombre/clair
**Description:** Permettre de switcher entre mode sombre et clair
**Fichiers concernés:**
- `www/css/meeting.css` (variables CSS)
- `www/js/Meetings.js` (UI)
**Risque:** Faible
**Effort:** 1 jour
**Dépendances:** Aucune
**Action:**
- Définir des variables CSS pour les couleurs
- Créer deux thèmes: dark (actuel) et light
- Ajouter bouton pour switcher
- Persister le choix dans localStorage
- Tester: les deux thèmes

---

### A8. Amélioration accessibilité
**Description:** Améliorer l'accessibilité (ARIA labels, navigation clavier)
**Fichiers concernés:**
- `www/js/Meetings.js` (HTML)
- `www/css/meeting.css` (focus styles)
**Risque:** Faible
**Effort:** 1 jour
**Dépendances:** Aucune
**Action:**
- Ajouter ARIA labels sur tous les boutons
- Permettre la navigation au clavier
- Ajouter focus states visibles
- Tester avec lecteur d'écran

---

### A9. Ajout logs structurés
**Description:** Améliorer les logs pour faciliter le debugging
**Fichiers concernés:**
- `www/js/Meetings.js` (logs)
- `www/js/serveur.js` (logs)
**Risque:** Faible
**Effort:** 4-5 heures
**Dépendances:** Aucune
**Action:**
- Utiliser un système de logging structuré (ex: `[MEETING] [INFO] message`)
- Niveau de log: DEBUG, INFO, WARN, ERROR
- Ne pas logger d'informations sensibles
- Ajouter des logs pour les événements clés
- Tester: vérification des logs en production

---

### A10. Amélioration performance CSS
**Description:** Optimiser les animations et transitions CSS
**Fichiers concernés:**
- `www/css/meeting.css` (optimisations)
**Risque:** Faible
**Effort:** 4-5 heures
**Dépendances:** Aucune
**Action:**
- Utiliser `transform` et `opacity` pour les animations (GPU accelerated)
- Éviter `left`, `top`, `width`, `height` dans les animations
- Utiliser `will-change` pour les éléments animés
- Réduire le nombre de repaints/reflows
- Tester: performance sur appareils mobiles

---

## ⚪ PRIORITÉ OPTIONNELLE

### O1. Migration vers SFU (Selective Forwarding Unit)
**Description:** Remplacer l'architecture Mesh par SFU pour supporter plus de participants
**Fichiers concernés:**
- `www/js/serveur.js` (architecture complète)
- `www/js/CallManager.js` (WebRTC)
**Risque:** Très élevé - refonte complète de l'architecture
**Effort:** 2-3 semaines
**Dépendances:** Aucune
**Action:**
- Étudier les solutions SFU open source (Jitsi, Mediasoup, LiveKit)
- Choisir une solution adaptée
- Implémenter le serveur SFU
- Modifier le client pour utiliser le SFU
- Tests complets
- **ATTENTION:** Impact majeur sur les appels classiques - STOP et demander validation

---

### O2. Implémentation sous-titres (live captions)
**Description:** Ajouter des sous-titres automatiques pendant la réunion
**Fichiers concernés:**
- `www/js/Meetings.js` (UI)
- `www/js/serveur.js` (intégration API speech-to-text)
**Risque:** Coût mensuel (API speech-to-text payante)
**Effort:** 1-2 semaines
**Dépendances:** Aucune
**Action:**
- Étudier les APIs speech-to-text (Google Cloud Speech, AWS Transcribe)
- Intégrer l'API côté serveur
- Diffuser les sous-titres via WebSocket
- Afficher les sous-titres sur la vidéo
- Tester: sous-titres en temps réel

---

### O3. Implémentation enregistrement
**Description:** Permettre d'enregistrer la réunion
**Fichiers concernés:**
- `www/js/serveur.js` (enregistrement)
- `www/js/Meetings.js` (UI)
**Risque:** Coût stockage, législation RGPD
**Effort:** 1-2 semaines
**Dépendances:** Aucune
**Action:**
- Étudier les solutions d'enregistrement (Mediasoup recorder,)
- Implémenter l'enregistrement côté serveur
- Stocker les fichiers (S3, Google Cloud Storage)
- Ajouter bouton "Enregistrer" dans l'UI
- Gérer les permissions (enregistrement visible pour tous)
- Tester: enregistrement et lecture

---

### O4. Implémentation breakout rooms
**Description:** Permettre de diviser la réunion en sous-groupes
**Fichiers concernés:**
- `www/js/serveur.js` (architecture)
- `www/js/Meetings.js` (UI)
**Risque:** Complexité élevée
**Effort:** 2-3 semaines
**Dépendances:** O1 (SFU recommandé)
**Action:**
- Créer des sous-salles pour les breakout rooms
- Permettre à l'hôte d'assigner les participants
- Permettre aux participants de rejoindre différentes salles
- Ajouter timer pour les breakout rooms
- Tester: flux complet de breakout rooms

---

### O5. Implémentation polls/Q&A
**Description:** Ajouter des sondages et questions/réponses
**Fichiers concernés:**
- `www/js/serveur.js` (handlers)
- `www/js/Meetings.js` (UI)
**Risque:** Faible
**Effort:** 1 semaine
**Dépendances:** I3 (chat temps réel)
**Action:**
- Créer une UI pour créer des polls
- Diffuser les polls via WebSocket
- Permettre aux participants de répondre
- Afficher les résultats en temps réel
- Ajouter mode Q&A (questions modérées)
- Tester: polls et Q&A

---

### O6. Implémentation whiteboard
**Description:** Ajouter un tableau blanc collaboratif
**Fichiers concernés:**
- `www/js/Meetings.js` (UI)
- `www/js/serveur.js` (synchronisation)
**Risque:** Complexité moyenne
**Effort:** 1-2 semaines
**Dépendances:** Aucune
**Action:**
- Intégrer une librairie de whiteboard (ex: Fabric.js)
- Synchroniser les dessins via WebSocket
- Permettre à plusieurs participants de dessiner
- Ajouter outils: crayon, gomme, formes, texte
- Tester: whiteboard collaboratif

---

### O7. Implémentation background blur/replace
**Description:** Permettre de flouter ou remplacer l'arrière-plan
**Fichiers concernés:**
- `www/js/Meetings.js` (UI)
- Intégration librairie ML (TensorFlow.js, MediaPipe)
**Risque:** Performance sur mobile
**Effort:** 1-2 semaines
**Dépendances:** Aucune
**Action:**
- Intégrer une librairie de background segmentation
- Appliquer le flou/remplacement sur le stream vidéo
- Permettre de choisir une image d'arrière-plan
- Optimiser pour mobile
- Tester: performance sur différents appareils

---

### O8. Implémentation Picture-in-Picture
**Description:** Permettre de mettre la réunion en Picture-in-Picture
**Fichiers concernés:**
- `www/js/Meetings.js` (UI)
**Risque:** Support limité selon navigateur
**Effort:** 2-3 jours
**Dépendances:** Aucune
**Action:**
- Utiliser l'API Picture-in-Picture du navigateur
- Ajouter bouton "PiP" dans l'UI
- Gérer les événements PiP
- Tester: sur différents navigateurs

---

## SYNTHÈSE DES IMPACTS SUR LES APPELS CLASSIQUES

### Modifications SANS impact sur les appels classiques ✅
- Toutes les modifications dans `MeetingService.js`
- Toutes les modifications dans `MeetingParticipants.js`
- Toutes les modifications dans `MeetingChat.js`
- Toutes les modifications dans `MeetingMediaAdapter.js`
- Toutes les modifications dans `Meetings.js` (extension de CallManager)
- Toutes les modifications dans `meeting.css`
- Toutes les modifications dans `serveur.js` (MeetingManager uniquement)
- C1, C2, C3, C4, C5, C6, C7
- I1, I2, I3, I4, I5, I6, I7, I8, I9, I10, I11, I12
- A1, A2, A3, A4, A5, A6, A7, A8, A9, A10
- O2, O3, O4, O5, O6, O7, O8

### modifications AVEC impact potentiel sur les appels classiques ⚠️
- **C8 (Authentification JWT):** Impact sur CallManager.connectWebSocket()
- **O1 (Migration SFU):** Impact sur toute l'architecture WebRTC

**Recommandation:** Pour C8 et O1, STOP et présenter le problème à l'utilisateur avant toute modification.

---

## RECOMMANDATION D'IMPLÉMENTATION

### Sprint 1 (3-4 jours) - Stabilité
- C1, C2, C3, C4, C5, C6, C7
- Objectif: Corriger les bugs critiques et améliorer la fiabilité

### Sprint 2 (5-7 jours) - Fonctionnalités principales
- I1, I2, I3, I4, I5, I6
- Objectif: Implémenter les fonctionnalités manquantes importantes

### Sprint 3 (4-5 jours) - UX et améliorations
- I7, I8, I9, I10, I11, I12
- A1, A4, A5
- Objectif: Améliorer l'expérience utilisateur

### Sprint 4 (3-4 jours) - Qualité
- A2, A3, A6, A7, A8, A9, A10
- Objectif: Refactorisation et qualité de code

### Sprint 5+ (optionnel) - Fonctionnalités avancées
- O2, O3, O5, O6, O7, O8
- Objectif: Ajouter des fonctionnalités avancées (nice-to-have)

### Sprint spécial (si requis) - Architecture
- O1 (SFU migration)
- C8 (Authentification JWT)
- Objectif: Changements d'architecture majeurs (validation requise)

---

## CONCLUSION

Ce plan technique propose 38 améliorations réparties en 4 catégories de priorité. Les modifications critiques et importantes peuvent être réalisées sans impacter les appels classiques. Deux items (C8 et O1) nécessitent une validation avant implémentation car ils ont un impact potentiel sur l'architecture existante.

**Estimation totale:** 15-20 jours de développement pour les priorités critique, importante et amélioration.

**Prochaine étape:** Présenter ce plan à l'utilisateur pour validation avant de passer à la PHASE 3 (Implémentation).

---

**Fin du plan technique - PHASE 2**
