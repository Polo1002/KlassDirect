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
    
    // --- CONNEXION (VERSION IDENTIQUE À LA TIENNE) ---
    await pause(2000);
    await page.type('#username', IDENTIFIANT, { delay: 150 });
    await pause(1000);
    await page.type('#password', MOT_DE_PASSE, { delay: 150 });
    
    await autoLog(page, "Saisie_Identifiants");
    await page.click('#connexion');
    await pause(5000);

    // --- BOUCLE DE SÉCURITÉ (VERSION IDENTIQUE À LA TIENNE) ---
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
    
    // Attente du chargement initial du calendrier
    await page.waitForSelector('.dhx_cal_navline', { timeout: 30000 });

    // --- LOGIQUE DE NAVIGATION MULTI-SEMAINES ---
    let tousLesCours = [];
    const clicsRetour = Math.abs(NB_SEMAINES_PASSE);
    const totalSemaines = clicsRetour + NB_SEMAINES_FUTUR + 1;

    // 1. Reculer vers la semaine la plus ancienne
    if (clicsRetour > 0) {
        console.log(`⬅️ Recul de ${clicsRetour} semaines...`);
        for (let i = 0; i < clicsRetour; i++) {
            await page.click('.dhx_cal_prev_button');
            console.log(`   [Attente 10s après clic gauche]`);
            await pause(10000); 
        }
    }

    // 2. Extraire et avancer
    for (let s = 0; s < totalSemaines; s++) {
        const dateAffichee = await page.evaluate(() => document.querySelector('.dhx_cal_date')?.innerText.trim());
        console.log(`[SEMAINE ${s + 1}/${totalSemaines}] Extraction : ${dateAffichee}`);

        await page.waitForSelector('.dhx_cal_event', { timeout: 5000 }).catch(() => {});

        // EXTRACTION ORIGINALE
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

        tousLesCours.push(...coursSemaine);

        if (s < totalSemaines - 1) {
            await page.click('.dhx_cal_next_button');
            console.log(`   [Attente 10s après clic droit]`);
            await pause(10000); 
        }
    }

    // --- SAUVEGARDE ET MÉTADONNÉES ---
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

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
  } finally {
    await browser.close();
  }
})();
