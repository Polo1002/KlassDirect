const puppeteer = require('puppeteer');
const fs = require('fs');

// ================= CONFIGURATION SEMAINES =================
// NB_SEMAINES_PASSE : 0 ou négatif (ex: -2 pour les deux dernières semaines)
// NB_SEMAINES_FUTUR : 0 ou positif (ex: 1 pour la semaine prochaine)
const NB_SEMAINES_PASSE = -2; 
const NB_SEMAINES_FUTUR = 1;  
// ==========================================================

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
        process.env.ED_REPONSES.split(',').map(s => s.replace(/[\"']/g, \"\").trim()) : [];
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

        // --- CONNEXION ---
        await page.type('input[placeholder="Identifiant"]', IDENTIFIANT);
        await page.type('input[placeholder="Mot de passe"]', MOT_DE_PASSE);
        await page.click('button#connexion');
        await pause(3000);

        // --- DOUBLE AUTHENTIFICATION (Si présente) ---
        const isDoubleAuth = await page.evaluate(() => !!document.querySelector('ed-questions2-fa-auth'));
        if (isDoubleAuth) {
            const questionText = await page.evaluate(() => document.querySelector('.question-label')?.innerText.trim());
            console.log(`🔑 Question : ${questionText}`);

            const reponseMatch = RÉPONSES_SÉCURITÉ.find(r => questionText?.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(questionText?.toLowerCase()));
            
            if (reponseMatch) {
                await page.type('input[type="text"]', reponseMatch);
                await page.click('button[type="submit"]');
                console.log("✅ Réponse envoyée.");
            }
            await pause(4000);
        }

        // --- NAVIGATION EDT ---
        console.log("🚀 Navigation vers l'EDT...");
        await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { waitUntil: 'networkidle0' });
        
        // Attente initiale pour charger la semaine actuelle
        await page.waitForSelector('.dhx_cal_navline', { timeout: 10000 });

        // --- LOGIQUE DE NAVIGATION MULTI-SEMAINES ---
        let tousLesCours = [];
        const clicsRetour = Math.abs(NB_SEMAINES_PASSE);
        const totalSemaines = clicsRetour + NB_SEMAINES_FUTUR + 1;

        // 1. Reculer jusqu'à la semaine la plus ancienne
        if (clicsRetour > 0) {
            console.log(`⬅️ Recul de ${clicsRetour} semaines...`);
            for (let i = 0; i < clicsRetour; i++) {
                await page.click('.dhx_cal_prev_button');
                await pause(1500); 
            }
        }

        // 2. Extraire et avancer
        for (let i = 0; i < totalSemaines; i++) {
            // Récupérer la date affichée pour les logs
            const dateAffichee = await page.evaluate(() => document.querySelector('.dhx_cal_date')?.innerText.trim());
            console.log(`[SEMAINE ${i + 1}/${totalSemaines}] Extraction : ${dateAffichee}`);

            // Attendre les cours (avec un petit délai si la semaine est vide)
            await page.waitForSelector('.dhx_cal_event', { timeout: 5000 }).catch(() => {});
            
            const coursSemaine = await page.evaluate(() => {
                const events = Array.from(document.querySelectorAll('.dhx_cal_event'));
                return events.map(e => {
                    const text = e.querySelector('.edt-cours-text')?.innerText || "";
                    const lignes = text.split('\n').map(l => l.trim()).filter(l => l);
                    
                    return {
                        jour: document.querySelector('.dhx_cal_date')?.innerText.trim(), // On garde la période pour référence
                        heure: e.querySelector('.dhx_event_time')?.innerText.trim(),
                        matiere: lignes[0] || "Inconnu",
                        salle: lignes[1] || "",
                        prof: lignes[2] || "",
                        annule: e.classList.contains('event_annule')
                    };
                });
            });

            tousLesCours.push(...coursSemaine);

            // Avancer à la semaine suivante (sauf si c'est la dernière)
            if (i < totalSemaines - 1) {
                await page.click('.dhx_cal_next_button');
                await pause(1500);
            }
        }

        // --- SAUVEGARDE ---
        if (tousLesCours.length > 0) {
            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            const now = new Date();
            
            const metadata = {
                identifiant: IDENTIFIANT,
                derniere_mise_a_jour: now.toLocaleString('fr-FR'),
                semaines_extraites: totalSemaines,
                duree_extraction: `${duration}s`
            };

            tousLesCours.push(metadata);

            fs.writeFileSync('./data_edt.json', JSON.stringify(tousLesCours, null, 2));
            console.log(`✅ SUCCÈS : ${tousLesCours.length - 1} cours sauvegardés.`);
        } else {
            console.log("❌ ÉCHEC : Aucun cours trouvé sur l'ensemble des semaines.");
        }

    } catch (error) {
        console.error(`🔴 ERREUR CRITIQUE : ${error.message}`);
    } finally {
        await browser.close();
    }
})();
