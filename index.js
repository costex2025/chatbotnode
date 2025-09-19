"use strict";

const express = require('express');
const { Client, MessageMedia } = require('whatsapp-web.js');
const QRReader = require('qrcode-reader');
const Jimp = require('jimp');
const QRCodeLib = require('qrcode'); // Nuevo require para generar imagen QR
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() }); // Configuración de multer para recibir archivos en memoria

// Inicialización de Express
const app = express();
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 3000;
const ip = process.env.IP || "0.0.0.0"; // Bind to 0.0.0.0 for production, or localhost for local development
// Definir variable para almacenar el último QR
let latestQR = null;

// ---- Configuración de sesión de WhatsApp ----
const fs = require('fs');
const sessionFile = './session.json';
let sessionData = null;
if (fs.existsSync(sessionFile)) {
    try {
        sessionData = require(sessionFile);
        console.log('Sesión cargada desde', sessionFile);
    } catch (err) {
        console.error('Error al cargar session.json:', err);
    }
}

// Inicializar el cliente de WhatsApp con la sesión (si existe)
const client = new Client({ session: sessionData });

// Guardar la sesión al autenticar
client.on('authenticated', (session) => {
    console.log('Autenticado con éxito, guardando sesión...');
    if (session) {
        try {
            fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
            console.log('Sesión guardada exitosamente en', sessionFile);
        } catch (err) {
            console.error('Error al guardar la sesión:', err);
        }
    } else {
        console.error('No se recibió sesión para guardar.');
    }
});

// Guardar la sesión cuando el cliente está listo (ready)
client.on('ready', () => {
    console.log('Cliente WhatsApp listo');
    if (client.info && client.info.wid) {
        try {
            const session = client.info;
            fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
            console.log('Sesión guardada al estar listo');
        } catch (err) {
            console.error('Error guardando sesión al estar listo:', err);
        }
    }
});

// Manejar fallo en la autenticación
client.on('auth_failure', (msg) => {
    console.error('Falló la autenticación:', msg);
    if (fs.existsSync(sessionFile)) {
        try {
            fs.unlinkSync(sessionFile);
            console.log('Sesión borrada debido a fallo de autenticación.');
        } catch (err) {
            console.error('Error al borrar session.json:', err);
        }
    }
});
// ---- Fin configuración de sesión ----

// Actualización del evento 'qr' para almacenar el código QR
client.on('qr', (qr) => {
    latestQR = qr;
    console.log('QR recibido:');
    console.log(qr);

    // Mostrar el QR en formato ASCII en el log
    const qrcodeTerminal = require('qrcode-terminal');
    qrcodeTerminal.generate(qr, { small: true });

    // Generar imagen QR y guardarla en 'qr.png'
    QRCodeLib.toFile('qr.png', qr, { type: 'png' }, (err) => {
        if (err) {
            console.error('Error generando el archivo de imagen QR:', err);
        } else {
            console.log('Imagen QR generada en: qr.png');
        }
    });
});

client.on('ready', () => {
    console.log('Cliente WhatsApp listo');
    // Guardar sesión al estar listo
    if (client.info && client.info.wid) {
        try {
            const session = client.info;
            fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
            console.log('Sesión guardada al estar listo');
        } catch (err) {
            console.error('Error guardando sesión al estar listo:', err);
        }
    }
});

// Guardar sesión en caso de desconexión
client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
    if (client.session) {
        try {
            fs.writeFileSync(sessionFile, JSON.stringify(client.session, null, 2));
            console.log('Sesión guardada en desconexión');
        } catch (err) {
            console.error('Error guardando sesión en desconexión:', err);
        }
    }
});

client.initialize();

// Endpoint para escanear un código QR a partir de una imagen
// Se puede pasar el parámetro 'file' en la query para indicar la ruta de la imagen (por defecto se usa './qr.png')
app.get('/scan', async (req, res) => {
    const filePath = req.query.file || './qr.png';
    try {
        const image = await Jimp.read(filePath);
        const qr = new QRReader();
        qr.callback = function(err, value) {
            if (err) {
                console.error('Error al escanear el QR:', err);
                return res.status(500).json({ error: 'Error al escanear el QR: ' + err });
            }
            console.log('Contenido QR:', value.result);
            return res.json({ qrContent: value.result });
        };
        qr.decode(image.bitmap);
    } catch (error) {
        console.error('Error al leer la imagen:', error);
        res.status(500).json({ error: error.toString() });
    }
});

