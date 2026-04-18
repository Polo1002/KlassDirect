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
            text: document.body.innerText.substring(0, 500).replace(/\n/g, ' | ')
        };
    });
    console.log(`\n--- [${step}] STATUT : ${note} ---`);
    console.log(`🔗 URL : ${info.url}`);
    console.log(`📖 TXT : ${info.text.substring(0, 200)}...`);
    console.log(`-------------------------------------------\n`);
}

async function autoLog(page, message) {
    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    try {
        await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true });
    } catch (e) {}
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
    console.log("🌐 Connexion initiale...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    
    await page.evaluate((id, mdp) => {
        const u = document.querySelector('#username');
        const p = document.querySelector('#password');
        u.value = id; p.value = mdp;
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('input', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);
    
    await page.click('#connexion');
    await new Promise(r => setTimeout(r, 8000));

    const securityCheck = await page.$('ed-questions2-fa-auth, .modal-content'); 

    if (securityCheck) {
        console.log("🛡️ Sécurité détectée. Tentative de bypass...");
        await logPageStatus(page, "Avant sélection");

        const resultatSelection = await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label'));
            let matched = false;
            
            for (let r of reps) {
                const target = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                if (target) {
                    target.click();
                    const input = document.getElementById(target.getAttribute('for'));
                    if (input) {
                        input.checked = true;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    matched = true;
                    break;
                }
            }

            if (matched) {
                // FORCE 1 : Activer le bouton
                const btn = document.querySelector('button[type="submit"]');
                if (btn) {
                    btn.removeAttribute('disabled');
                    btn.disabled = false;
                    // FORCE 2 : Soumission du formulaire par le code plutôt que par le clic
                    const form = document.querySelector('form[name="formQuestions2FA"]');
                    if (form) {
                        // On utilise requestSubmit pour simuler un vrai clic sur le bouton submit
                        form.requestSubmit ? form.requestSubmit() : form.submit();
                        return "FORM_SUBMITTED";
                    }
                }
            }
            return matched ? "MATCH_BUT_NO_FORM" : "NO_MATCH";
        }, RÉPONSES_SÉCURITÉ);

        console.log(`📡 Résultat injection : ${resultatSelection}`);
        await autoLog(page, "Apres_Tentative_Bypass");
        
        // On attend plus longtemps car la redirection 2FA est très lente
        console.log("⏳ Attente de redirection (15s)...");
        await new Promise(r => setTimeout(r, 15000));
        await logPageStatus(page, "Après attente redirection");
    }

    console.log("🚀 Direction Emploi du Temps...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    await new Promise(r => setTimeout(r, 5000));
    await logPageStatus(page, "Page finale");
    await autoLog(page, "EDT_Final");

    const cours = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.dhx_cal_event')).map(e => ({
            matiere: e.querySelector('.edt-cours-text')?.innerText.trim()
        }));
    });

    console.log(`✅ TERMINÉ : ${cours.length} cours trouvés.`);
    if (cours.length > 0) fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(cours, null, 2));

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
    await logPageStatus(page, "Crash");
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
