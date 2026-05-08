const fs = require('fs');

// --- CHARGEMENT DES DONNÉES ---
const params = JSON.parse(fs.readFileSync('./params_edt.json', 'utf8')); //
const data = JSON.parse(fs.readFileSync('./data_edt.json', 'utf8')); //

// --- CONFIGURATION DU CALENDRIER ---
const AUJOURDHUI = new Date(); // On se base sur la date système (8 mai 2026)
const getLundi = (d) => {
    const date = new Date(d);
    const day = date.getDay(), diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
};

const LUNDI_S0 = getLundi(AUJOURDHUI);

// Fonction pour convertir "Lun 13 Avr 2026" en objet Date
function parserDateED(str) {
    if (!str || typeof str !== 'string') return null;
    const moisMatch = {
        'Jan': 0, 'Fév': 1, 'Mar': 2, 'Avr': 3, 'Mai': 4, 'Juin': 5,
        'Juil': 6, 'Aoû': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Déc': 11
    };
    const parts = str.split(' ');
    if (parts.length < 4) return null;
    return new Date(parseInt(parts[3]), moisMatch[parts[2]], parseInt(parts[1]));
}

// --- ANALYSE DES SEMAINES ---
let semainesATraiter = [];
const debutPlage = params.weeksBefore; // -3 selon
const finPlage = params.weeksAfter;    // 2 selon

for (let i = debutPlage; i <= finPlage; i++) {
    // 1. Appliquer la règle de préservation : -1, 0, 1 sont toujours gardés
    if (i >= -1 && i <= 1) {
        semainesATraiter.push(i);
        continue;
    }

    // 2. Calculer la plage de dates pour la semaine 'i'
    const debutSemaine = new Date(LUNDI_S0);
    debutSemaine.setDate(debutSemaine.getDate() + (i * 7));
    const finSemaine = new Date(debutSemaine);
    finSemaine.setDate(finSemaine.getDate() + 6);

    // 3. Vérifier si des données existent déjà pour cette semaine
    const existeDeja = data.some(cours => {
        const dateCours = parserDateED(cours.jour);
        return dateCours && dateCours >= debutSemaine && dateCours <= finSemaine;
    });

    if (!existeDeja) {
        semainesATraiter.push(i);
    }
}

// --- CALCUL DES CLICS ---
const minSemaine = Math.min(...semainesATraiter);
const maxSemaine = Math.max(...semainesATraiter);

// Nombre de clics à gauche (depuis 0) pour atteindre la semaine la plus ancienne
const clicsGauche = minSemaine < 0 ? Math.abs(minSemaine) : 0;
// Nombre de clics à droite (depuis 0) pour atteindre la semaine la plus lointaine
const clicsDroite = maxSemaine > 0 ? maxSemaine : 0;

// --- RÉSULTATS ---
console.log("-----------------------------------------");
console.log(`📅 Liste des semaines à récupérer : [ ${semainesATraiter.join(', ')} ]`);
console.log(`⬅️ Nombre de clics flèche GAUCHE : ${clicsGauche}`);
console.log(`➡️ Nombre de clics flèche DROITE : ${clicsDroite}`);
console.log("-----------------------------------------");
