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

    await page.waitForSelector('#username');
    await page.evaluate((id, pwd) => {
        const u = document.getElementById('username');
        const p = document.getElementById('password');
        u.value = id;
        p.value = pwd;
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('input', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);

    await page.click('#connexion');
    await new Promise(r => setTimeout(r, 4000));

    // Vérification sécurité
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
        await new Promise(r => setTimeout(r, 3000));
    }

    console.log("🚀 Navigation directe vers l'EDT...");
    // On utilise l'ID 10042 que tu as confirmé
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0', // On attend que tout soit chargé (images, scripts, etc.)
        timeout: 60000 
    });
    
    console.log("⏳ Extraction des données...");
    // On attend un peu plus pour être sûr que les blocs de cours apparaissent
    await new Promise(r => setTimeout(r, 5000));

    const resultats = await page.evaluate(() => {
        // Extraction des colonnes de jours
        const joursElements = Array.from(document.querySelectorAll('.dhx_scale_bar'));
        const colonnes = joursElements.map(el => {
            const rect = el.getBoundingClientRect();
            return { nom: el.innerText.trim(), left: rect.left, right: rect.right };
        });
        
        // Extraction des cours
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
        throw new Error("Aucun cours trouvé dans la page.");
    }

    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    fs.writeFileSync('./Site/data_edt.json', JSON.stringify(resultats, null, 2));
    console.log(`✅ SUCCÈS : ${resultats.length} cours enregistrés dans data_edt.json !`);

  } catch (err) {
    console.error("💥 ERREUR :", err.message);
    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site', {recursive: true}); }
    await page.screenshot({ path: './Site/erreur_capture.png' });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
