# Tableau récapitulatif des messages pour les réunions planifiées (Style Google Meet)

## États d'une réunion

| État | Description |
|------|-------------|
| `scheduled` | Réunion programmée, pas encore commencée |
| `live` | Réunion en cours (salle live ouverte) |
| `ended` | Réunion terminée (tous partis ou time-out) |
| `cancelled` | Réunion annulée par l'hôte |

## Cycle de vie d'une réunion

```
scheduled → live → ended
scheduled → cancelled
```

## Messages clients → serveur

| Type | Description | Champs obligatoires | Champs optionnels |
|------|-------------|---------------------|-------------------|
| `meeting-create` | Créer une nouvelle réunion planifiée | `title`, `scheduledAt`, `durationMin`, `isVideo` | `participants: []` |
| `meeting-join` | Rejoindre une réunion par code | `code` | - |
| `meeting-cancel` | Annuler une réunion (réservé à l'hôte) | `meetingId` | - |
| `meeting-list` | Lister les réunions d'un utilisateur | - | - |

## Messages serveur → clients

| Type | Description | Champs | Destinataires |
|------|-------------|--------|---------------|
| `meeting-created` | Confirmation de création de réunion | `meetingId`, `code`, `link`, `title`, `scheduledAt`, `endsAt`, `isVideo` | Créateur |
| `meeting-joined` | Réunion jointe avec salle live | `meetingId`, `roomId`, `isVideo`, `title` | Participant qui rejoint |
| `meeting-waiting` | Trop tôt pour rejoindre (compte à rebours) | `waitTimeMs`, `waitTimeMin`, `scheduledAt` | Participant qui tente de rejoindre |
| `meeting-ended` | Réunion terminée | `meetingId`, `reason` | Tous participants |
| `meeting-cancelled` | Réunion annulée | `meetingId` | Créateur |
| `meeting-error` | Erreur lors d'une opération de réunion | `reason` | Client concerné |
| `meeting-list` | Liste des réunions de l'utilisateur | `upcoming: []`, `past: []` | Client demandeur |

## Structure Firebase (Collection `meetings`)

```javascript
{
  meetingId: "meeting_1234567890_userId",
  code: "ABC-123-XYZ",          // Code court unique (9 caractères)
  title: "Réunion d'équipe",
  scheduledAt: 1730000000000,   // Timestamp de l'heure programmée
  durationMin: 60,              // Durée en minutes
  endsAt: 1730036000000,        // scheduledAt + durationMin
  isVideo: true,
  createdBy: "userId",           // Hôte de la réunion
  participants: ["userId1", "userId2"],
  status: "scheduled",          // scheduled/live/ended/cancelled
  roomId: null,                 // Rempli quand status=live
  createdAt: 1729999999999,
  link: "https://app-appel.onrender.com/join/ABC-123-XYZ"
}
```

## Règles métier

1. **Fenêtre d'accès** : 15 minutes avant `scheduledAt` jusqu'à `endsAt`
2. **Host** = créateur (seul peut annuler)
3. **Code unique** : 9 caractères alphanumériques majuscules (format XXX-XXX-XXX)
4. **MAX participants** : 6 (comme les groupes actuels)
5. **Transition scheduled→live** : automatique à l'heure programmée ou au premier join dans la fenêtre
6. **Fin de réunion** : quand le dernier participant quitte ou `endsAt` est dépassé

## Comportement Google Meet

1. **Code partageable** : Chaque réunion a un code court unique facile à partager
2. **Lien web** : Lien HTTP pour rejoindre depuis un navigateur
3. **Compte à rebours** : Si trop tôt, afficher le temps restant avant l'ouverture
4. **Auto-join** : Le compte à rebours rejoint automatiquement quand le temps est écoulé
5. **Enchaînement** : Une fois `meeting-joined` reçu, le client enchaîne sur `group-join` pour rejoindre la salle live
6. **Réutilisation** : Le système utilise le `RoomManager` existant pour la salle live (pas de duplication)

## Contraintes de validation

- `meeting-cancel` : réservé à l'hôte (createdBy === userId)
- `meeting-join` : code doit être valide et correspondre à une réunion existante
- `meeting-create` : scheduledAt doit être dans le futur, durationMin entre 15 et 480 minutes
- Fenêtre d'accès : 15 minutes avant scheduledAt (trop tôt = meeting-waiting)
- Expiration : après endsAt (trop tard = meeting-error)

## Intégration avec les appels de groupe

1. **Salle live** : Utilise le `RoomManager` existant
2. **Messages group-*** : Une fois `meeting-joined` reçu avec un `roomId`, le client utilise les messages `group-*` existants
3. **WebRTC** : La logique WebRTC (signaling, peer connections) est exactement la même que pour les groupes instantanés
4. **UI** : L'écran d'appel de groupe existant (interface-4) est réutilisé
