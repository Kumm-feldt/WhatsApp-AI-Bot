const { google } = require('googleapis');

// Callback handler function
const handleOAuthCallback = async (req, res, oauth2Client, adapterDB) => {
  const { code } = req.query;

  try {
    // Exchange the code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Save tokens in the database
    const userId = req.query.user_id || "defaultUser";  // You may get the user ID from the query or session
    await adapterDB.query('INSERT INTO user_tokens (user_id, access_token, refresh_token) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE access_token = ?, refresh_token = ?', [
      userId,
      tokens.access_token,
      tokens.refresh_token,
      tokens.access_token,
      tokens.refresh_token,
    ]);

    res.send('Google Calendar connected successfully!');
  } catch (error) {
    console.error('Error during OAuth callback:', error);
    res.status(500).send('Failed to authenticate with Google Calendar.');
  }
};

module.exports = { handleOAuthCallback };
