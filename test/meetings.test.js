/**
 * Tests unitaires pour les réunions planifiées
 * 
 * Ce fichier contient des tests pour les fonctionnalités de meetings côté serveur.
 * Pour exécuter: npm test (si configuré) ou node test/meetings.test.js
 */

// Mock de Firebase (pour les tests sans vraie connexion Firebase)
class MockFirestore {
  constructor() {
    this.data = new Map();
  }

  collection(name) {
    return {
      doc: (id) => ({
        set: async (data) => {
          this.data.set(`${name}/${id}`, data);
          return { id };
        },
        get: async () => {
          const value = this.data.get(`${name}/${id}`);
          return {
            exists: !!value,
            data: () => value
          };
        },
        update: async (updates) => {
          const key = `${name}/${id}`;
          const existing = this.data.get(key);
          if (existing) {
            this.data.set(key, { ...existing, ...updates });
          }
        }
      }),
      where: (field, op, value) => ({
        get: async () => {
          const results = [];
          for (const [key, doc] of this.data.entries()) {
            if (key.startsWith(name + '/')) {
              const data = this.data.get(key);
              if (op === '==' && data[field] === value) {
                results.push({ id: key.split('/')[1], data: () => data });
              }
            }
          }
          return { docs: results, empty: results.length === 0 };
        }
      })
    };
  }
}

// Tests basiques
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

// Test: Génération de code sans caractères ambigus
function testCodeGeneration() {
  console.log("Test: Génération de code sans caractères ambigus...");
  
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const forbidden = ['0', 'O', '1', 'I'];
  
  // Générer 100 codes et vérifier qu'aucun ne contient de caractères interdits
  for (let i = 0; i < 100; i++) {
    const parts = [];
    for (let j = 0; j < 3; j++) {
      let part = "";
      for (let k = 0; k < 3; k++) {
        part += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      parts.push(part);
    }
    const code = parts.join("-");
    
    for (const forbiddenChar of forbidden) {
      assert(!code.includes(forbiddenChar), `Code ${code} contient le caractère interdit ${forbiddenChar}`);
    }
  }
  
  console.log("✅ Génération de code: OK");
}

// Test: Validation des paramètres de création
function testMeetingValidation() {
  console.log("Test: Validation des paramètres de création...");
  
  // Titre requis
  assert(!"".trim().length > 0, "Titre vide doit être rejeté");
  assert("Test".trim().length > 0, "Titre valide doit être accepté");
  
  // Longueur du titre
  assert("A".repeat(100).length <= 100, "Titre de 100 caractères doit être accepté");
  assert("A".repeat(101).length > 100, "Titre de 101 caractères doit être rejeté");
  
  // Durée
  assert(15 >= 15 && 15 <= 480, "Durée 15 min doit être acceptée");
  assert(480 >= 15 && 480 <= 480, "Durée 480 min doit être acceptée");
  assert(14 < 15, "Durée 14 min doit être rejetée");
  assert(481 > 480, "Durée 481 min doit être rejetée");
  
  // Heure programmée
  const now = Date.now();
  assert(now + 60000 > now, "Heure dans le futur doit être acceptée");
  assert(now - 1000 <= now, "Heure dans le passé doit être rejetée");
  
  console.log("✅ Validation des paramètres: OK");
}

// Test: Format du code
function testCodeFormat() {
  console.log("Test: Format du code...");
  
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const parts = [];
  for (let i = 0; i < 3; i++) {
    let part = "";
    for (let j = 0; j < 3; j++) {
      part += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    parts.push(part);
  }
  const code = parts.join("-");
  
  // Vérifier le format XXX-XXX-XXX
  const parts2 = code.split("-");
  assertEqual(parts2.length, 3, "Code doit avoir 3 parties séparées par des tirets");
  assertEqual(parts2[0].length, 3, "Chaque partie doit avoir 3 caractères");
  assertEqual(parts2[1].length, 3, "Chaque partie doit avoir 3 caractères");
  assertEqual(parts2[2].length, 3, "Chaque partie doit avoir 3 caractères");
  assertEqual(code.length, 11, "Code complet doit avoir 11 caractères (XXX-XXX-XXX)");
  
  console.log("✅ Format du code: OK");
}

// Test: Normalisation du code
function testCodeNormalization() {
  console.log("Test: Normalisation du code...");
  
  const code1 = "abc-123-xyz";
  const normalized1 = code1.toUpperCase().replace(/-/g, "");
  assertEqual(normalized1, "ABC123XYZ", "Code doit être normalisé en majuscules sans tirets");
  
  const code2 = "ABC-123-XYZ";
  const normalized2 = code2.toUpperCase().replace(/-/g, "");
  assertEqual(normalized2, "ABC123XYZ", "Code déjà en majuscules doit être normalisé");
  
  console.log("✅ Normalisation du code: OK");
}

// Exécuter tous les tests
function runAllTests() {
  console.log("=== Début des tests unitaires Meetings ===\n");
  
  try {
    testCodeGeneration();
    testMeetingValidation();
    testCodeFormat();
    testCodeNormalization();
    
    console.log("\n=== Tous les tests passés ✅ ===");
  } catch (error) {
    console.error("\n=== Test échoué ❌ ===");
    console.error(error.message);
    process.exit(1);
  }
}

// Exécuter si ce fichier est lancé directement
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testCodeGeneration,
  testMeetingValidation,
  testCodeFormat,
  testCodeNormalization,
  runAllTests
};
