const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto'); // 🛠️ Importation du module natif pour la génération d'UUID

const ONESIGNAL_APP_ID = "7f3b7dde-ef82-4414-b091-1c0a957b188f";
const ONESIGNAL_KEY = process.env.ONESIGNAL_API_KEY;

/**
 * Convertit une chaîne textuelle unique en un format UUID v4 déterministe et valide pour OneSignal.
 */
function stringToUUID(str) {
    const hash = crypto.createHash('sha256').update(str).digest('hex');
    return [
        hash.substring(0, 8),
        hash.substring(8, 12),
        '4' + hash.substring(13, 16), // Version 4 spec
        'a' + hash.substring(17, 20), // Variant spec
        hash.substring(20, 32)
    ].join('-');
}

function parserDateComplete(jourStr, heureStr, annee) {
    // Map étendue pour correspondre exactement à ton JSON (Aoû, Juil, etc.)
    const moisMatch = { 
        'Jan': 0, 'Janv': 0, 'Fév': 1, 'Mar': 2, 'Avr': 3, 'Mai': 4, 'Juin': 5, 
        'Jui': 6, 'Juil': 6, 'Aoû': 7, 'Sep': 8, 'Sept': 8, 'Oct': 9, 'Nov': 10, 'Déc': 11 
    };

    const parts = jourStr.split(' '); 
    // Format attendu : ["Jour", "Num", "Mois", "Année"]
    
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
            // ID unique au format UUID valide pour éviter les doublons
            external_id: courseId 
        }, {
            headers: { 
                'Authorization': `Basic ${ONESIGNAL_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ Programmée : "${message}" pour le ${sendAt.toLocaleString('fr-FR')}`);
    } catch (e) {
        // On ignore sereinement l'erreur 409 (notification déjà existante avec cet ID UUID)
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

        // Tableau contenant les configurations de notifications à planifier pour ce cours
        const notificationsAProgrammer = [];

        // CAS : Cours annulé (Notification 1 jour avant)
        if (cours.annule) {
            const sendAtAnnule = new Date(dateCours.getTime() - (24 * 60 * 60 * 1000));
            notificationsAProgrammer.push({
                type: 'annule-1j',
                sendAt: sendAtAnnule,
                texte: `❌ COURS ANNULÉ : ${cours.matiere} (${cours.jour})`
            });
        }
        
        // CAS : Cours modifié (Notification 1 jour avant ET 1 heure avant)
        if (cours.modifie) {
            // 1. Rappel un jour avant
            const sendAtModifie1j = new Date(dateCours.getTime() - (24 * 60 * 60 * 1000));
            notificationsAProgrammer.push({
                type: 'modifie-1j',
                sendAt: sendAtModifie1j,
                texte: `⚠️ COURS MODIFIÉ : ${cours.matiere} commence demain à ${cours.debut || '?'}`
            });

            // 2. Rappel une heure avant
            const sendAtModifie1h = new Date(dateCours.getTime() - (1 * 60 * 60 * 1000));
            notificationsAProgrammer.push({
                type: 'modifie-1h',
                sendAt: sendAtModifie1h,
                texte: `⚠️ COURS MODIFIÉ : ${cours.matiere} commence bientôt à ${cours.debut || '?'}`
            });
        }

        // Boucle d'envoi et validation des notifications valides
        for (const notif of notificationsAProgrammer) {
            // On vérifie que la date d'envoi programmée et le cours lui-même sont bien dans le futur
            if (notif.sendAt > maintenant && dateCours > maintenant) {
                // Construction de la chaîne d'identification textuelle unique
                const rawId = `notif-${notif.type}-${cours.matiere}-${cours.jour}-${cours.debut}`.replace(/\s+/g, '-');
                // Encodage strict en UUID v4 exigé par l'API OneSignal
                const uniqueId = stringToUUID(rawId);
                
                await scheduleNotification(notif.texte, notif.sendAt, uniqueId);
            }
        }
    }
})();
