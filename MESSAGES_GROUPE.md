# Tableau récapitulatif des messages pour l'appel de groupe (Style WhatsApp)

## États des participants

| État | Description |
|------|-------------|
| `RINGING` | Invitation en cours (sonnerie) |
| `JOINED` | Participant actif dans l'appel |
| `DECLINED` | Invitation refusée |
| `MISSED` | Invitation expirée (non répondue) |
| `LEFT` | Participant a quitté l'appel |

## Cycle de vie d'un participant

```
RINGING → JOINED → LEFT
RINGING → DECLINED
RINGING → MISSED (expiration après 45s)
DECLINED/MISSED/LEFT → JOINED (rejoindre possible)
```

## Messages clients → serveur

| Type | Description | Champs obligatoires | Champs optionnels |
|------|-------------|---------------------|-------------------|
| `group-create` | Créer une nouvelle salle et inviter des participants | `isVideo`, `invitedIds: []` | - |
| `group-add` | Ajouter des participants à une salle existante (réservé aux JOINED) | `roomId`, `invitedIds: []` | - |
| `group-join` | Rejoindre une salle (accepter ou rejoindre après refus) | `roomId` | - |
| `group-decline` | Refuser une invitation | `roomId` | - |
| `group-leave` | Quitter une salle (réservé aux JOINED) | `roomId` | - |
| `group-get-info` | Demander les informations d'une salle (via notification) | `roomId` | - |
| `group-signal` | Envoyer un signal WebRTC à un participant (réservé aux JOINED) | `roomId`, `targetId`, `payload` | - |

## Messages serveur → clients

| Type | Description | Champs | Destinataires |
|------|-------------|--------|---------------|
| `group-created` | Confirmation de création de salle | `roomId`, `roster: [{userId, state}]` | Créateur |
| `group-invite` | Invitation à rejoindre une salle | `roomId`, `from`, `isVideo`, `roster` | Invités connectés |
| `group-info` | Informations sur une salle | `roomId`, `isVideo`, `roster` | Client demandeur |
| `group-ended` | La salle a été fermée | `roomId`, `reason` | Tous participants |
| `group-joined` | Confirmation de rejoindre une salle | `roomId`, `roster` | Participant qui rejoint |
| `group-roster` | Roster mis à jour (diffusé à chaque changement) | `roomId`, `roster` | Tous JOINED |
| `group-signal` | Relai d'un signal WebRTC | `roomId`, `from`, `payload` | Destinataire ciblé |
| `group-error` | Erreur lors d'une opération de groupe | `roomId`, `reason` | Client concerné |
| `group-busy` | Un invité est déjà dans un autre appel | `roomId`, `userId` | Créateur/inviteur |

## Modifications des messages existants (1-à-1)

Les messages suivants ont été modifiés pour inclure le champ `from` :

| Type | Modification | Raison |
|------|--------------|--------|
| `call-answered` | Ajout de `from: ws.userId` | Identifier l'expéditeur de la réponse |
| `ice-candidate` | Ajout de `from: ws.userId` | Identifier l'expéditeur du candidat ICE |
| `restart-offer` | Ajout de `from: ws.userId` | Identifier l'expéditeur de l'offre de restart |

## Notifications Push

| Type de notification | Champs supplémentaires | Description |
|---------------------|----------------------|-------------|
| `group-invite` | `type: "group-invite"`, `roomId`, `from`, `isVideo`, `notId`, `actions` | Invitation pour utilisateur hors-ligne |
| `missed-call` (groupe) | `type: "missed-call"`, `isGroup: "true"` | Appel de groupe manqué (expiration) |

## Comportement WhatsApp

1. **Pas d'hôte** : La salle vit tant qu'au moins 1 participant est JOINED
2. **Invitations simultanées** : Tous les invités sonnent en même temps
3. **Acceptation indépendante** : Chaque invité accepte ou refuse indépendamment
4. **Rejoindre après refus** : Un invité qui a refusé peut rejoindre tant que la salle est active
5. **Ajout pendant l'appel** : N'importe quel participant JOINED peut ajouter d'autres personnes
6. **Expiration** : Chaque invitation expire après 45 secondes (INVITE_TIMEOUT_MS)
7. **Fermeture** : La salle se ferme si countJoined === 0 ET countRinging === 0
8. **Roster** : Tous les clients JOINED reçoivent le roster à jour à chaque changement

## Contraintes de validation

- `group-add` : réservé aux participants JOINED
- `group-leave` : réservé aux participants JOINED
- `group-signal` : uniquement entre deux participants JOINED de la même salle
- Un utilisateur ne peut être que dans une seule salle à la fois
- Une salle ne peut contenir plus de 6 participants (JOINED + RINGING comptés ensemble)
- Pas de fuite mémoire : tous les timers sont annulés à la fermeture de la salle

