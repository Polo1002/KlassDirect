const puppeteer = require('puppeteer');
const fs = require('fs');

// --- GESTION DES IDENTIFIANTS HYBRIDE ---
let IDENTIFIANT, MOT_DE_PASSE, RÉPONSES_SÉCURITÉ;

if (fs.existsSync('./config.js')) {
    // MODE LOCAL : Le fichier existe, on l'utilise
    const config = require('./config.js');
    IDENTIFIANT = config.IDENTIFIANT;
    MOT_DE_PASSE = config.MOT_DE_PASSE;
    RÉPONSES_SÉCURITÉ = config.RÉPONSES_SÉCURITÉ;
    console.log("🏠 Mode Local : Utilisation de config.js");
} else {
    // MODE CLOUD : Le fichier n'existe pas, on prend les Secrets GitHub
    IDENTIFIANT = process.env.ED_IDENTIFIANT;
    MOT_DE_PASSE = process.env.ED_MOTDEPASSE;
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? process.env.ED_REPONSES.split(',') : [];
    console.log("☁️ Mode Cloud : Utilisation des Secrets GitHub");
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: false, 
    slowMo: 100,
    args: ['--start-maximized'] 
  }); 
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    console.log("🌐 Connexion à Ecole Directe...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });

    await page.waitForSelector('input[name="username"]');
    await page.type('input[name="username"]', IDENTIFIANT);
    await page.type('input[name="password"]', MOT_DE_PASSE);
    await page.click('button[type="submit"]');

    for (let i = 0; i < 3; i++) {
        try {
            await page.waitForSelector('.modal-content', { timeout: 5000 });
            console.log(`🛡️ Étape de sécurité ${i+1}...`);
            
            await page.evaluate((reponses) => {
                const labels = Array.from(document.querySelectorAll('label'));
                for (let r of reponses) {
                    const cible = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                    if (cible) {
                        cible.click();
                        return;
                    }
                }
            }, RÉPONSES_SÉCURITÉ);

            await page.click('button.btn-primary');
            await new Promise(r => setTimeout(r, 2500)); 
        } catch (e) {
            break; 
        }
    }

    const selectorEDT = 'a[aria-label="Emploi du temps"]';
    await page.waitForSelector(selectorEDT, { timeout: 15000 });
    await page.click(selectorEDT);

    console.log("🔍 Extraction des cours pour KlassDirect...");
    await page.waitForSelector('.dhx_cal_event', { timeout: 15000 });

    const resultats = await page.evaluate(() => {
        const joursElements = Array.from(document.querySelectorAll('.dhx_scale_bar'));
        const colonnes = joursElements.map(el => {
            const rect = el.getBoundingClientRect();
            return { nom: el.innerText.trim(), left: rect.left, right: rect.right };
        });

        const events = Array.from(document.querySelectorAll('.dhx_cal_event'));
        
        return events.map(event => {
            const rectEvent = event.getBoundingClientRect();
            const centreEvent = rectEvent.left + (rectEvent.width / 2);
            const jourMatch = colonnes.find(col => centreEvent >= col.left && centreEvent <= col.right);

            const header = event.querySelector('.edt-cours-header');
            const texteHeader = header ? header.innerText.trim() : "";
            const salle = (header?.querySelector('.float-end')?.innerText.trim() || "").replace(/^En\s+/i, "");

            const matchHeure = texteHeader.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            const matiere = event.querySelector('.edt-cours-text')?.innerText.trim() || "Autre";
            const profs = Array.from(event.querySelectorAll('.edt-prof')).map(p => p.innerText.trim()).join(' / ');

            return {
                jour: jourMatch ? jourMatch.nom : "Inconnu",
                debut: matchHeure ? matchHeure[1] : "",
                fin: matchHeure ? matchHeure[2] : "",
                matiere: matiere,
                salle: salle,
                prof: profs,
                couleur: event.style.getPropertyValue('--dhx-scheduler-event-background').trim(),
                annule: texteHeader.includes("ANNULÉ")
            };
        });
    });

    const ordreJours = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    resultats.sort((a, b) => {
        const jourA = ordreJours.indexOf(a.jour.split(' ')[0]);
        const jourB = ordreJours.indexOf(b.jour.split(' ')[0]);
        return jourA - jourB || a.debut.localeCompare(b.debut);
    });

    fs.writeFileSync('./Site/data_edt.json', JSON.stringify(resultats, null, 2));
    console.log("\n🚀 SUCCÈS : data_edt.json mis à jour.");

  } catch (err) {
    console.error("💥 Erreur :", err.message);
  } finally {
    setTimeout(async () => { await browser.close(); }, 5000);
  }
})();
