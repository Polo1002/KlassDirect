const puppeteer = require('puppeteer');
const fs = require('fs');

let IDENTIFIANT, MOT_DE_PASSE, RÉPONSES_SÉCURITÉ;

// Chargement des identifiants
if (fs.existsSync('./config.js')) {
    const config = require('./config.js');
    IDENTIFIANT = config.IDENTIFIANT;
    MOT_DE_PASSE = config.MOT_DE_PASSE;
    RÉPONSES_SÉCURITÉ = config.RÉPONSES_SÉCURITÉ;
} else {
    IDENTIFIANT = process.env.ED_IDENTIFIANT;
    MOT_DE_PASSE = process.env.MOT_DE_PASSE; 
    RÉPONSES_SÉCURITÉ = process.env.ED_REPONSES ? process.env.ED_REPONSES.split(',') : [];
}

const DIR = './Site';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;

/**
 * Prend une capture d'écran numérotée et log l'action
 */
async function autoLog(page, message) {
    const fileName = `${step.toString().padStart(2, '0')}_${message.replace(/\s+/g, '_').toLowerCase()}.png`;
    try {
        await page.screenshot({ path: `${DIR}/${fileName}`, fullPage: true });
        console.log(`[ÉTAPE ${step}] 📸 ${message} -> ${fileName}`);
    } catch (e) {
        console.log(`[ÉTAPE ${step}] ⚠️ Impossible de prendre la capture : ${message}`);
    }
    step++;
}

(async () => {
  if (!IDENTIFIANT || !MOT_DE_PASSE) {
      console.error("❌ Erreur : IDENTIFIANT ou MOT_DE_PASSE est vide.");
      process.exit(1);
  }

  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
  }); 

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  try {
    console.log("🌐 Démarrage du processus...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    await autoLog(page, "Page de login chargee");

    await page.waitForSelector('#username', { timeout: 10000 });
    
    console.log("⌨️ Saisie des identifiants (Injection)...");
    await page.evaluate((id, mdp) => {
        const u = document.querySelector('#username');
        const p = document.querySelector('#password');
        u.value = id;
        p.value = mdp;
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('input', { bubbles: true }));
    }, IDENTIFIANT, MOT_DE_PASSE);
    
    await autoLog(page, "Identifiants saisis");

    console.log("🖱️ Clic sur Connexion...");
    await page.click('#connexion');
    
    // Attente du changement d'état (soit erreur, soit 2FA, soit connecté)
    await new Promise(r => setTimeout(r, 8000));
    await autoLog(page, "Apres clic connexion");

    // Détection de la situation
    const securityCheck = await page.$('ed-questions2-fa-auth, .modal-content'); 
    const isLoggedIn = await page.$('.menu-principal, #menu-top');

    if (isLoggedIn) {
        console.log("✅ Connecté directement !");
    } else if (securityCheck) {
        console.log("🛡️ Double authentification détectée...");
        
        const selectionReussie = await page.evaluate((reps) => {
            const labels = Array.from(document.querySelectorAll('label'));
            let found = false;

            for (let r of reps) {
                const search = r.trim().toLowerCase();
                if (!search) continue;

                const targetLabel = labels.find(el => el.innerText.trim().toLowerCase() === search);
                
                if (targetLabel) {
                    // 1. On clique sur le label (visuel)
                    targetLabel.click();
                    
                    // 2. On force le bouton radio lié
                    const inputId = targetLabel.getAttribute('for');
                    const input = document.getElementById(inputId);
                    if (input) {
                        input.checked = true;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new Event('click', { bubbles: true }));
                    }
                    found = true;
                    break;
                }
            }

            // 3. FORCE : Débloquer le bouton "Envoyer" s'il est disabled
            const btnSubmit = document.querySelector('button[type="submit"]');
            if (btnSubmit) {
                btnSubmit.removeAttribute('disabled');
                btnSubmit.classList.remove('disabled');
            }
            
            return found;
        }, RÉPONSES_SÉCURITÉ);

        if (selectionReussie) {
            console.log("✅ Réponse trouvée et bouton débloqué.");
        } else {
            console.log("⚠️ Aucune correspondance trouvée dans les secrets.");
        }

        await autoLog(page, "Tentative de selection");

        console.log("📤 Envoi de la réponse...");
        await page.click('button[type="submit"]');
        
        // On attend que la redirection se fasse (délai court pour éviter le blocage 10min)
        await new Promise(r => setTimeout(r, 12000));
        await autoLog(page, "Apres validation securite");
    }

    console.log("🚀 Accès à l'emploi du temps...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { 
        waitUntil: 'networkidle0',
        timeout: 45000 
    });
    
    await new Promise(r => setTimeout(r, 5000));
    await autoLog(page, "Page EDT chargee");

    const resultats = await page.evaluate(() => {
        const events = Array.from(document.querySelectorAll('.dhx_cal_event'));
        const joursElements = Array.from(document.querySelectorAll('.dhx_scale_bar'));
        
        const colonnes = joursElements.map(el => {
            const rect = el.getBoundingClientRect();
            return { nom: el.innerText.trim(), left: rect.left, right: rect.right };
        });

        return events.map(event => {
            const rect = event.getBoundingClientRect();
            const centreX = rect.left + (rect.width / 2);
            const jourMatch = colonnes.find(col => centreX >= col.left && centreX <= col.right);
            const header = event.querySelector('.edt-cours-header')?.innerText || "";
            const matiere = event.querySelector('.edt-cours-text')?.innerText.trim() || "Inconnu";
            const matchHeure = header.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            
            return {
                jour: jourMatch ? jourMatch.nom : "Inconnu",
                debut: matchHeure ? matchHeure[1] : "",
                fin: matchHeure ? matchHeure[2] : "",
                matiere: matiere,
                annule: header.includes("ANNULÉ")
            };
        });
    });

    if (resultats.length > 0) {
        fs.writeFileSync(`${DIR}/data_edt.json`, JSON.stringify(resultats, null, 2));
        console.log(`✅ SUCCÈS : ${resultats.length} cours récupérés !`);
    } else {
        throw new Error("EDT vide : Aucun cours trouvé sur la page.");
    }

    await autoLog(page, "Fin de processus");

  } catch (err) {
    console.error("💥 ERREUR FATALE :", err.message);
    if (page) await autoLog(page, "Erreur fatale");
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
