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
    try {
        await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true });
        console.log(`[ÉTAPE ${step}] 📸 ${message} -> ${fileName}`);
    } catch (e) {
        console.log(`[ÉTAPE ${step}] ⚠️ Screenshot impossible : ${message}`);
    }
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
    
    console.log("⌨️ Saisie des identifiants (Injection)...");
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

    const securityCheck = await page.$('ed-questions2-fa-auth, .modal-content'); 

    if (securityCheck) {
        console.log("🛡️ Double authentification détectée...");
        
        // --- NOUVEAU : RÉCUPÉRATION ET AFFICHAGE DU TEXTE ---
        const pageText = await page.evaluate(() => {
            // On récupère le titre de la question et tous les labels de réponse
            const question = document.querySelector('h3')?.innerText || "Question inconnue";
            const labels = Array.from(document.querySelectorAll('label')).map(l => l.innerText.trim());
            return { question, labels };
        });

        console.log("📝 CONTENU DÉTECTÉ SUR LA PAGE :");
        console.log(`   Question : "${pageText.question}"`);
        console.log(`   Réponses affichées : [${pageText.labels.join(' | ')}]`);
        console.log(`   Vos secrets fournis : [${RÉPONSES_SÉCURITÉ.join(' | ')}]`);
        // ---------------------------------------------------

        const selectionReussie = await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label'));
            let found = false;

            for (let r of reps) {
                const search = r.trim().toLowerCase();
                const targetLabel = labels.find(el => el.innerText.trim().toLowerCase() === search);
                
                if (targetLabel) {
                    targetLabel.click();
                    const input = document.getElementById(targetLabel.getAttribute('for'));
                    if (input) {
                        input.checked = true;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    found = true;
                    break;
                }
            }
            // Débloque le bouton quoi qu'il arrive
            const btn = document.querySelector('button[type="submit"]');
            if (btn) btn.removeAttribute('disabled');
            
            return found;
        }, RÉPONSES_SÉCURITÉ);

        if (selectionReussie) {
            console.log("✅ Match trouvé ! Sélection effectuée.");
        } else {
            console.log("⚠️ Aucune correspondance trouvée dans les secrets.");
        }

        await autoLog(page, "Tentative de selection");

        console.log("📤 Envoi de la réponse...");
        await page.click('button[type="submit"]');
        await new Promise(r => setTimeout(r, 12000));
        await autoLog(page, "Apres validation securite");
    }

    console.log("🚀 Accès à l'emploi du temps...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 45000 
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

    if (resultats.length > 0) {
        fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(resultats, null, 2));
        console.log(`✅ SUCCÈS : ${resultats.length} cours trouvés.`);
    } else {
        console.log("❌ Aucun cours trouvé dans le calendrier.");
    }

    await autoLog(page, "Fin de processus");

  } catch (err) {
    console.error("💥 ERREUR FATALE :");
    console.error(`   Message : ${err.message}`);
    // Affiche le texte de la page en cas d'erreur pour débugger
    try {
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        console.log("   Aperçu du texte de la page au moment de l'erreur :");
        console.log(`   "${bodyText}..."`);
    } catch (e) {}
    
    if (page) await autoLog(page, "Erreur fatale");
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
