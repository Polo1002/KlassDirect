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

async function logPageStatus(page, note) {
    const info = await page.evaluate(() => {
        return {
            url: window.location.href,
            text: document.body.innerText.substring(0, 400).replace(/\n/g, ' | ')
        };
    });
    console.log(`\n--- [${step}] STATUT : ${note} ---`);
    console.log(`🔗 URL : ${info.url}`);
    console.log(`📖 TXT : ${info.text}...`);
    console.log(`-------------------------------------------\n`);
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  try {
    console.log("🌐 Étape 1 : Connexion...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    
    await page.evaluate((id, mdp) => {
        const u = document.querySelector('#username');
        const p = document.querySelector('#password');
        u.value = id; p.value = mdp;
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('change', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);
    
    await page.click('#connexion');
    await new Promise(r => setTimeout(r, 8000));

    const securityCheck = await page.$('ed-questions2-fa-auth, .modal-content'); 

    if (securityCheck) {
        console.log("🛡️ Étape 2 : Bypass Sécurité...");
        
        const feedback = await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label'));
            let found = false;
            let matchedText = "";

            for (let r of reps) {
                const target = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                if (target) {
                    matchedText = target.innerText;
                    // On simule un vrai clic utilisateur
                    target.click();
                    const input = document.getElementById(target.getAttribute('for'));
                    if (input) {
                        input.checked = true;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new Event('click', { bubbles: true }));
                    }
                    found = true;
                    break;
                }
            }

            if (found) {
                const btn = document.querySelector('button[type="submit"]');
                if (btn) {
                    btn.removeAttribute('disabled');
                    btn.disabled = false;
                    btn.click(); // On clique sur le bouton lui-même
                }
            }
            return { found, matchedText };
        }, RÉPONSES_SÉCURITÉ);

        console.log(feedback.found ? `✅ Matché : ${feedback.matchedText}` : "⚠️ Aucun match !");
        
        // ATTENTE CRUCIALE
        console.log("⏳ Validation en cours...");
        await new Promise(r => setTimeout(r, 12000));
        await logPageStatus(page, "Après validation");
    }

    console.log("🚀 Étape 3 : Emploi du Temps...");
    // On n'utilise pas goto directement car le site perd parfois le token. 
    // On clique sur le menu si possible, sinon on force la navigation.
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    await new Promise(r => setTimeout(r, 6000));
    await logPageStatus(page, "Résultat final");

    const cours = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.dhx_cal_event')).map(e => ({
            m: e.querySelector('.edt-cours-text')?.innerText.trim()
        }));
    });

    if (cours.length > 0) {
        fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(cours, null, 2));
        console.log(`✅ SUCCÈS : ${cours.length} cours récupérés !`);
    } else {
        console.log("❌ ÉCHEC : Aucun cours trouvé (session probablement expirée).");
    }

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
