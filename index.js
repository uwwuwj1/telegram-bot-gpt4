

const fs = require('fs');
const yaml = require('js-yaml');
const mysql = require('mysql2/promise');
const TelegramBot = require('node-telegram-bot-api');
const { Configuration, OpenAIApi } = require('openai');

// -----------------------------------------------------------------------------
// 1. Load Config from config.yaml
// -----------------------------------------------------------------------------
const CONFIG_FILE = 'config.yaml';
let config;
try {
    const fileContents = fs.readFileSync(CONFIG_FILE, 'utf8');
    config = yaml.load(fileContents);
} catch (err) {
    console.error('Error reading config.yaml:', err);
    process.exit(1);
}

// Telegram Bot token
const BOT_TOKEN = config.BOT_TOKEN;
// OpenAI API Key
const OPENAI_API_KEY = config.OPENAI_API_KEY || '';
// Bot usage settings
const TIME_SPAN = config.TIME_SPAN || 60;
const MAX_TOKEN = config.MAX_TOKEN || 2000;
const CONTEXT_COUNT = config.CONTEXT_COUNT || 5;
const RATE_LIMIT = config.RATE_LIMIT || 3;
const NOTIFICATION_CHANNEL = config.NOTIFICATION_CHANNEL || '';
const IMAGE_RATE_LIMIT = config.IMAGE_RATE_LIMIT || 2;

// MySQL config
const dbConfig = {
    host: config.DB_HOST || 'localhost',
    user: config.DB_USER || 'root',
    password: config.DB_PASSWORD || '',
    database: config.DB_NAME || 'test'
};

// -----------------------------------------------------------------------------
// 2. Initialize MySQL Pool
// -----------------------------------------------------------------------------
let pool;
async function initDB() {
    try {
        pool = await mysql.createPool(dbConfig);
        console.log('MySQL connection pool created.');
    } catch (error) {
        console.error('Error creating MySQL pool:', error);
        process.exit(1);
    }
}

async function getConnection() {
    if (!pool) {
        await initDB();
    }
    return pool;
}

// -----------------------------------------------------------------------------
// 3. Initialize Telegram Bot
// -----------------------------------------------------------------------------
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('Telegram bot started.');

// -----------------------------------------------------------------------------
// 4. Initialize OpenAI
// -----------------------------------------------------------------------------
let openai;
if (OPENAI_API_KEY) {
    const openaiConfig = new Configuration({ apiKey: OPENAI_API_KEY });
    openai = new OpenAIApi(openaiConfig);
    console.log('OpenAI initialized.');
} else {
    console.warn('No OPENAI_API_KEY provided. OpenAI features disabled.');
}

// -----------------------------------------------------------------------------
// 5. Common Utility: Insert or Update User in DB
// -----------------------------------------------------------------------------
async function ensureUserInDatabase(userId, firstName) {
    try {
        const conn = await getConnection();
        await conn.execute(
            'INSERT IGNORE INTO users (user_id, nick_name) VALUES (?, ?)',
            [userId, firstName]
        );
        // Additional fields can be updated or inserted here if needed
    } catch (error) {
        console.error('Database error while ensuring user record:', error);
    }
}

// -----------------------------------------------------------------------------
// 6. Helper: Rate Limiting (Placeholder logic if needed)
// -----------------------------------------------------------------------------
function isRateLimited(userId) {
    // Implement your own rate-limiting logic if needed.
    // For now, just returns false (unlimited).
    return false;
}

// -----------------------------------------------------------------------------
// 7. Bot Commands & Handlers
// -----------------------------------------------------------------------------

// /start command
bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = msg.from.first_name || 'User';

    // Insert user into DB
    await ensureUserInDatabase(userId, userName);

    bot.sendMessage(chatId, `Hello, ${userName}! Use the menu below:`, {
        reply_markup: {
            keyboard: [
                [{ text: '🔤Language' }, { text: '🖼Image' }, { text: '🚀Start' }],
                [{ text: '🆘Help' }, { text: '🙋Switch Roles' }, { text: '🔃Restart Session' }],
                [{ text: '📈Statistics' }]
            ],
            one_time_keyboard: false,
            resize_keyboard: true
        }
    });
});

// /help command
bot.onText(/^\/help$/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Available commands:\n/start - Start the bot\n/help - Show help\nUse the menu buttons for more options.');
});

