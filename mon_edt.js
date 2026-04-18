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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800', '--lang=fr-FR'] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    console.log("🌐 Connexion à EcoleDirecte...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });

    await page.waitForSelector('#username', { timeout: 20000 });
    await page.evaluate((id, pwd) => {
        document.getElementById('username').value = id;
        document.getElementById('password').value = pwd;
        document.getElementById('username').dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('password').dispatchEvent(new Event('input', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);

    await page.click('#connexion');
    
    // Attente du chargement après login
    await new Promise(r => setTimeout(r, 5000));

    // Gestion de la sécurité si présente
    try {
        const modal = await page.$('.modal-content');
        if (modal) {
            console.log("🛡️ Réponse à la question de sécurité...");
            await page.evaluate((reps) => {
                const labels = Array.from(document.querySelectorAll('label'));
                for (let r of reps) {
                    const c = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                    if (c) { c.click(); return; }
                }
            }, RÉPONSES_SÉCURITÉ);
            await page.click('button.btn-primary');
            await new Promise(r => setTimeout(r, 3000));
        }
    } catch (e) {}

    // ON UTILISE TON ID TROUVÉ DANS LE MENU (10042)
    console.log("🚀 Navigation vers l'EDT de Paul...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { waitUntil: 'networkidle2' });
    
    console.log("⏳ Attente des cours...");
    await page.waitForSelector('.dhx_cal_event', { timeout: 30000 });

    const resultats = await page.evaluate(() => {
        const joursElements = Array.from(document.querySelectorAll('.dhx_scale_bar'));
        const colonnes = joursElements.map(el => ({ 
            nom: el.innerText.trim(), 
            left: el.getBoundingClientRect().left, 
            right: el.getBoundingClientRect().right 
        }));
        
        const events = Array.from(document.querySelectorAll('.dhx_cal_event'));
        return events.map(event => {
            const rect = event.getBoundingClientRect();
            const centre = rect.left + (rect.width / 2);
            const jourMatch = colonnes.find(col => centre >= col.left && centre <= col.right);
            const header = event.querySelector('.edt-cours-header');
            const matchHeure = (header?.innerText || "").match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            
            return {
                jour: jourMatch ? jourMatch.nom : "Inconnu",
                debut: matchHeure ? matchHeure[1] : "",
                fin: matchHeure ? matchHeure[2] : "",
                matiere: event.querySelector('.edt-cours-text')?.innerText.trim() || "Autre",
                salle: (header?.querySelector('.float-end')?.innerText.trim() || "").replace(/^En\s+/i, ""),
                prof: Array.from(event.querySelectorAll('.edt-prof')).map(p => p.innerText.trim()).join(' / '),
                couleur: event.style.getPropertyValue('--dhx-scheduler-event-background').trim(),
                annule: (header?.innerText || "").includes("ANNULÉ")
            };
        });
    });

    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    fs.writeFileSync('./Site/data_edt.json', JSON.stringify(resultats, null, 2));
    console.log(`✅ TERMINÉ : ${resultats.length} cours récupérés.`);

  } catch (err) {
    console.error("💥 ERREUR :", err.message);
    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    await page.screenshot({ path: './Site/erreur_capture.png' });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
