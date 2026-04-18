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
    MOT_DE_PASSE = process.env.MOT_DE_PASSE; 
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? 
        process.env.ED_REPONSES.split(',').map(s => s.replace(/["']/g, "").trim()) : [];
}

const DIR = './Site';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;

// Fonction pour simuler une pause humaine aléatoire
const pauseHumaine = (min = 1000, max = 3000) => 
    new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)));

async function autoLog(page, message) {
    const info = await page.evaluate(() => ({
        url: window.location.href,
        text: document.body.innerText.substring(0, 300).replace(/\n/g, ' | ')
    }));
    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    try { await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true }); } catch (e) {}
    console.log(`\n[ÉTAPE ${step}] 📸 ${message.toUpperCase()}`);
    step++;
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  try {
    console.log("🌐 DÉMARRAGE DU PROCESSUS D'EXTRACTION...");

    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    
    // Simulation saisie humaine
    await pauseHumaine(1500, 3000);
    await page.evaluate((id, mdp) => {
        const u = document.querySelector('#username');
        const p = document.querySelector('#password');
        if (u && p) {
            u.value = id; u.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, IDENTIFIANT);
    await pauseHumaine(500, 1500);
    await page.evaluate((mdp) => {
        const p = document.querySelector('#password');
        if (p) {
            p.value = mdp; p.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, MOT_DE_PASSE);

    await autoLog(page, "Saisie identifiants");
    await pauseHumaine(800, 2000);
    await page.click('#connexion');
    
    await new Promise(r => setTimeout(r, 6000));

    // --- ÉTAPE 2 : GESTION DES QUESTIONS (LOGIQUE HUMAINE & FENÊTRE DU HAUT) ---
    let loopCount = 0;
    let enAttenteSecurite = true;

    while (enAttenteSecurite && loopCount < 5) {
        const check = await page.evaluate(() => {
            const modals = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content'));
            const isVisible = modals.length > 0;
            const question = modals.pop()?.querySelector('h3.mt-0')?.innerText || "";
            return { isVisible, question };
        });

        if (check.isVisible) {
            loopCount++;
            console.log(`🛡️ Question détectée (${loopCount}) : "${check.question}"`);
            
            // Temps de lecture de la question
            await pauseHumaine(2000, 4000); 
            await autoLog(page, `Securite_Question_${loopCount}`);

            const success = await page.evaluate((reps) => {
                // On cible uniquement la fenêtre tout en haut de la pile
                const modals = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content'));
                const topModal = modals.pop();
                if (!topModal) return false;

                const labels = Array.from(topModal.querySelectorAll('label'));
                let found = false;
                
                for (let r of reps) {
                    const search = r.toLowerCase();
                    const target = labels.find(el => el.innerText.trim().toLowerCase() === search);
                    
                    if (target) {
                        target.click();
                        const input = document.getElementById(target.getAttribute('for'));
                        if (input) {
                            input.checked = true;
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        found = true;
                        break;
                    }
                }

                if (found) {
                    const btn = topModal.querySelector('button[type="submit"]');
                    if (btn) {
                        btn.removeAttribute('disabled');
                        // On clique après un court délai simulé par le script
                        setTimeout(() => btn.click(), 800);
                    }
                }
                return found;
            }, RÉPONSES_SÉCURITÉ);

            if (success) {
                console.log("📤 Réponse envoyée...");
                await new Promise(r => setTimeout(r, 7000)); 
            } else {
                console.log("⚠️ Aucune réponse correspondante.");
                break; 
            }
        } else {
            console.log("✅ Accès libéré.");
            enAttenteSecurite = false;
        }
    }

    // --- ÉTAPE 3 : NAVIGATION ---
    console.log("🚀 Navigation vers l'EDT...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    await pauseHumaine(3000, 5000);
    await autoLog(page, "Page EDT finale");

    const cours = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.dhx_cal_event')).map(e => ({
            matiere: e.querySelector('.edt-cours-text')?.innerText.trim(),
            heure: e.querySelector('.dhx_event_time')?.innerText.trim()
        }));
    });

    if (cours.length > 0) {
        console.log(`✅ SUCCÈS : ${cours.length} cours trouvés.`);
        fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(cours, null, 2));
    } else {
        console.log("❌ ÉCHEC : Aucun cours trouvé.");
    }

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
    console.log("🏁 Navigateur fermé.");
  }
})();
