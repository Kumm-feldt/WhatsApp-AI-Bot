const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Generate a response from Gemini based on the context.
 * @param {Array<Object>} contextMessages - Conversation context.
 * @returns {Promise<string>} - AI-generated response.
 */
async function generateResponse(contextMessages) {
    const prompt = contextMessages.map(
        (msg) => `${msg.role === 'user' ? 'User:' : 'Assistant:'} ${msg.content}`
    ).join('\n');

    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('Error interacting with Gemini:', error);
        throw error;
    }
}

module.exports = { generateResponse };
