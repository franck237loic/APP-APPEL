# Instructions de test - Réunions planifiées

## Prérequis

1. **Firebase Firestore** : Assurez-vous que votre projet Firebase a Firestore activé
2. **Serveur en ligne** : Le serveur doit être déployé (ex: Render) pour que les réunions soient persistées
3. **2 comptes de test** : Pour tester le partage de code entre utilisateurs

## Test 1 : Créer une réunion

1. Lancez l'app et connectez-vous avec le compte A
2. Ajoutez un bouton "Programmer une réunion" dans votre UI (appelez `window.showMeetingCreateView()`)
3. Remplissez le formulaire :
   - Titre : "Test réunion"
   - Date/heure : Sélectionnez une date dans 5 minutes
   - Durée : 30 minutes
   - Type : Vidéo
4. Cliquez sur "Créer la réunion"
5. **Attendu** : L'écran "Réunion créée" s'affiche avec le code (ex: ABC-123-XYZ)
6. Copiez le code avec le bouton "Copier le code"

## Test 2 : Rejoindre trop tôt (compte à rebours)

1. Avec le compte B, appelez `window.showMeetingJoinView('ABC-123-XYZ')` (ou utilisez le deep link)
2. **Attendu** : L'écran "En attente" s'affiche avec un compte à rebours
3. Le compte à rebours décompte les minutes/secondes restantes
4. Quand le compte à rebours atteint 00:00, l'app tente automatiquement de rejoindre

## Test 3 : Rejoindre à l'heure (fenêtre d'accès)

1. Avancez l'heure système ou attendez que l'heure programmée soit atteinte
2. Avec le compte B, appelez `window.showMeetingJoinView('ABC-123-XYZ')`
3. **Attendu** :
   - Le message `meeting-joined` est reçu
   - L'app envoie automatiquement `group-join`
   - L'écran d'appel de groupe s'affiche
   - Le compte A reçoit la notification que B a rejoint

## Test 4 : Test rapide (avancer scheduledAt)

Pour tester sans attendre l'heure réelle :

1. Dans `serveur.js`, lors de la création de réunion, utilisez une `scheduledAt` dans le passé (ex: `Date.now() - 60000` pour 1 minute avant)
2. Créez une réunion
3. Rejoignez immédiatement avec le code
4. **Attendu** : La réunion passe directement en live sans attente

## Test 5 : Annuler une réunion

1. Créez une réunion avec le compte A
2. Appelez `window.cancelMeeting(meetingId)` avec l'ID reçu
3. **Attendu** :
   - Le statut Firestore passe à "cancelled"
   - Le message `meeting-cancelled` est reçu
   - Si quelqu'un tente de rejoindre avec le code, il reçoit une erreur

## Test 6 : Code invalide

1. Appelez `window.showMeetingJoinView('INVALID-CODE')`
2. Cliquez sur "Rejoindre"
3. **Attendu** : Toast d'erreur "Code invalide"

## Test 7 : Deep link Android

1. Déployez l'app sur Android
2. Depuis un navigateur ou une autre app, ouvrez : `callapp://join/ABC-123-XYZ`
3. **Attendu** : L'app s'ouvre et préremplit le code dans l'écran de rejoindre

## Test 8 : Deep link HTTP

1. Depuis un navigateur, ouvrez : `https://app-appel.onrender.com/join/ABC-123-XYZ`
2. **Attendu** : L'écran de rejoindre s'ouvre avec le code prérempli

## Test 9 : Firebase Firestore vérification

1. Allez dans la console Firebase → Firestore
2. Vérifiez la collection `meetings`
3. **Attendu** : Vous voyez le document de réunion avec :
   - `code`: "ABC-123-XYZ"
   - `status`: "scheduled" ou "live"
   - `roomId`: null ou "room_xxx" (après passage en live)

## Test 10 : Transition automatique scheduled→live

1. Créez une réunion pour dans 2 minutes
2. Ne rejoignez pas
3. Attendez que l'heure programmée soit atteinte
4. **Attendu** :
   - Le serveur crée automatiquement la salle live
   - Le champ `roomId` est mis à jour dans Firestore
   - Le statut passe à "live"

## Dépannage

### Erreur "Code invalide"
- Vérifiez que le code est bien au format XXX-XXX-XYZ (9 caractères)
- Vérifiez que Firestore contient bien ce code

### Erreur "Non enregistré"
- Assurez-vous que l'utilisateur a appelé `register-user` sur le WebSocket
- Vérifiez que `myId` est défini dans CallManager

### Erreur "Connexion requise"
- Vérifiez que le WebSocket est connecté
- Appelez `window.connectWebSocket()` si nécessaire

### La réunion ne passe pas en live automatiquement
- Vérifiez les logs serveur pour le timer de transition
- Assurez-vous que le serveur reste en ligne (pas de redémarrage qui perd les timers)

### Le compte à rebours ne rejoint pas automatiquement
- Vérifiez que `meetingPendingCode` est bien stocké
- Vérifiez que la WebSocket est connectée au moment du compte à rebours à 00:00
