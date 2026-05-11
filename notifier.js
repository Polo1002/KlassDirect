const axios = require('axios');
const fs = require('fs');

const ONESIGNAL_APP_ID = "7f3b7dde-ef82-4414-b091-1c0a957b188f";
const ONESIGNAL_KEY = process.env.ONESIGNAL_API_KEY;

function parserDateComplete(jourStr, heureStr, annee) {
    // Map étendue pour correspondre exactement à ton JSON (Aoû, Juil, etc.)
    const moisMatch = { 
        'Jan': 0, 'Janv': 0, 'Fév': 1, 'Mar': 2, 'Avr': 3, 'Mai': 4, 'Juin': 5, 
        'Jui': 6, 'Juil': 6, 'Aoû': 7, 'Sep': 8, 'Sept': 8, 'Oct': 9, 'Nov': 10, 'Déc': 11 
    };

    const parts = jourStr.split(' '); 
    // Format attendu : ["Jour", "Num", "Mois", "Année"]
    // Note : Ton JSON a déjà l'année dans le champ "jour" ET dans un champ "annee"
    
    if (parts.length < 3) return null;

    const jourNum = parseInt(parts[1]);
    const moisIndex = moisMatch[parts[2]];
    const anneeNum = parseInt(parts[3]) || parseInt(annee);

    // GESTION DU CAS SANS HEURE :
    // Si l'heure est vide ou invalide, on met 08:00 par défaut
    let h = 8, m = 0;
    if (heureStr && heureStr.includes(':')) {
        const hParts = heureStr.split(':');
        h = parseInt(hParts[0]);
        m = parseInt(hParts[1]);
    }

    const d = new Date(anneeNum, moisIndex, jourNum, h, m);
    return isNaN(d.getTime()) ? null : d;
}

async function scheduleNotification(message, sendAt, courseId) {
    try {
        await axios.post('https://onesignal.com/api/v1/notifications', {
            app_id: ONESIGNAL_APP_ID,
            contents: { fr: message },
            send_after: sendAt.toISOString(),
            included_segments: ["Total Subscriptions"],
            // ID unique pour éviter les doublons si le script tourne plusieurs fois
            external_id: courseId 
        }, {
            headers: { 
                'Authorization': `Basic ${ONESIGNAL_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ Programmée : "${message}" pour le ${sendAt.toLocaleString()}`);
    } catch (e) {
        // On ignore l'erreur 409 (notification déjà existante avec cet ID)
        if (e.response?.status !== 409) {
            console.error("❌ Erreur OneSignal:", e.response?.data || e.message);
        }
    }
}

(async () => {
    if (!fs.existsSync('./data_edt.json')) return;

    const allData = JSON.parse(fs.readFileSync('./data_edt.json', 'utf8'));
    // On ignore les métadonnées et les congés
    const coursData = allData.filter(item => item.matiere && item.matiere !== "CONGÉS");
    
    const maintenant = new Date();

    for (const cours of coursData) {
        if (!cours.annule && !cours.modifie) continue;

        const dateCours = parserDateComplete(cours.jour, cours.debut, cours.annee);
        if (!dateCours) continue;

        let sendAt;
        let texte = "";

        if (cours.annule) {
            // Un jour avant
            sendAt = new Date(dateCours.getTime() - (24 * 60 * 60 * 1000));
            texte = `❌ COURS ANNULÉ : ${cours.matiere} (${cours.jour})`;
        } else if (cours.modifie) {
            // Un jour et une heure avant
            sendAt = new Date(dateCours.getTime() - (25 * 60 * 60 * 1000));
            texte = `⚠️ COURS MODIFIÉ : ${cours.matiere} commence demain à ${cours.debut || '?'}`;
        }

        if (sendAt && sendAt > maintenant && dateCours > maintenant) {
            // ID unique basé sur la matière, le jour et le statut pour éviter les renvois inutiles
            const uniqueId = `notif-${cours.annule ? 'ann' : 'mod'}-${cours.matiere}-${cours.jour}`.replace(/\s+/g, '-');
            await scheduleNotification(texte, sendAt, uniqueId);
        }
    }
})();
