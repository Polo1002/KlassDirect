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
    console.log("🌐 Navigation vers EcoleDirecte...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });

    console.log("⏳ Attente du formulaire Angular...");
    // On utilise les IDs que tu m'as donnés dans le HTML
    await page.waitForSelector('#username', { timeout: 30000 });
    await page.waitForSelector('#password', { timeout: 10000 });

    console.log("💉 Injection des identifiants...");
    await page.evaluate((id, pwd) => {
        const u = document.getElementById('username');
        const p = document.getElementById('password');
        u.value = id;
        p.value = pwd;
        // On force Angular à détecter le changement
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('input', { bubbles: true }));
        u.dispatchEvent(new Event('change', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);

    await new Promise(r => setTimeout(r, 1000));
    console.log("🖱️ Clic sur le bouton #connexion...");
    await page.click('#connexion');

    // Attente de sécurité (questions)
    await new Promise(r => setTimeout(r, 5000));
    try {
        const hasModal = await page.$('.modal-content');
        if (hasModal) {
            console.log("🛡️ Passage de la sécurité...");
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

    console.log("🚀 Direction l'EDT...");
    await page.goto('https://www.ecoledirecte.com/Eleve/EmploiDuTemps', { waitUntil: 'networkidle2' });
    
    await page.waitForSelector('.dhx_cal_event', { timeout: 20000 });

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
    console.log("✅ SUCCÈS !");

  } catch (err) {
    console.error("💥 ERREUR :", err.message);
    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    await page.screenshot({ path: './Site/erreur_capture.png' });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
