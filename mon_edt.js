const puppeteer = require('puppeteer');
const fs = require('fs');

let IDENTIFIANT, MOT_DE_PASSE, RÉPONSES_SÉCURITÉ;

// Chargement des identifiants (Local ou GitHub Actions)
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

/**
 * Fonction de log combinée : capture d'écran + info console
 */
async function autoLog(page, message) {
    const info = await page.evaluate(() => ({
        url: window.location.href,
        text: document.body.innerText.substring(0, 300).replace(/\n/g, ' | ')
    }));

    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    
    try {
        await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true });
    } catch (e) {
        // Silencieux si screenshot échoue
    }

    console.log(`\n[ÉTAPE ${step}] 📸 ${message.toUpperCase()}`);
    console.log(`🔗 URL : ${info.url}`);
    console.log(`📖 TXT : ${info.text}...`);
    console.log(`-------------------------------------------`);
    
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

    // --- ÉTAPE 1 : CONNEXION INITIALE ---
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    
    await page.evaluate((id, mdp) => {
        const u = document.querySelector('#username');
        const p = document.querySelector('#password');
        if (u && p) {
            u.value = id;
            p.value = mdp;
            u.dispatchEvent(new Event('input', { bubbles: true }));
            p.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, IDENTIFIANT, MOT_DE_PASSE);
    
    await autoLog(page, "Saisie identifiants");
    await page.click('#connexion');
    
    // Attente initiale pour voir si la sécurité apparaît
    await new Promise(r => setTimeout(r, 6000));

    // --- ÉTAPE 2 : GESTION DES QUESTIONS DE SÉCURITÉ EN BOUCLE ---
    let enAttenteSecurite = true;
    let loopCount = 0;

    while (enAttenteSecurite && loopCount < 5) {
        const check = await page.evaluate(() => {
            const isVisible = !!document.querySelector('ed-questions2-fa-auth, .modal-content');
            const hasText = document.body.innerText.includes("CONFIRMEZ VOTRE IDENTITÉ");
            const question = document.querySelector('h3.mt-0')?.innerText || "";
            return { isVisible, hasText, question };
        });

        if (check.isVisible || check.hasText) {
            loopCount++;
            console.log(`🛡️ Question détectée (${loopCount}) : "${check.question}"`);
            await autoLog(page, `Securite_Question_${loopCount}`);

            const success = await page.evaluate((reps) => {
                const labels = Array.from(document.querySelectorAll('label'));
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
                    const btn = document.querySelector('button[type="submit"]');
                    if (btn) {
                        btn.removeAttribute('disabled');
                        btn.click();
                    }
                }
                return found;
            }, RÉPONSES_SÉCURITÉ);

            if (success) {
                console.log("📤 Réponse envoyée, attente de la suite...");
                await new Promise(r => setTimeout(r, 7000)); // Temps pour la question suivante ou redirection
            } else {
                console.log("⚠️ Aucune de vos réponses ne correspond à cette question.");
                break; 
            }
        } else {
            console.log("✅ Plus de barrière de sécurité détectée.");
            enAttenteSecurite = false;
        }
    }

    // --- ÉTAPE 3 : ACCÈS À L'EMPLOI DU TEMPS ---
    console.log("🚀 Navigation vers l'Emploi du Temps...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });
    
    // Petit délai pour laisser les cours s'afficher graphiquement
    await new Promise(r => setTimeout(r, 5000));
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
        console.log("❌ ÉCHEC : Aucun cours trouvé sur la page.");
        // Vérifier si on a été déconnecté
        const finalUrl = page.url();
        if (finalUrl.includes('login')) {
            console.log("🚨 Cause : Le site nous a renvoyé sur la page de login.");
        }
    }

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
    console.log("🏁 Navigateur fermé.");
  }
})();
