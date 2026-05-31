const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const path = require('path');
const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const AUTH_PATH = path.join('/opt/render/project/src', '.wwebjs_auth');

let clientReady = false;
let lastQR = null;

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
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

client.on('qr', async (qr) => {
    console.log('QR התקבל');
    lastQR = await qrcode.toDataURL(qr);
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

app.get('/', (req, res) => {
    res.json({ 
        status: clientReady ? 'ready' : 'not_ready',
        qr_available: !!lastQR
    });
});

app.get('/qr', (req, res) => {
    if (!lastQR) {
        if (clientReady) return res.send('<h2 style="color:green;font-family:Arial;text-align:center;padding:40px">✅ WhatsApp כבר מחובר!</h2>');
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
        const chats = await client.getChats();
        const groups = chats
            .filter(c => c.isGroup)
            .map(c => ({ id: c.id._serialized, name: c.name }));
        res.json({ groups });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/send', async (req, res) => {
    if (!clientReady) return res.status(503).json({ error: 'WhatsApp לא מחובר' });
    const { to, message, image } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'חסר to או message' });
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
            await client.sendMessage(to, media, { caption: message });
        } else {
            await client.sendMessage(to, message);
        }
        console.log(`✅ נשלח ל-${to}`);
        res.json({ ok: true });
    } catch(e) {
        console.error('שגיאה:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Service פועל על port ${PORT}`);
});
