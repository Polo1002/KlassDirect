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
    console.log(`📸 Capture d'écran sauvegardée : ${name}.png`);
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1600,900'] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  try {
    console.log("🌐 Connexion à EcoleDirecte...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });

    await page.waitForSelector('#username', { timeout: 15000 });
    await page.evaluate((id, pwd) => {
        const u = document.getElementById('username');
        const p = document.getElementById('password');
        u.value = id;
        p.value = pwd;
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('input', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);

    await page.click('#connexion');
    await new Promise(r => setTimeout(r, 5000));

    // Sécurité / Questions
    const needsSecurity = await page.$('.modal-content');
    if (needsSecurity) {
        console.log("🛡️ Sécurité détectée...");
        await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label'));
            for (let r of reps) {
                const c = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                if (c) { c.click(); break; }
            }
        }, RÉPONSES_SÉCURITÉ);
        await page.click('button.btn-primary');
        await new Promise(r => setTimeout(r, 5000));
    }

    console.log("🚀 Accès à l'emploi du temps...");
    // Utilisation de l'ID 10042
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    console.log("⏳ Attente de l'apparition des cours...");
    // On attend que l'un des blocs de cours soit réellement présent dans le DOM
    try {
        await page.waitForSelector('.dhx_cal_event', { timeout: 15000, visible: true });
    } catch (e) {
        console.log("⚠️ Sélecteur standard non trouvé, tentative de secours...");
        await new Promise(r => setTimeout(r, 5000)); // Dernier délai de grâce
    }

    const resultats = await page.evaluate(() => {
        const joursElements = Array.from(document.querySelectorAll('.dhx_scale_bar'));
        const colonnes = joursElements.map(el => {
            const rect = el.getBoundingClientRect();
            return { nom: el.innerText.trim(), left: rect.left, right: rect.right };
        });
        
        const events = Array.from(document.querySelectorAll('.dhx_cal_event'));
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

    if (resultats.length === 0) {
        throw new Error("Extraction vide : Aucun cours n'a pu être lu.");
    }

    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    fs.writeFileSync('./Site/data_edt.json', JSON.stringify(resultats, null, 2));
    console.log(`✅ SUCCÈS : ${resultats.length} cours récupérés !`);

  } catch (err) {
    console.error("💥 ERREUR :", err.message);
    await takeScreenshot(page, 'erreur_capture');
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
