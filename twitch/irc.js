// twitch/irc.js
import tmi from 'tmi.js';
import { Redis } from '@upstash/redis';
import { config } from './config.js';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

let client = null;

// Обработка сообщений из чата
async function handleMessage(channel, userstate, message, self) {
    if (self) return;
    
    const userName = userstate.username;
    const messageText = message;

    console.log(`💬 [${userName}]: ${messageText}`);

    // Проверяем активен ли розыгрыш
    const isActive = await redis.get('twitch_raffle_active') === 'true';
    if (!isActive) return;

    // Получаем ключевое слово
    const keyword = await redis.get('twitch_keyword') || 'Голда';
    const keywordLower = keyword.toLowerCase();

    // Проверяем ключевое слово
    if (!messageText.toLowerCase().includes(keywordLower)) return;

    // Проверяем кулдаун
    const cooldownKey = `twitch_cooldown_${userName}`;
    const lastMessage = await redis.get(cooldownKey);
    const now = Date.now();
    const cooldownSeconds = parseInt(await redis.get('twitch_cooldown') || '5');

    if (lastMessage && (now - parseInt(lastMessage)) < cooldownSeconds * 1000) {
        console.log(`⏳ ${userName} слишком часто (кулдаун)`);
        return;
    }
    await redis.set(cooldownKey, now.toString(), { ex: cooldownSeconds });

    // Добавляем участника
    const participantsKey = 'twitch_participants';
    let participants = await redis.get(participantsKey) || [];
    if (typeof participants === 'string') {
        try { participants = JSON.parse(participants); } catch { participants = []; }
    }

    if (!participants.includes(userName)) {
        participants.push(userName);
        await redis.set(participantsKey, JSON.stringify(participants));
        console.log(`✅ ${userName} добавлен в розыгрыш! (Всего: ${participants.length})`);
    } else {
        console.log(`👤 ${userName} уже участвует`);
    }
}

// Запуск IRC
export function startIRC() {
    if (client) {
        console.log('⚠️ IRC уже запущен');
        return;
    }

    console.log('🔌 Подключаемся к Twitch IRC...');

    client = new tmi.Client({
        options: { debug: false },
        connection: {
            reconnect: true,
            secure: true,
        },
        identity: {
            username: config.botUsername || 'naburov',
            password: `oauth:${config.accessToken}`,
        },
        channels: [config.channelName || 'naburov'],
    });

    client.on('message', handleMessage);

    client.connect().then(() => {
        console.log(`✅ IRC подключён к каналу ${config.channelName || 'naburov'}`);
        redis.set('twitch_irc_connected', 'true');
    }).catch((err) => {
        console.error('❌ Ошибка подключения IRC:', err);
        redis.set('twitch_irc_connected', 'false');
    });

    client.on('disconnected', () => {
        console.log('🔌 IRC отключён');
        redis.set('twitch_irc_connected', 'false');
    });
}

// Остановка IRC
export function stopIRC() {
    if (client) {
        client.disconnect();
        client = null;
        console.log('🔌 IRC остановлен');
        redis.set('twitch_irc_connected', 'false');
    }
}
