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

const DIR = './logs';
if (!fs.existsSync(DIR)) { fs.mkdirSync(DIR, { recursive: true }); }

let step = 1;

// Simulation d'attente humaine variable
const pause = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * 1000));

async function autoLog(page, message) {
    console.log(`[ÉTAPE ${step}] 📸 ${message.toUpperCase()}`);
    step++;
}

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new",
    slowMo: 50, 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  }); 

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1400, height: 900 });

  try {
    console.log("🌐 DÉMARRAGE...");
    await page.goto('https://www.ecoledirecte.com/login', { waitUntil: 'networkidle2' });
    
    // Saisie humaine lente
    await pause(2000);
    await page.type('#username', IDENTIFIANT, { delay: 150 });
    await pause(1000);
    await page.type('#password', MOT_DE_PASSE, { delay: 150 });
    
    await autoLog(page, "Saisie_Identifiants");
    await page.click('#connexion');
    await pause(5000);

    // --- BOUCLE DE SÉCURITÉ ---
    let loop = 0;
    while (loop < 5) {
        const check = await page.evaluate(() => {
            const modals = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content'));
            return { isVisible: modals.length > 0, count: modals.length };
        });

        if (!check.isVisible) break;
        loop++;

        console.log(`🛡️ Sécurité détectée (Niveau ${check.count})...`);
        await pause(3000);

        await page.evaluate((reps) => {
            const currentModal = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content')).pop();
            const labels = Array.from(currentModal.querySelectorAll('label'));
            
            for (let r of reps) {
                const target = labels.find(el => el.innerText.trim().toLowerCase() === r.toLowerCase());
                if (target) {
                    target.click();
                    return true;
                }
            }
            return false;
        }, RÉPONSES_SÉCURITÉ);

        await pause(1500);
        
        const buttonHandle = await page.evaluateHandle(() => {
            const modals = Array.from(document.querySelectorAll('ed-questions2-fa-auth, .modal-content'));
            return modals.pop()?.querySelector('button[type="submit"]');
        });

        if (buttonHandle) {
            await buttonHandle.click();
            console.log("📤 Validation envoyée.");
        }

        await pause(6000);
    }

    // --- NAVIGATION EDT ---
    console.log("🚀 Navigation vers l'EDT...");
    await page.goto('https://www.ecoledirecte.com/E/10042/EmploiDuTemps', { waitUntil: 'networkidle0' });
    
    await pause(6000);
    await autoLog(page, "Page_EDT_Finale");

    // --- NOUVELLE EXTRACTION CONFORME AU FORMAT ATTENDU ---
    const cours = await page.evaluate(() => {
        const elements = document.querySelectorAll('.dhx_cal_event');
        const data = [];

        elements.forEach(el => {
            // 1. Extraction et conversion de la couleur
            let bgCouleur = el.style.backgroundColor || window.getComputedStyle(el).backgroundColor;
            if (!bgCouleur || bgCouleur === 'transparent') {
                const body = el.querySelector('.dhx_body');
                if (body) bgCouleur = window.getComputedStyle(body).backgroundColor;
            }

            const rgbToHex = (rgb) => {
                if (!rgb) return "#f3f3f3";
                const match = rgb.match(/\d+/g);
                if (!match || match.length < 3) return "#f3f3f3";
                return "#" + match.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
            };
            const couleurHex = bgCouleur.includes('rgb') ? rgbToHex(bgCouleur) : bgCouleur;

            // 2. Extraction des horaires
            const heureTexte = el.querySelector('.dhx_event_time')?.innerText.trim() || "";
            let debut = "", fin = "";
            if (heureTexte.includes('-')) {
                const parts = heureTexte.split('-');
                debut = parts[0].trim();
                fin = parts[1].trim();
            }

            // 3. Extraction du jour (depuis l'attribut aria-label ou le titre, courant sur ED)
            let jour = "";
            const ariaLabel = el.getAttribute('aria-label') || "";
            if (ariaLabel.includes(',')) {
                // Ex: "Lundi 13 avril, 08:30..." -> On tente de récupérer "Lun 13 Avr"
                const datePart = ariaLabel.split(',')[0].trim();
                const dateWords = datePart.split(' ');
                if (dateWords.length >= 3) {
                    jour = `${dateWords[0].substring(0,3)} ${dateWords[1]} ${dateWords[2].substring(0,3)}`;
                    jour = jour.charAt(0).toUpperCase() + jour.slice(1);
                } else {
                    jour = datePart;
                }
            }

            // 4. Extraction du contenu textuel intelligent (Matière, Prof, Salle)
            const textContent = el.querySelector('.dhx_title')?.innerText.trim() || ""; 
            const bodyContent = el.querySelector('.dhx_body')?.innerText.trim() || "";
            const fullText = (textContent + "\n" + bodyContent).trim();
            const lignes = fullText.split('\n').map(l => l.trim()).filter(l => l !== "");

            // Initialisation avec les sélecteurs directs (s'ils existent)
            let matiere = el.querySelector('.edt-cours-text')?.innerText.trim() || (lignes.length > 0 ? lignes[0] : "");
            let prof = "";
            let salle = "";

            // Déduction par heuristique sur les lignes restantes
            lignes.forEach(ligne => {
                if (ligne === matiere || ligne === heureTexte) return;
                
                // Si la ligne ressemble à une salle (Ex: C203, Labo6, C3 RESEAU, GYMNASE)
                if (ligne.match(/^[A-Z][0-9]{2,3}$/) || ligne.toLowerCase().includes('labo') || ligne.toLowerCase().includes('reseau') || ligne.toLowerCase().includes('gymnase')) {
                    salle = ligne;
                } 
                // Si la ligne ressemble à un prof (Ex: BASTARDO I., M. DUPONT)
                else if (ligne.includes('.') || ligne.startsWith('M.') || ligne.startsWith('MME')) {
                    prof = ligne;
                }
            });

            // 5. Statut d'annulation
            const annule = el.classList.contains('annule') || 
                           el.classList.contains('cours-annule') || 
                           fullText.toLowerCase().includes('annulé');

            data.push({
                jour: jour,
                debut: debut,
                fin: fin,
                matiere: matiere.toUpperCase(),
                salle: salle,
                prof: prof,
                couleur: couleurHex,
                annule: annule
            });
        });

        return data;
    });

    if (cours.length > 0) {
        console.log(`✅ SUCCÈS : ${cours.length} cours récupérés avec couleurs et professeurs.`);
        fs.writeFileSync('./data_edt.json', JSON.stringify(cours, null, 2));
    } else {
        console.log("❌ ÉCHEC : Aucun cours trouvé.");
    }

  } catch (err) {
    console.error(`💥 ERREUR : ${err.message}`);
  } finally {
    await browser.close();
  }
})();
