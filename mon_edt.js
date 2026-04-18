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

const DIR = './Site';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;

async function autoLog(page, message) {
    const info = await page.evaluate(() => ({
        url: window.location.href,
        text: document.body.innerText.substring(0, 300).replace(/\n/g, ' | ')
    }));

    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    
    try {
        await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true });
    } catch (e) {}

    console.log(`\n[ÉTAPE ${step}] 📸 ${message.toUpperCase()}`);
    console.log(`🔗 URL : ${info.url}`);
    console.log(`📖 TXT : ${info.text}...`);
    console.log(`🖼️ FICHIER : ${fileName}`);
    console.log(`-------------------------------------------\n`);
    
    step++;
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  try {
    console.log("🌐 DÉMARRAGE DU ROBOT");

    // --- ÉTAPE 1 : LOGIN ---
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    await page.evaluate((id, mdp) => {
        const u = document.querySelector('#username');
        const p = document.querySelector('#password');
        if(u && p) {
            u.value = id; p.value = mdp;
            u.dispatchEvent(new Event('input', { bubbles: true }));
            p.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, IDENTIFIANT, MOT_DE_PASSE);
    
    await autoLog(page, "Saisie identifiants");
    await page.click('#connexion');
    
    // Attente de la réaction du site
    await new Promise(r => setTimeout(r, 8000));

    // --- ÉTAPE 2 : SÉCURITÉ ---
    const securityCheck = await page.$('ed-questions2-fa-auth, .modal-content, h3'); 
    const pageText = await page.evaluate(() => document.body.innerText);

    if (pageText.includes("IDENTITÉ") || pageText.includes("CLASSE") || securityCheck) {
        await autoLog(page, "Detection securite");

        const feedback = await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label'));
            let found = false;
            let matched = "";

            for (let r of reps) {
                const target = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                if (target) {
                    matched = target.innerText;
                    target.click();
                    const input = document.getElementById(target.getAttribute('for'));
                    if (input) {
                        input.checked = true;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.click();
                    }
                    found = true;
                    break;
                }
            }

            if (found) {
                const btn = document.querySelector('button[type="submit"]');
                if (btn) {
                    btn.removeAttribute('disabled');
                    btn.click();
                }
            }
            return { found, matched };
        }, RÉPONSES_SÉCURITÉ);

        console.log(feedback.found ? `✅ Matché : ${feedback.matched}` : "⚠️ Aucun match trouvé dans les secrets.");
        await autoLog(page, "Apres tentative selection");
        
        await new Promise(r => setTimeout(r, 12000));
    } else {
        console.log("ℹ️ Pas de fenêtre de sécurité détectée, tentative de passage direct.");
    }

    // --- ÉTAPE 3 : EMPLOI DU TEMPS ---
    await autoLog(page, "Avant navigation EDT");
    
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    await new Promise(r => setTimeout(r, 6000));
    await autoLog(page, "Page EDT finale");

    const cours = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.dhx_cal_event')).map(e => ({
            matiere: e.querySelector('.edt-cours-text')?.innerText.trim()
        }));
    });

    if (cours.length > 0) {
        fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(cours, null, 2));
        console.log(`✅ SUCCÈS : ${cours.length} cours récupérés.`);
    } else {
        console.log("❌ ÉCHEC : Aucun cours trouvé (Session invalide ou EDT vide).");
    }

  } catch (err) {
    console.error(`💥 ERREUR FATALE : ${err.message}`);
    await autoLog(page, "Crash robot");
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
