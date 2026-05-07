const puppeteer = require('puppeteer');
const fs = require('fs');

// ================= CONFIGURATION DES SEMAINES =================
// NB_SEMAINES_PASSE : 0 ou négatif (ex: -2 pour remonter de 2 semaines)
// NB_SEMAINES_FUTUR : 0 ou positif (ex: 1 pour aller à la semaine prochaine)
const NB_SEMAINES_PASSE = -2; 
const NB_SEMAINES_FUTUR = 1;  
// ==============================================================

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
    // Correction de la ligne 24 (SyntaxError résolue)
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

        const reponseMatch = RÉPONSES_SÉCURITÉ.find(r => 
            questionText?.toLowerCase().includes(r.toLowerCase()) || 
            r.toLowerCase().includes(questionText?.toLowerCase())
        );
        
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
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { waitUntil: 'networkidle2' });
    // Laisse le temps au site de stabiliser l'affichage
    await pause(2000);
    // Attente que le calendrier soit bien là
    await page.waitForSelector('.dhx_cal_navline', { timeout: 15000 });

    // --- LOGIQUE MULTI-SEMAINES ---
    let tousLesCours = [];
    const clicsRetour = Math.abs(NB_SEMAINES_PASSE);
    const totalSemaines = clicsRetour + NB_SEMAINES_FUTUR + 1;

    // 1. On recule jusqu'à la semaine la plus ancienne
    if (clicsRetour > 0) {
        console.log(`⬅️ Recul de ${clicsRetour} semaines...`);
        for (let i = 0; i < clicsRetour; i++) {
            await page.click('.dhx_cal_prev_button');
            await pause(2000); // Temps pour laisser le calendrier charger
        }
    }

    // 2. On boucle pour extraire chaque semaine et avancer
    for (let s = 0; s < totalSemaines; s++) {
        const dateAffichee = await page.evaluate(() => document.querySelector('.dhx_cal_date')?.innerText.trim());
        console.log(`[SEMAINE ${s+1}/${totalSemaines}] Extraction : ${dateAffichee}`);

        // On s'assure que les cours sont chargés
        await page.waitForSelector('.dhx_cal_event', { timeout: 5000 }).catch(() => {});

        const coursDeLaSemaine = await page.evaluate((dateLabel) => {
            const data = [];
            const elements = document.querySelectorAll('.dhx_cal_event');
            
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
                    periode: dateLabel, // Pour savoir de quelle semaine vient le cours
                    jour: "", // Sera rempli par ton traitement habituel si nécessaire
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
        }, dateAffichee);

        tousLesCours.push(...coursDeLaSemaine);

        // On clique sur Suivant pour la suite (sauf à la dernière semaine)
        if (s < totalSemaines - 1) {
            await page.click('.dhx_cal_next_button');
            await pause(2000);
        }
    }

    // --- SAUVEGARDE ET FIN ---
    if (tousLesCours.length > 0) {
        const endTime = Date.now();
        const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
        const now = new Date();
        
        const metadata = {
            identifiant: IDENTIFIANT,
            derniere_mise_a_jour: now.toLocaleString('fr-FR'),
            semaines_extraites: totalSemaines,
            duree_extraction: `${durationSeconds} secondes`
        };

        tousLesCours.push(metadata);

        console.log(`✅ SUCCÈS : ${tousLesCours.length - 1} cours cumulés.`);
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
