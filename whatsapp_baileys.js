const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));
const PORT = process.env.PORT || 3000;
const AUTH_PATH = path.join('/opt/render/project/src', 'auth_info');

let sock = null;
let clientReady = false;
let lastQR = null;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Chabad Bot', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('QR התקבל');
            lastQR = await qrcode.toDataURL(qr);
        }

        if (connection === 'close') {
            clientReady = false;
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                : true;
            console.log('התנתק, מתחבר שוב:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            clientReady = true;
            lastQR = null;
            console.log('✅ WhatsApp מחובר!');
        }
    });
}

connectToWhatsApp();

// ─── API ────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.json({
        status: clientReady ? 'ready' : 'not_ready',
        qr_available: !!lastQR
    });
});

app.get('/qr', (req, res) => {
    if (!lastQR) {
        if (clientReady) return res.send('<h2 style="color:green;font-family:Arial;text-align:center;padding:40px">✅ WhatsApp מחובר!</h2>');
        return res.send('<h2 style="font-family:Arial;text-align:center;padding:40px">⏳ ממתין ל-QR... רענן בעוד 10 שניות</h2><script>setTimeout(()=>location.reload(),10000)</script>');
    }
    res.send(`<!DOCTYPE html>
<html dir="rtl">
<head><title>WhatsApp QR</title>
<meta http-equiv="refresh" content="30">
<style>body{font-family:Arial;text-align:center;padding:40px;background:#f0f0f0;}
img{border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.2);}
h2{color:#128C7E;}</style></head>
<body>
<h2>📱 סרוק עם WhatsApp Business</h2>
<img src="${lastQR}" width="280" height="280">
<p>WhatsApp → הגדרות → מכשירים מקושרים → קשר מכשיר</p>
<p style="color:#999;font-size:12px">הדף מתרענן אוטומטית כל 30 שניות</p>
</body></html>`);
});

app.get('/groups', async (req, res) => {
    if (!clientReady) return res.status(503).json({ error: 'לא מחובר' });
    try {
        const groups = [];
        // Baileys – קבל קבוצות מה-store
        res.json({ groups, note: 'שלח הודעה לקבוצה כדי לראות אותה כאן' });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/send', async (req, res) => {
    if (!clientReady) return res.status(503).json({ error: 'WhatsApp לא מחובר' });
    const { to, message, image } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'חסר to או message' });
    try {
        const jid = to.includes('@') ? to : `${to}@g.us`;
        if (image) {
            let imageBuffer;
            if (image.startsWith('http')) {
                const fetch = require('node-fetch');
                const resp = await fetch(image);
                imageBuffer = await resp.buffer();
            } else {
                const base64Data = image.split(',')[1] || image;
                imageBuffer = Buffer.from(base64Data, 'base64');
            }
            await sock.sendMessage(jid, {
                image: imageBuffer,
                caption: message
            });
        } else {
            await sock.sendMessage(jid, { text: message });
        }
        console.log(`✅ נשלח ל-${jid}`);
        res.json({ ok: true });
    } catch(e) {
        console.error('שגיאה:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Baileys Service פועל על port ${PORT}`);
});
