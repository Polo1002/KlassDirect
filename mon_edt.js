const puppeteer = require('puppeteer');
const fs = require('fs');

// Début du chronomètre
const startTime = Date.now();

let IDENTIFIANT, MOT_DE_PASSE, RÉPONSES_SÉCURITÉ;

if (fs.existsSync('./config.js')) {
    const config = require('./config.js');
    IDENTIFIANT = config.IDENTIFIANT;
    MOT_DE_PASSE = config.MOT_DE_PASSE;
    RÉPONSES_SÉCURITÉ = config.RÉPONSES_SÉCURITÉ;
} else {
    IDENTIFIANT = process.env.ED_IDENTIFIANT;
    MOT_DE_PASSE = process.env.MOT_DE_PASSE; 
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? 
        process.env.ED_REPONSES.split(',').map(s => s.replace(/["']/g, "").trim()) : [];
}

// --- LECTURE DES PARAMÈTRES EDT ---
let weeksBefore = 0;
let weeksAfter = 0;

if (fs.existsSync('./params_edt.json')) {
    try {
        const params = JSON.parse(fs.readFileSync('./params_edt.json', 'utf8'));
        // On s'assure que weeksBefore est bien négatif ou nul
        weeksBefore = params.weeksBefore !== undefined ? (params.weeksBefore > 0 ? -params.weeksBefore : params.weeksBefore) : 0;
        // On s'assure que weeksAfter est bien positif ou nul
        weeksAfter = params.weeksAfter !== undefined ? (params.weeksAfter < 0 ? -params.weeksAfter : params.weeksAfter) : 0;
    } catch (err) {
        console.error("⚠️ Erreur lors de la lecture de params_edt.json, utilisation des valeurs par défaut (0, 0).", err);
    }
}

const DIR = './logs';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;
const pause = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * 1000));

async function autoLog(page, message) {
    console.log(`[ÉTAPE ${step}] 📸 ${message.toUpperCase()}`);
    step++;
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new",
    slowMo: 50, 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  }); 

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1400, height: 900 });

  try {
    console.log("🌐 DÉMARRAGE...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    
    await pause(2000);
    await page.type('#username', IDENTIFIANT, { delay: 150 });
    await pause(1000);
    await page.type('#password', MOT_DE_PASSE, { delay: 150 });
    
    await autoLog(page, "Saisie_Identifiants");
    await page.click('#connexion');
    await pause(5000);

    // --- BOUCLE DE SÉCURITÉ ---
    let loop = 0;
    while (loop < 5) {
        const check = await page.evaluate(() => {
            const modals = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content'));
            return { isVisible: modals.length > 0, count: modals.length };
        });
        if (!check.isVisible) break;
        loop++;
        console.log(`🛡️ Sécurité détectée (Niveau ${check.count})...`);
        await pause(3000);
        await page.evaluate((reps) => {
            const currentModal = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content')).pop();
            const labels = Array.from(currentModal.querySelectorAll('label'));
            for (let r of reps) {
                const target = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                if (target) { target.click(); return true; }
            }
            return false;
        }, RÉPONSES_SÉCURITÉ);
        await pause(1500);
        const buttonHandle = await page.evaluateHandle(() => {
            const modals = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content'));
            return modals.pop()?.querySelector('button[type="submit"]');
        });
        if (buttonHandle) { await buttonHandle.click(); console.log("📤 Validation envoyée."); }
        await pause(6000);
    }

    console.log("🚀 Navigation vers l'EDT...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { waitUntil: 'networkidle0' });
    
    // On attend que les événements de l'EDT apparaissent (max 15 secondes)
    await page.waitForSelector('.dhx_cal_event', { timeout: 15000 }).catch(() => console.log("⏳ Temps écoulé, la page est peut-être vide ou lente."));
    await autoLog(page, "Extraction_Donnees");

    const extraireLesCours = async () => {
        return await page.evaluate(() => {
            const elements = document.querySelectorAll('.dhx_cal_event');
            const data = [];

            elements.forEach(el => {
                // --- EXTRACTION ET CONVERSION DU JOUR ---
                // --- EXTRACTION ET CONVERSION DU JOUR AVEC ANNÉE ---
                const timestamp = el.getAttribute('data-bar-start');
                let jourExtrait = "";
                let anneeExtraite = "";
                
                if (timestamp) {
                    const d = new Date(parseInt(timestamp));
                    const jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
                  const mois = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
                    
                    anneeExtraite = d.getFullYear().toString(); // Récupère l'année (ex: 2026)
    
                    // On construit la chaîne du jour incluant l'année pour chaque matière
                    jourExtrait = `${jours[d.getDay()]} ${d.getDate()} ${mois[d.getMonth()]} ${anneeExtraite}`;
                }
                // --- EXTRACTION DES HORAIRES ET DE LA SALLE ---
                const header = el.querySelector('.edt-cours-header');
                let debut = "", fin = "", salle = "";
                
                if (header) {
                    const fullHeaderText = header.innerText.trim();
                    const horaireMatch = fullHeaderText.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
                    if (horaireMatch) {
                        debut = horaireMatch[1];
                        fin = horaireMatch[2];
                    }
                    const salleSpan = header.querySelector('.float-end');
                    if (salleSpan) {
                        salle = salleSpan.innerText.replace(/^En\s+/i, '').trim();
                    }
                }

                const matiere = el.querySelector('.edt-cours-text')?.innerText.trim() || "";
                const prof = el.querySelector('.edt-prof')?.innerText.trim() || "";

                // --- EXTRACTION DE LA COULEUR ---
                let couleur = el.style.getPropertyValue('--dhx-scheduler-event-background').trim();
                if (!couleur) {
                    const bg = window.getComputedStyle(el).backgroundColor;
                    const rgb = bg.match(/\d+/g);
                    couleur = rgb ? "#" + rgb.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('') : "#f3f3f3";
                }

                // --- DÉTECTION DES STATUTS (Annulé / Modifié) ---
                const annule = el.innerText.includes("ANNULÉ") || el.classList.contains("annule");
                const modifie = el.querySelector('.fa-triangle-exclamation') !== null || el.querySelector('[title="cours modifié"]') !== null;

                data.push({
                    jour: jourExtrait,
                    debut: debut,
                    fin: fin,
                    matiere: matiere,
                    salle: salle,
                    prof: prof,
                    couleur: couleur,
                    annule: annule,
                    modifie: modifie
                });
            });
            return data;
        });
    };

    let cours = [];

    // --- NAVIGATION ET TÉLÉCHARGEMENT DYNAMIQUE ---
    console.log("⏳ Attente de 10 secondes...");
    await pause(10000);

    const nbRecul = Math.abs(weeksBefore);
    const nbAvance = nbRecul + weeksAfter;

    // 1. Reculer jusqu'à la première semaine ciblée (si besoin)
    if (nbRecul > 0) {
        console.log(`⬅️ Navigation : recul de ${nbRecul} semaine(s)...`);
        for (let i = 0; i < nbRecul; i++) {
            await page.click('.dhx_cal_prev_button');
            await pause(10000);
        }
    }

    // 2. Extraire la première semaine
    let semaineActuelleEnCours = weeksBefore;
    console.log(`📥 Téléchargement des données (Semaine ${semaineActuelleEnCours === 0 ? "actuelle" : semaineActuelleEnCours})...`);
    cours = cours.concat(await extraireLesCours());

    // 3. Avancer progressivement jusqu'à la semaine de fin (si besoin)
    if (nbAvance > 0) {
        console.log(`➡️ Navigation : avancement sur ${nbAvance} semaine(s)...`);
        for (let i = 1; i <= nbAvance; i++) {
            await page.click('.dhx_cal_next_button');
            await pause(10000);
            
            semaineActuelleEnCours++;
            let affichageSemaine = semaineActuelleEnCours === 0 ? "actuelle" : (semaineActuelleEnCours > 0 ? "+" + semaineActuelleEnCours : semaineActuelleEnCours);
            console.log(`📥 Téléchargement des données (Semaine ${affichageSemaine})...`);
            
            cours = cours.concat(await extraireLesCours());
        }
    }

    if (cours.length > 0) {
        // --- CALCUL DES MÉTADONNÉES ---
        const endTime = Date.now();
        const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
        const now = new Date();
        const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const nbSemainesTraitees = 1 + nbAvance;

        // Création de l'objet de métadonnées
        const metadata = {
            identifiant: IDENTIFIANT,
            derniere_mise_a_jour: `${dateStr} à ${timeStr}`,
            duree_extraction: `${durationSeconds} secondes`
        };

        // On ajoute les métadonnées comme dernier élément du tableau
        cours.push(metadata);

        console.log(`✅ SUCCÈS : ${cours.length - 1} cours récupérés sur ${nbSemainesTraitees} semaine(s).`);
        console.log(`⏱️ Durée globale : ${durationSeconds}s`);
        
        fs.writeFileSync('./data_edt.json', JSON.stringify(cours, null, 2));
    } else {
        console.log("❌ ÉCHEC : Aucun cours trouvé.");
    }

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
  } finally {
    await browser.close();
  }
})();