// Endpoint para enviar un mensaje de texto
app.get('/send-message', async (req, res) => {
    const { number, text } = req.query;
    if (!number || !text) {
        return res.status(400).json({ error: 'Faltan parámetros: number y text son requeridos' });
    }
    try {
        await client.sendMessage(number + '@c.us', text);
        return res.json({ success: true, message: 'Mensaje enviado' });
    } catch (error) {
        return res.status(500).json({ error: error.toString() });
    }
});

// Endpoint para enviar un PDF
app.get('/send-pdf', async (req, res) => {
    const { number, file } = req.query;
    const filePath = file || './document.pdf';
    if (!number) {
        return res.status(400).json({ error: 'Falta el parámetro: number es requerido' });
    }
    try {
        const media = MessageMedia.fromFilePath(filePath);
        await client.sendMessage(number + '@c.us', media);
        return res.json({ success: true, message: 'PDF enviado' });
    } catch (error) {
        return res.status(500).json({ error: error.toString() });
    }
});

// Reemplazamos el endpoint /qr-image para enviar una página HTML con la imagen QR embebida
app.get('/qr-image', async (req, res) => {
    if (!latestQR) {
        return res.status(404).send('No hay código QR disponible');
    }
    try {
        const dataUrl = await QRCodeLib.toDataURL(latestQR, { type: 'image/png' });
        res.send(`
            <html>
            <head><title>QR Code</title></head>
            <body>
                <h1>Código QR</h1>
                <img src="${dataUrl}" alt="QR Code"/>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Error generando imagen QR:', err);
        res.status(500).send('Error generando imagen QR');
    }
});

// Endpoint /qr-status
app.get('/qr-status', async (req, res) => {
    try {
        const state = await client.getState();
        if (state === 'CONNECTED') {
            return res.json({ status: 'connected', message: 'WhatsApp is connected' });
        } else {
            if (latestQR) {
                const dataUrl = await QRCodeLib.toDataURL(latestQR, { type: 'image/png' });
                res.send(`
                    <html>
                    <head><title>QR Code</title></head>
                    <body>
                        <h1>Scan QR to connect</h1>
                        <img src="${dataUrl}" alt="QR Code"/>
                    </body>
                    </html>
                `);
            } else {
                return res.status(404).send('No QR available, please wait for QR generation');
            }
        }
    } catch (e) {
        return res.status(500).json({ error: 'Error checking status' });
    }
});

// Actualización del endpoint /enviar para agregar verificación del estado del cliente
app.post('/enviar', upload.single('pdf'), async (req, res) => {
    console.log('Solicitud recibida en /enviar');
    const { numero, mensaje } = req.body;
    if (!numero || !mensaje) {
        return res.status(400).json({ error: 'Faltan campos: numero y mensaje son requeridos' });
    }

    // Verificar que el cliente de WhatsApp esté listo
    if (!client.info) {
        return res.status(503).json({ error: 'El cliente de WhatsApp no está listo, intente más tarde' });
    }

    // Verificar que el cliente esté realmente conectado
    let state = "";
    try {
        state = await client.getState();
    } catch (e) {
        console.error('Error obteniendo el estado del cliente:', e);
        return res.status(503).json({ error: 'No se pudo obtener el estado del cliente' });
    }
    if (state !== 'CONNECTED') {
        return res.status(503).json({ error: 'El cliente de WhatsApp no está conectado (estado: ' + state + '), intente más tarde' });
    }

    try {
        if (req.file) {
            // Crear objeto media y enviarlo con caption para incluir el mensaje
            const media = new MessageMedia(req.file.mimetype, req.file.buffer.toString('base64'), req.file.originalname);
            await client.sendMessage(numero + '@c.us', media, { caption: mensaje });
        } else {
            // Enviar solo mensaje de texto
            await client.sendMessage(numero + '@c.us', mensaje);
        }
        res.json({ success: true, message: 'Mensaje y PDF enviados' });
    } catch (error) {
        console.error('Error enviando datos:', error);
        res.status(500).json({ error: error.toString() });
    }
});

// Endpoint /generate-qr
app.get('/generate-qr', async (req, res) => {
    try {
        const state = await client.getState();
        if (state === 'CONNECTED') {
            await client.logout();
            return res.json({ message: 'Logged out, new QR will be generated' });
        } else {
            return res.json({ message: 'Not connected, QR should be available or generating' });
        }
    } catch (e) {
        return res.status(500).json({ error: e.toString() });
    }
});

// Keep-alive endpoint to prevent Render from detecting pause
app.get('/keep-alive', (req, res) => {
    res.status(200).send('OK');
});

// Arrancar el servidor Express
app.listen(port, ip, () => {
    console.log(`Servidor Express escuchando en http://${ip}:${port}`);
});
