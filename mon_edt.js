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
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9' });

  try {
    console.log("🌐 Direction : Page de Login...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });

    // --- SAISIE "HUMAINE" ---
    console.log("⌨️ Saisie de l'identifiant...");
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.click('input[name="username"]'); // On clique d'abord
    await page.type('input[name="username"]', IDENTIFIANT, { delay: 100 }); // On tape lentement

    console.log("⌨️ Saisie du mot de passe...");
    await page.click('input[name="password"]');
    await page.type('input[name="password"]', MOT_DE_PASSE, { delay: 100 });

    console.log("🖱️ Clic sur Connexion...");
    await page.click('button[type="submit"]');

    // On attend 5 secondes pour laisser passer les éventuelles modals
    await new Promise(r => setTimeout(r, 5000));

    // Sécurité (Questions)
    for (let i = 0; i < 3; i++) {
        try {
            const modal = await page.waitForSelector('.modal-content', { timeout: 4000 });
            if (modal) {
                console.log(`🛡️ Étape de sécurité ${i+1}...`);
                await page.evaluate((reps) => {
                    const labels = Array.from(document.querySelectorAll('label'));
                    for (let r of reps) {
                        const cible = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                        if (cible) { cible.click(); return; }
                    }
                }, RÉPONSES_SÉCURITÉ);
                await page.click('button.btn-primary');
                await new Promise(r => setTimeout(r, 3000));
            }
        } catch (e) { break; }
    }

    console.log("🚀 Navigation vers l'EDT...");
    await page.goto('https://www.ecoledirecte.com/Eleve/EmploiDuTemps', { waitUntil: 'networkidle2' });
    
    // Attente des cours
    await page.waitForSelector('.dhx_cal_event', { timeout: 20000 });

    const resultats = await page.evaluate(() => {
        const joursElements = Array.from(document.querySelectorAll('.dhx_scale_bar'));
        const colonnes = joursElements.map(el => ({ nom: el.innerText.trim(), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }));
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

    const ordreJours = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    resultats.sort((a, b) => {
        const jourA = ordreJours.indexOf(a.jour.split(' ')[0]);
        const jourB = ordreJours.indexOf(b.jour.split(' ')[0]);
        return jourA - jourB || a.debut.localeCompare(b.debut);
    });

    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    fs.writeFileSync('./Site/data_edt.json', JSON.stringify(resultats, null, 2));
    console.log("\n✅ SUCCÈS : Données récupérées !");

  } catch (err) {
    console.error("💥 ERREUR :", err.message);
    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    await page.screenshot({ path: './Site/erreur_capture.png', fullPage: true });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
