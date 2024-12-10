const { createBot, createProvider, createFlow, addKeyword, EVENTS } = require('@bot-whatsapp/bot');
const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const MySQLAdapter = require('@bot-whatsapp/database/mysql');
const mysql = require('mysql2');

const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

const { generateResponse } = require('./scripts/gemini'); // Import Gemini logic
// MySQL database configuration
const pool = mysql.createPool({
    host: process.env.MYSQL_DB_HOST || 'localhost',
    user: process.env.MYSQL_DB_USER || 'root',
    password: process.env.MYSQL_DB_PASSWORD || '',
    database: process.env.MYSQL_DB_NAME || 'chatbot',
    port: process.env.MYSQL_DB_PORT || '3306',
    connectionLimit: 10,
}).promise(); // Add `.promise()` here

// OAuth2 configuration (replace with your actual credentials)
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const oauth2Client = new OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Generate the URL for user authorization
function getAuthUrl() {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar'],
       // state: ctx.from, // Pass the WhatsApp number as the state

        redirect_uri: 'http://localhost:4000/oauth2/callback', // Example
    });
    return authUrl;
}

// OAuth2 callback handler
const handleOAuthCallback = async (req, res) => {
    const { code } = req.query;

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Save tokens in the database
        const userId = req.query.state; // Use a unique identifier for the user
        await pool.query(
            `INSERT INTO user_tokens (user_id, access_token, refresh_token) 
             VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE access_token = ?, refresh_token = ?`,
            [
                userId,
                tokens.access_token,
                tokens.refresh_token,
                tokens.access_token,
                tokens.refresh_token,
            ]
        );

        res.send('Your Google Calendar is now connected! 🎉');
    } catch (error) {
        console.error('Error handling OAuth callback:', error);
        res.status(500).send('Failed to connect to Google Calendar. Please try again.');
    }
};

const refreshAccessToken = async (userId) => {
    try {
        const [rows] = await pool.query('SELECT refresh_token FROM user_tokens WHERE user_id = ?', [userId]);

        if (rows.length === 0) {
            throw new Error('User not connected to Google Calendar');
        }

        const { refresh_token } = rows[0];
        oauth2Client.setCredentials({ refresh_token });
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Update new access token in the database
        await pool.query('UPDATE user_tokens SET access_token = ? WHERE user_id = ?', [
            credentials.access_token,
            userId,
        ]);

        return credentials.access_token;
    } catch (error) {
        console.error('Error refreshing access token:', error);
        throw error;
    }
};


// List user events from Google Calendar
const listUserEvents = async (userId) => {
    try {
        const [rows] = await pool.query('SELECT access_token FROM user_tokens WHERE user_id = ?', [userId]);

        if (rows.length === 0) {
            throw new Error('User not connected to Google Calendar');
        }

        oauth2Client.setCredentials({ access_token: rows[0].access_token });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: new Date().toISOString(),
            maxResults: 10,
            singleEvents: true,
            orderBy: 'startTime',
        });

        return res.data.items;
    } catch (error) {
        if (error.code === 401) {
            // Token expired, refresh and retry
            await refreshAccessToken(userId);
            return listUserEvents(userId);
        }
        throw error;
    }
};

const flowPrincipal = addKeyword(EVENTS.WELCOME).addAction(async (ctx, ctxFn) => {
    const text = ctx.body.toLowerCase();

    if (text.includes('connect calendar')) {
        // Step 1: Generate and send the OAuth URL
        const authUrl = getAuthUrl();
        await ctxFn.flowDynamic(`Please authenticate with Google Calendar using this link: ${authUrl}`);
    } else if (text.includes('code:')) {
        // Step 2: Extract the code from the message and handle the callback
        const code = text.split('code:')[1].trim();

        try {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);

            // Save tokens in the database using the promise-based API
            const userId = ctx.from; // Use a unique identifier for the user
            await pool.promise().query(
                `INSERT INTO user_tokens (user_id, access_token, refresh_token) 
                 VALUES (?, ?, ?) 
                 ON DUPLICATE KEY UPDATE access_token = ?, refresh_token = ?`,
                [
                    userId,
                    tokens.access_token,
                    tokens.refresh_token,
                    tokens.access_token,
                    tokens.refresh_token,
                ]
            );

            await ctxFn.flowDynamic('Your Google Calendar is now connected! 🎉');
        } catch (error) {
            console.error('Error handling OAuth callback:', error);
            await ctxFn.flowDynamic('Failed to connect to Google Calendar. Please try again.');
        }
    } else {
        await ctxFn.flowDynamic('Send "connect calendar" to start connecting your Google Calendar.');
    }
});





// Main function to start the bot
const main = async () => {
    try {
        // Test the database connection
        await pool.getConnection();
        console.log('Database connected successfully!');

        const adapterFlow = createFlow([flowPrincipal]);
        const adapterProvider = createProvider(BaileysProvider);
        const adapterDB = new MySQLAdapter({
            host: process.env.MYSQL_DB_HOST || 'localhost',
            user: process.env.MYSQL_DB_USER || 'root',
            password: process.env.MYSQL_DB_PASSWORD || '',
            database: process.env.MYSQL_DB_NAME || 'chatbot',
        });

        // Start the WhatsApp bot
        createBot({
            flow: adapterFlow,
            provider: adapterProvider,
            database: adapterDB,
        });

        // Start the QR portal
        QRPortalWeb();

        // Set up Express server for handling OAuth callback
        const express = require('express');
        const app = express();

        app.get('/oauth2/callback', handleOAuthCallback);

        app.listen(4000, () => {
            console.log('Server running on http://localhost:4000');
        });
    } catch (error) {
        console.error('Error starting the bot:', error);
        process.exit(1);
    }
};

main();
