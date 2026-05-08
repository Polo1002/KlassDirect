const puppeteer = require('puppeteer');
const fs = require('fs');

// ================= CONFIGURATION DES SEMAINES =================
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
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? 
        process.env.ED_REPONSES.split(',').map(s => s.replace(/["']/g, "").trim()) : [];
}

const DIR = './logs';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;
const pause = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * 1000));

// --- FONCTION DE DÉBOGAGE TEXTE ---
async function dumpPageText(page, context) {
    const text = await page.evaluate(() => document.body.innerText.replace(/\n\s*\n/g, '\n').trim());
    console.log(`\n--- [DEBUG TEXTE : ${context.toUpperCase()}] ---`);
    console.log(text.substring(0, 1000)); // On affiche les 1000 premiers caractères pour ne pas inonder les logs
    console.log(`--- [FIN DU DEBUG] ---\n`);
}

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
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2', timeout: 60000 });
    await dumpPageText(page, "Page de connexion");

    await pause(2000);
    await page.type('#username', IDENTIFIANT, { delay: 150 });
    await page.type('#password', MOT_DE_PASSE, { delay: 150 });
    await page.click('#connexion');
    
    console.log("⏳ Attente après clic connexion...");
    await pause(8000);
    await dumpPageText(page, "Après clic connexion");

    // --- DOUBLE AUTHENTIFICATION ---
    let loop = 0;
    while (loop < 3) {
        const isDoubleAuth = await page.evaluate(() => !!document.querySelector('ed-questions2-fa-auth, .modal-content'));
        if (!isDoubleAuth) break;

        console.log(`🛡️ Sécurité détectée (Tentative ${loop + 1})...`);
        
        const questionText = await page.evaluate(() => {
            const el = document.querySelector('.question-label') || document.querySelector('label');
            return el ? el.innerText.trim() : "Question non trouvée";
        });
        console.log(`🔑 Question identifiée : ${questionText}`);

        const reponseMatch = RÉPONSES_SÉCURITÉ.find(r => 
            questionText.toLowerCase().includes(r.toLowerCase()) || 
            r.toLowerCase().includes(questionText.toLowerCase())
        );
        
        if (reponseMatch) {
            console.log(`✅ Correspondance trouvée : ${reponseMatch}`);
            await page.evaluate((rep) => {
                const labels = Array.from(document.querySelectorAll('label'));
                const target = labels.find(el => el.innerText.trim().toLowerCase() === rep.toLowerCase());
                if (target) target.click();
            }, reponseMatch);
            
            await pause(1000);
            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) await submitBtn.click();
        } else {
            console.log("⚠️ Aucune réponse correspondante dans ED_REPONSES.");
        }

        await pause(7000);
        loop++;
    }

    console.log("🚀 Navigation vers l'EDT...");
    // Augmentation du timeout à 60s et passage en networkidle2 pour plus de souplesse
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
    });
    
    await dumpPageText(page, "Page EDT chargée");

    await page.waitForSelector('.dhx_cal_navline', { timeout: 30000 });
    await pause(2000);

    // --- LOGIQUE MULTI-SEMAINES ---
    let tousLesCours = [];
    const clicsRetour = Math.abs(NB_SEMAINES_PASSE);
    const totalSemaines = clicsRetour + NB_SEMAINES_FUTUR + 1;

    if (clicsRetour > 0) {
        console.log(`⬅️ Recul de ${clicsRetour} semaines...`);
        for (let i = 0; i < clicsRetour; i++) {
            await page.click('.dhx_cal_prev_button');
            console.log(`   [Attente 10s après clic gauche]`);
            await pause(10000); 
        }
    }

    for (let s = 0; s < totalSemaines; s++) {
        const dateAffichee = await page.evaluate(() => document.querySelector('.dhx_cal_date')?.innerText.trim());
        console.log(`[SEMAINE ${s + 1}/${totalSemaines}] Extraction : ${dateAffichee}`);

        await page.waitForSelector('.dhx_cal_event', { timeout: 5000 }).catch(() => {
            console.log("ℹ️ Semaine vide ou aucun cours visible.");
        });

        const coursSemaine = await page.evaluate(() => {
            const elements = document.querySelectorAll('.dhx_cal_event');
            const data = [];
            elements.forEach(el => {
                const timestamp = el.getAttribute('data-bar-start');
                let jourExtrait = "";
                if (timestamp) {
                    const d = new Date(parseInt(timestamp));
                    const jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
                    const mois = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
                    jourExtrait = `${jours[d.getDay()]} ${d.getDate()} ${mois[d.getMonth()]}`;
                }

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
                let couleur = el.style.getPropertyValue('--dhx-scheduler-event-background').trim();
                
                if (!couleur) {
                    const bg = window.getComputedStyle(el).backgroundColor;
                    const rgb = bg.match(/\d+/g);
                    couleur = rgb ? "#" + rgb.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('') : "#f3f3f3";
                }

                const annule = el.innerText.includes("ANNULÉ") || el.classList.contains("annule");
                const modifie = el.querySelector('.fa-triangle-exclamation') !== null;

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

        tousLesCours.push(...coursSemaine);

        if (s < totalSemaines - 1) {
            await page.click('.dhx_cal_next_button');
            console.log(`   [Attente 10s après clic droit]`);
            await pause(10000); 
        }
    }

    // --- SAUVEGARDE ---
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
        fs.writeFileSync('./data_edt.json', JSON.stringify(tousLesCours, null, 2));
        console.log(`✅ SUCCÈS : ${tousLesCours.length - 1} cours enregistrés.`);
    }

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
    await dumpPageText(page, "Erreur fatale");
  } finally {
    await browser.close();
  }
})();
