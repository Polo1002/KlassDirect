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
    // CHANGE CETTE LIGNE CI-DESSOUS pour correspondre à ton secret GitHub
    MOT_DE_PASSE = process.env.MOT_DE_PASSE; 
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? process.env.ED_REPONSES.split(',') : [];
}
// Configuration du dossier de sortie
const DIR = './Site';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;

/**
 * Prend une capture d'écran numérotée et log l'action
 */
async function autoLog(page, message) {
    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true });
    console.log(`[ÉTAPE ${step}] 📸 ${message} -> ${fileName}`);
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
    await autoLog(page, "Page de login chargee");

    await page.waitForSelector('#username', { timeout: 10000 });
    
    console.log("⌨️ Saisie des identifiants...");
    await page.type('#username', IDENTIFIANT, { delay: 50 });
    await page.type('#password', MOT_DE_PASSE, { delay: 50 });
    await autoLog(page, "Identifiants saisis");

    console.log("🖱️ Clic sur Connexion...");
    await page.click('#connexion');
    await new Promise(r => setTimeout(r, 6000));
    await autoLog(page, "Apres clic connexion");

    // Vérification de la situation
    const securityCheck = await page.$('input[type="checkbox"]'); 
    const isStillOnLogin = await page.$('#username');
    const isLoggedIn = await page.$('.menu-principal, #menu-top'); // Sélecteur typique après login

    if (isLoggedIn) {
        console.log("✅ Connecté avec succès !");
    } else if (securityCheck) {
        console.log("🛡️ Double authentification détectée...");
        await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label'));
            for (let r of reps) {
                const c = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                if (c) { c.click(); return; }
            }
        }, RÉPONSES_SÉCURITÉ);
        await autoLog(page, "Reponse securite selectionnee");
        
        // --- CORRECTION ICI ---
        const btnSelector = 'button.btn-primary, .modal-footer button, button[type="submit"]';
        await page.waitForSelector(btnSelector, { visible: true, timeout: 5000 });
        await page.click(btnSelector);
        // -----------------------

        await new Promise(r => setTimeout(r, 5000));
        await autoLog(page, "Apres validation securite");
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
            const prof = Array.from(event.querySelectorAll('.edt-prof')).map(p => p.innerText.trim()).join(', ');
            const salle = event.querySelector('.float-end')?.innerText.trim() || "";
            const matchHeure = header.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            
            return {
                jour: jourMatch ? jourMatch.nom : "Inconnu",
                debut: matchHeure ? matchHeure[1] : "",
                fin: matchHeure ? matchHeure[2] : "",
                matiere: matiere,
                prof: prof,
                salle: salle.replace(/^En\s+/i, ""),
                annule: header.includes("ANNULÉ") || event.innerText.includes("ANNULÉ"),
                couleur: event.style.getPropertyValue('--dhx-scheduler-event-background').trim()
            };
        });
    });

    if (resultats.length === 0) throw new Error("EDT vide : Aucun cours trouvé.");

    fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(resultats, null, 2));
    console.log(`✅ SUCCÈS : ${resultats.length} cours récupérés !`);
    await autoLog(page, "Fin de processus");

} catch (err) {
    console.error("💥 ERREUR FATALE :", err.message);
    fs.writeFileSync(`${DIR}/debug_log.txt`, `Erreur: ${err.message}\nDate: ${new Date().toISOString()}`);
    
    if (page) {
        await autoLog(page, "Erreur fatale");
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
