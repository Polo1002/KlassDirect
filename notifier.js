const axios = require('axios');
const fs = require('fs');

const ONESIGNAL_APP_ID = "7f3b7dde-ef82-4414-b091-1c0a957b188f";
const ONESIGNAL_KEY = process.env.ONESIGNAL_API_KEY;

// Fonction pour transformer "Lun 11 Mai 2026" + "08:30" en objet Date
function parserDateComplete(jourStr, heureStr) {
    const moisMatch = { 
        'Jan': 0, 'Fév': 1, 'Mar': 2, 'Avr': 3, 'Mai': 4, 'Juin': 5, 
        'Juil': 6, 'Aoû': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Déc': 11 
    };
    const parts = jourStr.split(' '); // ["Lun", "11", "Mai", "2026"]
    const heureParts = heureStr.split(':'); // ["08", "30"]

    if (parts.length < 4 || heureParts.length < 2) return null;

    return new Date(
        parseInt(parts[3]), 
        moisMatch[parts[2]], 
        parseInt(parts[1]), 
        parseInt(heureParts[0]), 
        parseInt(heureParts[1])
    );
}

async function scheduleNotification(message, sendAt, courseId) {
    try {
        await axios.post('https://onesignal.com/api/v1/notifications', {
            app_id: ONESIGNAL_APP_ID,
            contents: { fr: message },
            send_after: sendAt.toISOString(),
            // On cible tout le monde (ton téléphone abonné)
            included_segments: ["Total Subscriptions"]
        }, {
            headers: { 
                'Authorization': `Basic ${ONESIGNAL_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ Programmée : "${message}" pour le ${sendAt.toLocaleString()}`);
    } catch (e) {
        console.error("❌ Erreur OneSignal:", e.response?.data || e.message);
    }
}

(async () => {
    if (!fs.existsSync('./data_edt.json')) return;

    const allData = JSON.parse(fs.readFileSync('./data_edt.json', 'utf8'));
    // On retire l'objet de métadonnées (le dernier du tableau)
    const coursData = allData.filter(item => !item.derniere_mise_a_jour);
    
    // Pour éviter les doublons, on garde trace de ce qu'on a déjà traité dans cette session
    // (Note : Pour un vrai historique, il faudrait un fichier notified.json, mais commençons simple)
    const maintenant = new Date();

    for (const cours of coursData) {
        if (!cours.annule && !cours.modifie) continue;

        const dateCours = parserDateComplete(cours.jour, cours.debut);
        if (!dateCours) continue;

        let sendAt;
        let texte = "";

        if (cours.annule) {
            // Pile 24h avant le cours
            sendAt = new Date(dateCours.getTime() - (24 * 60 * 60 * 1000));
            texte = `❌ Cours ANNULÉ : ${cours.matiere} demain à ${cours.debut}`;
        } else if (cours.modifie) {
            // Pile 25h avant le cours (1 jour et 1 heure)
            sendAt = new Date(dateCours.getTime() - (25 * 60 * 60 * 1000));
            texte = `⚠️ Cours MODIFIÉ : ${cours.matiere} demain à ${cours.debut}`;
        }

        // On ne programme que si le moment de l'envoi est dans le futur 
        // ET si le cours n'est pas déjà passé
        if (sendAt > maintenant && dateCours > maintenant) {
            await scheduleNotification(texte, sendAt, `${cours.matiere}-${cours.jour}`);
        }
    }
})();
