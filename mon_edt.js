const puppeteer = require('puppeteer');
const fs = require('fs');

// ================= CONFIGURATION DES SEMAINES =================
const NB_SEMAINES_PASSE = -2; // 0 ou négatif
const NB_SEMAINES_FUTUR = 1;  // 0 ou positif
// ==============================================================

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
    // Ligne 24 corrigée (plus de SyntaxError)
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? 
        process.env.ED_REPONSES.split(',').map(s => s.replace(/["']/g, "").trim()) : [];
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
  await page.setViewport({ width: 1280, height: 800 });

  try {
    console.log("🌐 DÉMARRAGE...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });

    await page.type('input[placeholder="Identifiant"]', IDENTIFIANT);
    await page.type('input[placeholder="Mot de passe"]', MOT_DE_PASSE);
    await page.click('button#connexion');
    await pause(3000);

    const isDoubleAuth = await page.evaluate(() => !!document.querySelector('ed-questions2-fa-auth'));
    if (isDoubleAuth) {
        const questionText = await page.evaluate(() => document.querySelector('.question-label')?.innerText.trim());
        console.log(`🔑 Question : ${questionText}`);

        const reponseMatch = RÉPONSES_SÉCURITÉ.find(r => questionText?.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(questionText?.toLowerCase()));
        
        if (reponseMatch) {
            await page.type('input[type="text"]', reponseMatch);
            const buttonHandle = await page.evaluateHandle(() => {
                const modals = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content'));
                return modals.pop()?.querySelector('button[type="submit"]');
            });
            if (buttonHandle) await buttonHandle.click();
        }
        await pause(6000);
    }

    console.log("🚀 Navigation vers l'EDT...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTempor', { waitUntil: 'networkidle2' });
    
    // On attend le calendrier avec un timeout plus long (30s) pour plus de robustesse
    await page.waitForSelector('.dhx_cal_navline', { timeout: 30000 });
    await pause(2000);

    // --- NOUVELLE LOGIQUE DE BOUCLE ---
    let tousLesCours = [];
    const clicsRetour = Math.abs(NB_SEMAINES_PASSE);
    const totalSemaines = clicsRetour + NB_SEMAINES_FUTUR + 1;

    // Étape A : On recule
    if (clicsRetour > 0) {
        console.log(`⬅️ Recul de ${clicsRetour} semaines...`);
        for (let i = 0; i < clicsRetour; i++) {
            await page.click('.dhx_cal_prev_button');
            await pause(10000);
        }
    }

    // Étape B : On extrait et on avance
    for (let s = 0; s < totalSemaines; s++) {
        const dateAffichee = await page.evaluate(() => document.querySelector('.dhx_cal_date')?.innerText.trim());
        console.log(`[SEMAINE ${s+1}/${totalSemaines}] Extraction : ${dateAffichee}`);

        // On attend que les cours soient là (on ne bloque pas si la semaine est vide)
        await page.waitForSelector('.dhx_cal_event', { timeout: 5000 }).catch(() => {});

        // TON EXTRACTION ORIGINALE (Inchangée)
        const coursSemaine = await page.evaluate(() => {
            const data = [];
            const elements = document.querySelectorAll('.dhx_cal_event');
            const dateLabel = document.querySelector('.dhx_cal_date')?.innerText.trim() || "";
            
            elements.forEach(e => {
                const timeContainer = e.querySelector('.dhx_event_time');
                const times = timeContainer ? timeContainer.innerText.split(' - ') : ["", ""];
                const debut = times[0] ? times[0].trim() : "";
                const fin = times[1] ? times[1].trim() : "";

                const textContent = e.querySelector('.edt-cours-text');
                const lignes = textContent ? textContent.innerText.split('\n').map(l => l.trim()).filter(l => l) : [];
                
                const matiere = lignes[0] || "Inconnu";
                const salle = lignes[1] || "";
                const prof = lignes[2] || "";
                const couleur = e.style.backgroundColor || "";
                const annule = e.classList.contains('event_annule');
                const modifie = !!e.querySelector('.fa-exclamation-triangle');

                data.push({
                    periode: dateLabel, 
                    jour: "", 
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

        tousLesCours.push(...coursSemaine);

        // On avance à la semaine suivante (sauf si c'est la dernière)
        if (s < totalSemaines - 1) {
            await page.click('.dhx_cal_next_button');
            await pause(2000);
        }
    }

    // --- TA LOGIQUE DE SAUVEGARDE ET MÉTADONNÉES (Inchangée) ---
    if (tousLesCours.length > 0) {
        const endTime = Date.now();
        const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
        const now = new Date();
        const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const metadata = {
            identifiant: IDENTIFIANT,
            derniere_mise_a_jour: `${dateStr} à ${timeStr}`,
            semaines_extraites: totalSemaines,
            duree_extraction: `${durationSeconds} secondes`
        };

        tousLesCours.push(metadata);

        console.log(`✅ SUCCÈS : ${tousLesCours.length - 1} cours récupérés sur ${totalSemaines} semaines.`);
        fs.writeFileSync('./data_edt.json', JSON.stringify(tousLesCours, null, 2));
    } else {
        console.log("❌ ÉCHEC : Aucun cours trouvé.");
    }

  } catch (error) {
    console.error(`🔴 ERREUR : ${error.message}`);
  } finally {
    await browser.close();
  }
})();
