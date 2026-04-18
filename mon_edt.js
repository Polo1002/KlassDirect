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
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? process.env.ED_REPONSES.split(',') : [];
}

const DIR = './Site';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;

async function autoLog(page, message) {
    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true });
    console.log(`[ÉTAPE ${step}] 📸 ${message} -> ${fileName}`);
    step++;
}

(async () => {
  if (!IDENTIFIANT || !MOT_DE_PASSE) {
      console.error("❌ Erreur : IDENTIFIANT ou MOT_DE_PASSE est vide.");
      process.exit(1);
  }

  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  try {
    console.log("🌐 Démarrage du processus...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    await autoLog(page, "Page de login chargee");

    await page.waitForSelector('#username', { timeout: 10000 });
    
    console.log("⌨️ Saisie des identifiants...");
    await page.evaluate((id, mdp) => {
        const u = document.querySelector('#username');
        const p = document.querySelector('#password');
        u.value = id;
        p.value = mdp;
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('input', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);
    
    await autoLog(page, "Identifiants saisis");

    console.log("🖱️ Clic sur Connexion...");
    await page.click('#connexion');
    await new Promise(r => setTimeout(r, 8000));
    await autoLog(page, "Apres clic connexion");

    const securityCheck = await page.$('.modal-content, ed-questions2-fa-auth'); 
    
    if (securityCheck) {
        console.log("🛡️ Double authentification détectée...");
        await autoLog(page, "Fenetre securite apparue");

        const selectionReussie = await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label.form-check-label'));
            
            for (let r of reps) {
                const search = r.trim().toLowerCase();
                // On cherche le label qui contient exactement notre réponse
                const targetLabel = labels.find(el => el.innerText.trim().toLowerCase() === search);
                
                if (targetLabel) {
                    // 1. On clique sur le label pour activer l'UI
                    targetLabel.click();
                    
                    // 2. On récupère l'input radio lié
                    const inputId = targetLabel.getAttribute('for');
                    const input = document.getElementById(inputId);
                    
                    if (input) {
                        input.checked = true;
                        // 3. IMPORTANT : On déclenche l'événement 'change' pour débloquer le bouton "Envoyer"
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    return true;
                }
            }
            return false;
        }, RÉPONSES_SÉCURITÉ);

        if (selectionReussie) {
            console.log("✅ Réponse sélectionnée et bouton débloqué.");
        } else {
            console.log("⚠️ Aucune correspondance trouvée.");
        }

        await autoLog(page, "Apres tentative selection");

        // On clique sur le bouton submit (qui ne devrait plus être 'disabled')
        const btnSubmit = 'button[type="submit"]';
        await page.waitForSelector(btnSubmit, { visible: true });
        await page.click(btnSubmit);
        
        console.log("📤 Validation envoyée...");
        await new Promise(r => setTimeout(r, 10000));
        await autoLog(page, "Apres validation securite");
    }

    console.log("🚀 Accès à l'emploi du temps...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    await new Promise(r => setTimeout(r, 5000));
    await autoLog(page, "Page EDT chargee");

    const resultats = await page.evaluate(() => {
        const events = Array.from(document.querySelectorAll('.dhx_cal_event'));
        return events.map(event => ({
            matiere: event.querySelector('.edt-cours-text')?.innerText.trim() || "Inconnu",
            header: event.querySelector('.edt-cours-header')?.innerText || ""
        }));
    });

    fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(resultats, null, 2));
    console.log(`✅ SUCCÈS : ${resultats.length} cours récupérés !`);
    await autoLog(page, "Fin de processus");

  } catch (err) {
    console.error("💥 ERREUR FATALE :", err.message);
    if (page) await autoLog(page, "Erreur fatale");
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
