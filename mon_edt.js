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
    // On nettoie les secrets au cas où il y aurait des guillemets ou espaces en trop
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? 
        process.env.ED_REPONSES.split(',').map(s => s.replace(/["']/g, "").trim()) : [];
}

const DIR = './Site';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;

async function autoLog(page, message) {
    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    try {
        await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true });
        console.log(`[ÉTAPE ${step}] 📸 ${message} -> ${fileName}`);
    } catch (e) {
        console.log(`[ÉTAPE ${step}] ⚠️ Screenshot impossible : ${message}`);
    }
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
    console.log("🌐 Démarrage du processus...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    
    await page.waitForSelector('#username', { timeout: 10000 });
    await page.evaluate((id, mdp) => {
        document.querySelector('#username').value = id;
        document.querySelector('#password').value = mdp;
        document.querySelector('#username').dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#password').dispatchEvent(new Event('input', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);
    
    await autoLog(page, "Identifiants saisis");
    await page.click('#connexion');
    await new Promise(r => setTimeout(r, 8000));

    const securityCheck = await page.$('ed-questions2-fa-auth, .modal-content'); 

    if (securityCheck) {
        console.log("🛡️ Double authentification détectée...");
        
        const pageContent = await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll('label')).map(l => l.innerText.trim());
            return { labels };
        });

        console.log(`📝 ÉLÉMENTS TROUVÉS : [${pageContent.labels.join(' | ')}]`);
        console.log(`📝 VOS SECRETS NETTOYÉS : [${RÉPONSES_SÉCURITÉ.join(' | ')}]`);

        const selectionReussie = await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label'));
            let success = false;

            for (let r of reps) {
                const search = r.toLowerCase();
                // Recherche par texte exact ou partiel
                const target = labels.find(el => el.innerText.trim().toLowerCase() === search);
                
                if (target) {
                    target.click(); // Clic sur le texte
                    const input = document.getElementById(target.getAttribute('for'));
                    if (input) {
                        input.checked = true;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.click(); // Clic sur le bouton radio
                    }
                    success = true;
                    break;
                }
            }
            // On débloque le bouton envoyer de force
            const btn = document.querySelector('button[type="submit"]');
            if (btn) btn.removeAttribute('disabled');
            return success;
        }, RÉPONSES_SÉCURITÉ);

        console.log(selectionReussie ? "✅ Match trouvé !" : "⚠️ Aucun match.");
        await autoLog(page, "Apres tentative selection");

        await page.click('button[type="submit"]');
        await new Promise(r => setTimeout(r, 15000));
    }

    console.log("🚀 Accès à l'emploi du temps...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    await new Promise(r => setTimeout(r, 5000));
    await autoLog(page, "Page EDT finale");

    const cours = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.dhx_cal_event')).map(e => ({
            m: e.querySelector('.edt-cours-text')?.innerText.trim()
        }));
    });

    console.log(`✅ FIN : ${cours.length} cours trouvés.`);
    if (cours.length > 0) fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(cours, null, 2));

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
    if (page) await autoLog(page, "Erreur fatale");
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
