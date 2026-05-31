const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
let clientReady = false;
let lastQR = null;
let notifyUrl = process.env.NOTIFY_URL || ''; // URL של הבוט לקבל עדכונים

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/data/wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ]
    }
});

// QR Code
client.on('qr', async (qr) => {
    console.log('QR התקבל, ממיר לתמונה...');
    lastQR = await qrcode.toDataURL(qr);
    console.log('QR מוכן לסריקה');
    // שלח לבוט אם יש NOTIFY_URL
    if (notifyUrl) {
        try {
            const https = require('https');
            const http = require('http');
            const mod = notifyUrl.startsWith('https') ? https : http;
            mod.get(`${notifyUrl}/whatsapp_qr_ready`);
        } catch(e) {}
    }
});

client.on('ready', () => {
    clientReady = true;
    lastQR = null;
    console.log('✅ WhatsApp מחובר!');
});

client.on('disconnected', (reason) => {
    clientReady = false;
    console.log('WhatsApp התנתק:', reason);
});

client.initialize();

// ─── API ────────────────────────────────────────────────
// סטטוס
app.get('/', (req, res) => {
    res.json({ 
        status: clientReady ? 'ready' : 'not_ready',
        qr_available: !!lastQR
    });
});

// קבל QR כתמונה
app.get('/qr', (req, res) => {
    if (!lastQR) {
        return res.status(404).json({ error: 'אין QR זמין' });
    }
    // החזר HTML עם QR
    res.send(`<!DOCTYPE html>
<html dir="rtl">
<head><title>WhatsApp QR</title>
<style>body{font-family:Arial;text-align:center;padding:40px;background:#f0f0f0;}
img{border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.2);}
h2{color:#128C7E;}</style></head>
<body>
<h2>📱 סרוק עם WhatsApp</h2>
<img src="${lastQR}" width="300" height="300">
<p>פתח WhatsApp → הגדרות → מכשירים מקושרים → קשר מכשיר</p>
</body></html>`);
});

// רשימת קבוצות
app.get('/groups', async (req, res) => {
    if (!clientReady) return res.status(503).json({ error: 'לא מחובר' });
    try {
        const chats = await client.getChats();
        const groups = chats
            .filter(c => c.isGroup)
            .map(c => ({ id: c.id._serialized, name: c.name }));
        res.json({ groups });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// שלח הודעה
app.post('/send', async (req, res) => {
    if (!clientReady) return res.status(503).json({ error: 'WhatsApp לא מחובר' });
    const { to, message, image } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'חסר to או message' });
    try {
        if (image) {
            // שלח עם תמונה
            let media;
            if (image.startsWith('http')) {
                media = await MessageMedia.fromUrl(image, { unsafeMime: true });
            } else {
                // base64
                const [header, data] = image.split(',');
                const mime = header.match(/:(.*?);/)[1];
                media = new MessageMedia(mime, data);
            }
            await client.sendMessage(to, media, { caption: message });
        } else {
            await client.sendMessage(to, message);
        }
        console.log(`✅ נשלח ל-${to}`);
        res.json({ ok: true });
    } catch(e) {
        console.error('שגיאה שליחה:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// שלח לכמה קבוצות
app.post('/send_multi', async (req, res) => {
    if (!clientReady) return res.status(503).json({ error: 'לא מחובר' });
    const { groups, message, image } = req.body;
    if (!groups || !message) return res.status(400).json({ error: 'חסר groups או message' });
    const results = [];
    for (const groupId of groups) {
        try {
            if (image) {
                let media;
                if (image.startsWith('http')) {
                    media = await MessageMedia.fromUrl(image, { unsafeMime: true });
                } else {
                    const [header, data] = image.split(',');
                    const mime = header.match(/:(.*?);/)[1];
                    media = new MessageMedia(mime, data);
                }
                await client.sendMessage(groupId, media, { caption: message });
            } else {
                await client.sendMessage(groupId, message);
            }
            results.push({ id: groupId, ok: true });
        } catch(e) {
            results.push({ id: groupId, ok: false, error: e.message });
        }
    }
    res.json({ results });
});

app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Service פועל על port ${PORT}`);
});
