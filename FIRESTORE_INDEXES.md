# Indexes Firestore pour les réunions

Pour optimiser les performances du système de meetings, les indexes Firestore suivants sont nécessaires.

## Index sur le champ `code`

Cet index permet de rechercher une réunion par code sans charger tous les documents.

```json
{
  "indexes": [
    {
      "collectionGroup": "meetings",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "code",
          "order": "ASCENDING"
        }
      ]
    }
  ]
}
```

**Comment créer cet index:**

1. Allez dans la console Firebase → Firestore → Indexes
2. Cliquez sur "Add index"
3. Collection: `meetings`
4. Fields: `code` (Ascending)
5. Ou utilisez la CLI Firebase:
```bash
firebase firestore:indexes create firestore.indexes.json
```

## Index composite pour `listForUser`

Pour la requête `listForUser` qui combine `createdBy` et `status`:

```json
{
  "indexes": [
    {
      "collectionGroup": "meetings",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "createdBy",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "scheduledAt",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "meetings",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "participants",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "scheduledAt",
          "order": "DESCENDING"
        }
      ]
    }
  ]
}
```

**Note:** Sans ces indexes, le code a un fallback qui utilise `get()` complet, mais cela sera plus lent avec beaucoup de réunions.
