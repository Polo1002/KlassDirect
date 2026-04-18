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
    
    console.log("⌨️ Saisie des identifiants (Injection)...");
    // Injection directe pour éviter que le champ reste vide
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

    const securityCheck = await page.$('.modal-content, input[type="radio"]'); 
    const isStillOnLogin = await page.$('#username');
    const isLoggedIn = await page.$('.menu-principal, #menu-top');

    if (isLoggedIn) {
        console.log("✅ Connecté avec succès !");
    } else if (securityCheck) {
        console.log("🛡️ Double authentification détectée...");
        await autoLog(page, "Fenetre securite apparue");

        const selectionReussie = await page.evaluate((reps) => {
            const elements = Array.from(document.querySelectorAll('label, .radio label, span'));
            for (let r of reps) {
                const target = elements.find(el => 
                    el.innerText.trim().toLowerCase() === r.trim().toLowerCase()
                );
                if (target) {
                    target.click();
                    return true;
                }
            }
            return false;
        }, RÉPONSES_SÉCURITÉ);

        if (!selectionReussie) console.log("⚠️ Aucune réponse n'a matché.");

        await autoLog(page, "Apres tentative selection");

        const btnSelector = 'button.btn-primary, .modal-footer button, button[type="submit"]';
        await page.waitForSelector(btnSelector, { visible: true, timeout: 5000 });
        await page.click(btnSelector);
        
        console.log("📤 Validation envoyée...");
        await new Promise(r => setTimeout(r, 8000));
        await autoLog(page, "Apres validation securite");

    } else if (isStillOnLogin) {
        throw new Error("Échec de connexion : Identifiants incorrects ou page bloquée.");
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
        const joursElements = Array.from(document.querySelectorAll('.dhx_scale_bar'));
        
        const colonnes = joursElements.map(el => {
            const rect = el.getBoundingClientRect();
            return { nom: el.innerText.trim(), left: rect.left, right: rect.right };
        });

        return events.map(event => {
            const rect = event.getBoundingClientRect();
            const centreX = rect.left + (rect.width / 2);
            const jourMatch = colonnes.find(col => centreX >= col.left && centreX <= col.right);
            const header = event.querySelector('.edt-cours-header')?.innerText || "";
            const matiere = event.querySelector('.edt-cours-text')?.innerText.trim() || "Inconnu";
            const matchHeure = header.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            
            return {
                jour: jourMatch ? jourMatch.nom : "Inconnu",
                debut: matchHeure ? matchHeure[1] : "",
                fin: matchHeure ? matchHeure[2] : "",
                matiere: matiere,
                annule: header.includes("ANNULÉ") || event.innerText.includes("ANNULÉ")
            };
        });
    });

    if (resultats.length === 0) throw new Error("EDT vide : Aucun cours trouvé.");

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
