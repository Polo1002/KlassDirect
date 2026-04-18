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
    MOT_DE_PASSE = process.env.ED_MOTDEPASSE;
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? process.env.ED_REPONSES.split(',') : [];
}

async function takeScreenshot(page, name) {
    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site', { recursive: true }); }
    await page.screenshot({ path: `./Site/${name}.png`, fullPage: true });
    console.log(`📸 Capture d'écran : ${name}.png`);
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  try {
    console.log("🌐 Étape 1 : Page de connexion...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });

    // On attend explicitement que les inputs soient là
    await page.waitForSelector('#username', { timeout: 10000 });
    
    console.log("⌨️ Saisie des identifiants...");
    // Saisie plus "humaine" pour éviter d'être bloqué
    await page.type('#username', IDENTIFIANT, { delay: 50 });
    await page.type('#password', MOT_DE_PASSE, { delay: 50 });

    await takeScreenshot(page, '1_avant_connexion'); // Vérifier si les champs sont remplis

    console.log("🖱️ Clic sur Connexion...");
    await page.click('#connexion');
    
    // On attend de voir si on change de page ou si une erreur apparaît
    await new Promise(r => setTimeout(r, 6000));

    // Vérification de la double authentification (Questions de sécurité)
    const securityCheck = await page.$('input[type="checkbox"]'); 
    const isStillOnLogin = await page.$('#username');

    if (isStillOnLogin && !securityCheck) {
        throw new Error("❌ Échec de connexion : Toujours sur la page de login après clic.");
    }

    if (securityCheck) {
        console.log("🛡️ Sécurité détectée (Questions)...");
        await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label'));
            for (let r of reps) {
                const c = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                if (c) { c.click(); return; }
            }
        }, RÉPONSES_SÉCURITÉ);
        await page.click('button.btn-primary');
        await new Promise(r => setTimeout(r, 5000));
    }

    console.log("🚀 Étape 2 : Accès à l'EDT...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    await new Promise(r => setTimeout(r, 5000));
    await takeScreenshot(page, '2_page_edt'); // Pour voir si l'agenda est là

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

    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    fs.writeFileSync('./Site/data_edt.json', JSON.stringify(resultats, null, 2));
    console.log(`✅ SUCCÈS : ${resultats.length} cours récupérés !`);

} catch (err) {
    console.error("💥 ERREUR FATALE :", err.message);
    
    // On crée le dossier s'il n'existe pas
    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site', { recursive: true }); }
    
    // On écrit l'erreur dans un fichier texte pour être sûr
    fs.writeFileSync('./Site/debug_log.txt', `Erreur: ${err.message}\nDate: ${new Date().toISOString()}`);
    
    // On force la capture d'écran
    try {
        await page.screenshot({ path: './Site/erreur_fatale.png', fullPage: true });
        console.log("📸 Capture 'erreur_fatale.png' effectuée.");
    } catch (screenshotError) {
        console.error("Impossible de prendre la capture :", screenshotError.message);
    }
    
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
