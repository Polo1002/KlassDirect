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
        text: document.body.innerText.substring(0, 400).replace(/\n/g, ' | ')
    }));
    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    try { await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true }); } catch (e) {}
    console.log(`\n[ÉTAPE ${step}] 📸 ${message.toUpperCase()}`);
    console.log(`🔗 URL : ${info.url}`);
    console.log(`📖 TXT : ${info.text.substring(0, 250)}...`);
    console.log(`🖼️ FICHIER : ${fileName}`);
    console.log(`-------------------------------------------`);
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
    console.log("🌐 INITIALISATION DU ROBOT");

    // --- ÉTAPE 1 : CONNEXION ---
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    await page.evaluate((id, mdp) => {
        document.querySelector('#username').value = id;
        document.querySelector('#password').value = mdp;
        document.querySelector('#username').dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#password').dispatchEvent(new Event('input', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);
    
    await autoLog(page, "Saisie identifiants");
    await page.click('#connexion');
    await new Promise(r => setTimeout(r, 8000));

    // --- ÉTAPE 2 : DOUBLE AUTH ---
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes("IDENTITÉ") || pageText.includes("CLASSE") || pageText.includes("NAISSANCE")) {
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
                    const input = document.getElementById(target.getAttribute('for')) || target.querySelector('input');
                    if (input) {
                        input.checked = true;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    found = true; break;
                }
            }
            if (found) {
                const btn = document.querySelector('button[type="submit"]');
                if (btn) { btn.removeAttribute('disabled'); btn.click(); }
            }
            return { found, matched };
        }, RÉPONSES_SÉCURITÉ);

        console.log(feedback.found ? `✅ Sélectionné : ${feedback.matched}` : "⚠️ Aucun match !");
        await autoLog(page, "Validation envoyee");

        // BOUCLE D'ATTENTE : On attend que le "Chargement en cours" disparaisse
        console.log("⏳ Attente de la redirection après sécurité...");
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const currentUrl = page.url();
            if (!currentUrl.includes('login')) break; // On a quitté la page de login
            console.log(`... Toujours sur login (essai ${i+1}/10)`);
        }
    }

    // --- ÉTAPE 3 : NAVIGATION EDT ---
    await autoLog(page, "Tentative acces EDT");
    
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    await new Promise(r => setTimeout(r, 5000));
    await autoLog(page, "Resultat final");

    const cours = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.dhx_cal_event')).map(e => ({
            m: e.querySelector('.edt-cours-text')?.innerText.trim()
        }));
    });

    if (cours.length > 0) {
        fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(cours, null, 2));
        console.log(`✅ SUCCÈS : ${cours.length} cours récupérés !`);
    } else {
        console.log("❌ ÉCHEC : Aucun cours trouvé.");
    }

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
    await autoLog(page, "Erreur fatale");
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