// Catch all messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || '';
    const firstName = msg.from.first_name || 'User';

    // Ensure user is in the database
    await ensureUserInDatabase(userId, firstName);

    // Simple rate limiting check
    if (isRateLimited(userId)) {
        bot.sendMessage(chatId, 'You are being rate-limited, please wait.');
        return;
    }

    // Handling keyboard button presses
    switch (text) {
        case '🔤Language':
            await handleLanguage(chatId);
            break;
        case '🖼Image':
            await handleImagePrompt(chatId);
            break;
        case '🚀Start':
            bot.sendMessage(chatId, 'Starting new conversation...');
            // Could do actions like clearing context, etc.
            break;
        case '🆘Help':
            bot.sendMessage(chatId, 'Use /help for detailed instructions. Ask me anything!');
            break;
        case '🙋Switch Roles':
            bot.sendMessage(chatId, 'Role switching feature is not fully implemented yet.');
            break;
        case '🔃Restart Session':
            bot.sendMessage(chatId, 'Session restarted. All conversation context cleared.');
            // Clear or reset your conversation context in DB or memory here if implemented
            break;
        case '📈Statistics':
            bot.sendMessage(chatId, 'Statistics are not implemented yet. (Placeholder)');
            break;
        default:
            // Could interpret user text as an AI prompt if openai is configured
            if (openai) {
                await handleOpenAIPrompt(chatId, text);
            } else {
                bot.sendMessage(chatId, 'No AI features configured. Received: ' + text);
            }
            break;
    }
});

// -----------------------------------------------------------------------------
// 8. Inline Keyboard for Language Selection
// -----------------------------------------------------------------------------
async function handleLanguage(chatId) {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'English', callback_data: 'lang_en' },
                    { text: '中文', callback_data: 'lang_cn' }
                ]
            ]
        }
    };
    bot.sendMessage(chatId, 'Please choose your language:', options);
}

// Handle callback queries
bot.on('callback_query', async (query) => {
    const data = query.data;
    const userId = query.from.id;
    const userName = query.from.first_name || 'User';

    // Always answer callback queries
    bot.answerCallbackQuery(query.id).catch(console.error);

    if (data.startsWith('lang_')) {
        const selectedLang = data.split('_')[1];
        try {
            const conn = await getConnection();
            await conn.execute(
                'UPDATE users SET lang = ?, nick_name = ? WHERE user_id = ?',
                [selectedLang, userName, userId]
            );
        } catch (error) {
            console.error('Error updating user language:', error);
        }

        let response = 'Language set to English 🇬🇧';
        if (selectedLang === 'cn') {
            response = '语言已切换为中文 🇨🇳';
        }
        bot.editMessageText(response, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id
        }).catch(console.error);
    }
});

// -----------------------------------------------------------------------------
// 9. Handle "Image" - Example placeholder
// -----------------------------------------------------------------------------
async function handleImagePrompt(chatId) {
    // If using DALL·E or stable diffusion calls, implement here
    if (!openai) {
        bot.sendMessage(chatId, 'No OpenAI API key configured, cannot generate images.');
        return;
    }
    bot.sendMessage(chatId, 'Image prompt placeholder. Implement with OpenAI Image Generation if desired.');
}

// -----------------------------------------------------------------------------
// 10. Handle OpenAI Chat completions (example usage)
// -----------------------------------------------------------------------------
async function handleOpenAIPrompt(chatId, userMsg) {
    try {
        // A basic usage example for Chat Completions (GPT-3.5+)
        const response = await openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: userMsg }
            ],
            max_tokens: Math.min(MAX_TOKEN, 1500),
            temperature: 0.7
        });

        const answer = response.data.choices?.[0]?.message?.content || '(No response)';
        bot.sendMessage(chatId, answer);
    } catch (error) {
        console.error('OpenAI ChatCompletion error:', error);
        bot.sendMessage(chatId, 'Error generating AI response. Please try again.');
    }
}

// -----------------------------------------------------------------------------
// 11. Polling & Error Handling
// -----------------------------------------------------------------------------
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// -----------------------------------------------------------------------------
// Application starts here
// -----------------------------------------------------------------------------
(async () => {
    await initDB();
    console.log(`Node.js Telegram bot is running. Press Ctrl+C to stop.`);
})();
