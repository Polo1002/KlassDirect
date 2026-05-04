const puppeteer = require('puppeteer');
const fs = require('fs');

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

// Changement ici : création d'un dossier "logs" au lieu de "Site" pour les captures d'écran
const DIR = './logs';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;

// Simulation d'attente humaine variable
const pause = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * 1000));

async function autoLog(page, message) {
    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    try { await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true }); } catch (e) {}
    console.log(`[ÉTAPE ${step}] 📸 ${message.toUpperCase()}`);
    step++;
}

(async () => {
  // On ajoute un 'slowMo' global pour ralentir chaque action du navigateur
  const browser = await puppeteer.launch({ 
    headless: "new",
    slowMo: 50, 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  }); 

  const page = await browser.newPage();
  // User-Agent réaliste pour éviter d'être marqué comme robot
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1400, height: 900 });

  try {
    console.log("🌐 DÉMARRAGE...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    
    // Saisie humaine lente
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
        await pause(3000); // Temps de "lecture" de la question

        await page.evaluate((reps) => {
            const currentModal = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content')).pop();
            const labels = Array.from(currentModal.querySelectorAll('label'));
            
            for (let r of reps) {
                const target = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                if (target) {
                    target.click(); // Clic sur le texte
                    return true;
                }
            }
            return false;
        }, RÉPONSES_SÉCURITÉ);

        await pause(1500);
        
        // Validation via un clic de souris réel sur le bouton de la fenêtre du haut
        const buttonHandle = await page.evaluateHandle(() => {
            const modals = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content'));
            return modals.pop()?.querySelector('button[type="submit"]');
        });

        if (buttonHandle) {
            await buttonHandle.click();
            console.log("📤 Validation envoyée.");
        }

        await pause(6000); // Attente de traitement serveur
    }

    // --- NAVIGATION EDT ---
    console.log("🚀 Navigation vers l'EDT...");
    // On utilise la navigation par clic si possible, ou goto avec un délai
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { waitUntil: 'networkidle0' });
    
    await pause(6000);
    await autoLog(page, "Page_EDT_Finale");

    const cours = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.dhx_cal_event')).map(e => ({
            matiere: e.querySelector('.edt-cours-text')?.innerText.trim(),
            heure: e.querySelector('.dhx_event_time')?.innerText.trim()
        }));
    });

    if (cours.length > 0) {
        console.log(`✅ SUCCÈS : ${cours.length} cours récupérés.`);
        // Changement ici : utilisation de la variable 'cours' et enregistrement à la racine
        fs.writeFileSync('./data_edt.json', JSON.stringify(cours, null, 2));
    } else {
        console.log("❌ ÉCHEC : Aucun cours. Vérifiez la capture 02.");
    }

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
  } finally {
    await browser.close();
  }
})();