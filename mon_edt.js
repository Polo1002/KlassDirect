const puppeteer = require('puppeteer');
const fs = require('fs');

// --- CONFIGURATION ---
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

console.log(`🔍 DEBUG INITIAL : ID=${IDENTIFIANT ? 'OK' : 'MANQUANT'} | PWD=${MOT_DE_PASSE ? 'OK' : 'MANQUANT'}`);

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800', '--lang=fr-FR'] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9' });

  try {
    console.log("🌐 Tentative de connexion...");
    const response = await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    
    // --- TEST GÉOGRAPHIQUE ---
    const status = response.status();
    console.log(`📊 Statut HTTP : ${status}`);
    if (status === 403 || status === 401) {
        console.error("❌ Accès refusé (403/401). Il est fort probable qu'EcoleDirecte bloque l'adresse IP de GitHub.");
    }

    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.type('input[name="username"]', IDENTIFIANT);
    await page.type('input[name="password"]', MOT_DE_PASSE);
    await page.click('button[type="submit"]');

    // Attente sécurité
    for (let i = 0; i < 3; i++) {
        try {
            await page.waitForSelector('.modal-content', { timeout: 5000 });
            console.log(`🛡️ Sécurité étape ${i+1}...`);
            await page.evaluate((reps) => {
                const labels = Array.from(document.querySelectorAll('label'));
                for (let r of reps) {
                    const c = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                    if (c) { c.click(); return; }
                }
            }, RÉPONSES_SÉCURITÉ);
            await page.click('button.btn-primary');
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) { break; }
    }

    console.log("🚀 Navigation directe vers l'EDT...");
    await page.goto('https://www.ecoledirecte.com/Eleve/EmploiDuTemps', { waitUntil: 'networkidle2' });

    // Attente des cours
    await page.waitForSelector('.dhx_cal_event', { timeout: 20000 });

    // --- TON CODE D'EXTRACTION ORIGINAL ---
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
    console.log("✅ SUCCÈS.");

  } catch (err) {
    console.error("💥 ERREUR DÉTECTÉE :", err.message);
    
    // --- SAUVEGARDE DES PREUVES ---
    if (!fs.existsSync('./Site')) { fs.mkdirSync('./Site'); }
    
    // 1. Capture d'écran
    await page.screenshot({ path: './Site/erreur_capture.png', fullPage: true });
    
    // 2. Capture du texte de la page (pour voir les messages cachés)
    const bodyText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync('./Site/erreur_log.txt', `URL: ${page.url()}\n\nTEXTE DE LA PAGE:\n${bodyText}`);
    
    console.log("📸 Preuves sauvegardées dans le dossier /Site (capture + texte).");
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
