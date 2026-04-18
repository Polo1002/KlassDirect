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
    MOT_DE_PASSE = process.env.MOT_DE_PASSE; 
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? 
        process.env.ED_REPONSES.split(',').map(s => s.replace(/["']/g, "").trim()) : [];
}

const DIR = './logs'; // On met les screenshots dans un dossier logs
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;
const pause = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * 1000));

async function autoLog(page, message) {
    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    try { await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true }); } catch (e) {}
    console.log(`[ÉTAPE ${step}] 📸 ${message.toUpperCase()}`);
    step++;
}

(async () => {
    console.log("🌐 DÉMARRAGE...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        // --- CONNEXION ---
        await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
        
        // On attend explicitement que les champs soient là
        await page.waitForSelector('input[placeholder="Identifiant"]', { visible: true });
        
        await page.type('input[placeholder="Identifiant"]', IDENTIFIANT);
        await page.type('input[placeholder="Mot de passe"]', MOT_DE_PASSE);
        
        // On attend que le bouton de connexion soit cliquable
        const loginBtn = 'button.btn-login';
        await page.waitForSelector(loginBtn, { visible: true });
        await page.click(loginBtn);
        
        await pause(3000);
        await autoLog(page, "Saisie_Identifiants");

        // ... reste du code (Double Authentification, etc.)

        // --- DOUBLE AUTHENTIFICATION ---
        const isSecurityPage = await page.evaluate(() => {
            return document.body.innerText.includes("double authentification") || !!document.querySelector('ed-questions2-fa-auth');
        });

        if (isSecurityPage) {
            console.log("🛡️ Sécurité détectée...");
            const question = await page.evaluate(() => {
                return document.querySelector('form label')?.innerText.trim() || "";
            });
            
            const reponseTrouvee = RÉPONSES_SÉCURITÉ.find(r => 
                question.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(question.toLowerCase())
            );

            if (reponseTrouvee) {
                await page.type('input[name="answer"], input[type="text"]', reponseTrouvee);
                await page.keyboard.press('Enter');
                console.log("📤 Validation envoyée.");
                await pause(6000);
            }
        }

        // --- RÉCUPÉRATION EDT ---
        console.log("🚀 Navigation vers l'EDT...");
        await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { waitUntil: 'networkidle0' });
        await pause(6000);
        await autoLog(page, "Page_EDT_Finale");

        const donneesExtraites = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.dhx_cal_event')).map(e => {
                const matiere = e.querySelector('.edt-cours-text')?.innerText.trim() || "Matière inconnue";
                const heureTexte = e.querySelector('.dhx_event_time')?.innerText.trim() || "";
                const [debut, fin] = heureTexte.split(' - ');
                
                return {
                    jour: new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }),
                    debut: debut || "",
                    fin: fin || "",
                    matiere: matiere,
                    salle: e.querySelector('.edt-salle')?.innerText.trim() || "",
                    prof: e.querySelector('.edt-prof')?.innerText.trim() || "",
                    couleur: e.style.backgroundColor || "#6366f1",
                    annule: e.classList.contains('event_annule')
                };
            });
        });

        if (donneesExtraites.length > 0) {
            console.log(`✅ SUCCÈS : ${donneesExtraites.length} cours récupérés.`);
            // ENREGISTREMENT À LA RACINE
            fs.writeFileSync('./data_edt.json', JSON.stringify(donneesExtraites, null, 2));
            console.log("💾 Fichier data_edt.json mis à jour à la racine.");
        } else {
            console.log("❌ ÉCHEC : Aucun cours trouvé.");
        }

    } catch (error) {
        console.error("💥 ERREUR :", error.message);
    } finally {
        await browser.close();
        console.log("🏁 Browser fermé.");
    }
})();
