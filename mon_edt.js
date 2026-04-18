const puppeteer = require('puppeteer');
const fs = require('fs');

// --- GESTION DES IDENTIFIANTS HYBRIDE ---
let IDENTIFIANT, MOT_DE_PASSE, RÉPONSES_SÉCURITÉ;

if (fs.existsSync('./config.js')) {
    const config = require('./config.js');
    IDENTIFIANT = config.IDENTIFIANT;
    MOT_DE_PASSE = config.MOT_DE_PASSE;
    RÉPONSES_SÉCURITÉ = config.RÉPONSES_SÉCURITÉ;
    console.log("🏠 Mode Local : Utilisation de config.js");
} else {
    IDENTIFIANT = process.env.ED_IDENTIFIANT;
    MOT_DE_PASSE = process.env.ED_MOTDEPASSE;
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? process.env.ED_REPONSES.split(',') : [];
    console.log("☁️ Mode Cloud : Utilisation des Secrets GitHub");
}

// Debug discret pour vérifier que GitHub voit bien tes accès
console.log(`🔍 Vérification Identifiants : ID=${IDENTIFIANT ? 'OK' : 'VIDE'} | PWD=${MOT_DE_PASSE ? 'OK' : 'VIDE'}`);

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage', 
      '--window-size=1280,800',
      '--lang=fr-FR'
    ] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9' });

  try {
    console.log("🌐 Connexion à Ecole Directe...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });

    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.type('input[name="username"]', IDENTIFIANT);
    await page.type('input[name="password"]', MOT_DE_PASSE);
    await page.click('button[type="submit"]');

    // Gestion de la sécurité (Modals)
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

    // --- NAVIGATION DIRECTE ---
    console.log("🚀 Saut vers l'emploi du temps...");
    await page.goto('https://www.ecoledirecte.com/Eleve/EmploiDuTemps', { waitUntil: 'networkidle2' });

    console.log("🔍 Extraction des cours pour KlassDirect...");
    // Attente généreuse pour GitHub
    await page.waitForSelector('.dhx_cal_event', { timeout: 30000 });

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

    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    fs.writeFileSync('./Site/data_edt.json', JSON.stringify(resultats, null, 2));
    console.log("\n✅ SUCCÈS : Données complètes récupérées.");

  } catch (err) {
    console.error("💥 Erreur :", err.message);
    // On tente une capture d'écran pour comprendre pourquoi ça bloque
    try {
        if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
        await page.screenshot({ path: './Site/erreur_debug.png' });
        console.log("📸 Photo du bug prise (erreur_debug.png)");
    } catch (e) {}
    process.exit(1); 
  } finally {
    await browser.close();
  }
})();
