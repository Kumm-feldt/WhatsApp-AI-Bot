const { createBot, createProvider, createFlow, addKeyword, EVENTS } = require('@bot-whatsapp/bot');

const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const MySQLAdapter = require('@bot-whatsapp/database/mysql');

const { generateResponse } = require('./scripts/gemini'); // Import Gemini logic

/*
* GOOGLE CALENDAR API
*/

const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

// Replace with your credentials from Google Cloud Console
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const oauth2Client = new OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Generate the URL for user authorization
const getAuthUrl = () => {
    const SCOPES = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
    ];
    return oauth2Client.generateAuthUrl({
        access_type: 'offline', // Ensures a refresh token is provided
        scope: SCOPES,
    });
};



// Send the authentication URL
const sendAuthLink = (userId, sendMessageFn) => {
    const authUrl = getAuthUrl();
    sendMessageFn(userId, `Please authenticate: ${authUrl}`);
};

// Handle the authorization callback
const handleAuthCallback = async (code) => {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    console.log('Tokens:', tokens); // Save tokens to a database for later use
};


// Store tokens
const listEvents = async (accessToken) => {
    oauth2Client.setCredentials({ access_token: accessToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const res = await calendar.events.list({
        calendarId: 'primary', // Default calendar
        timeMin: (new Date()).toISOString(), // Start from now
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
    });
    return res.data.items;
};


// refresh tokens
const refreshAccessToken = async (refreshToken) => {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const tokens = await oauth2Client.refreshAccessToken();
    return tokens.credentials.access_token;
};










/**
 * Declaramos las conexiones de MySQL
 */
const MYSQL_DB_HOST = 'localhost';
const MYSQL_DB_USER = 'root';
const MYSQL_DB_PASSWORD = '';
const MYSQL_DB_NAME = 'chatbot';
const MYSQL_DB_PORT = '3306';

/**
 * Aqui declaramos los flujos hijos, los flujos se declaran de atras para adelante, es decir que si tienes un flujo de este tipo:
 *
 *          Menu Principal
 *           - SubMenu 1
 *             - Submenu 1.1
 *           - Submenu 2
 *             - Submenu 2.1
 *
 * Primero declaras los submenus 1.1 y 2.1, luego el 1 y 2 y al final el principal.
 */

const flowPrincipal = addKeyword(EVENTS.WELCOME).addAction(async (ctx, ctxFn) => {
    const text = ctx.body;

    const conversations = [];
    const contextMessages = conversations.flatMap((conv) => [
        { role: "user", content: conv.question },
        { role: "assistant", content: conv.answer },
    ]);
    contextMessages.push({ role: "user", content: text });

    try {
        // Call Gemini to get a response
        const response = await generateResponse(contextMessages);

        await ctxFn.flowDynamic(response);
    } catch (error) {
        console.error('Error generating response:', error);
        await ctxFn.flowDynamic('Lo siento, no pude procesar tu solicitud. Intenta de nuevo más tarde.');
    }
});

const main = async () => {
    const adapterDB = new MySQLAdapter({
        host: MYSQL_DB_HOST,
        user: MYSQL_DB_USER,
        database: MYSQL_DB_NAME,
        password: MYSQL_DB_PASSWORD,
        port: MYSQL_DB_PORT,
    });
    const adapterFlow = createFlow([flowPrincipal]);
    const adapterProvider = createProvider(BaileysProvider);
    createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });
    QRPortalWeb();
};

main();
