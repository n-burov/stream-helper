// api/twitch-webhook.js
import { Redis } from '@upstash/redis';
import { config } from '../twitch/config.js';
import crypto from 'crypto';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// ============================================================
//  ПРОВЕРКА ПОДПИСИ TWITCH (для безопасности)
// ============================================================

function verifyTwitchSignature(req) {
    const signature = req.headers['twitch-eventsub-message-signature'];
    const timestamp = req.headers['twitch-eventsub-message-timestamp'];
    const messageId = req.headers['twitch-eventsub-message-id'];
    
    if (!signature || !timestamp) return false;
    
    try {
        const secret = config.clientSecret;
        const signedContent = messageId + timestamp + JSON.stringify(req.body);
        const computedSignature = crypto
            .createHmac('sha256', secret)
            .update(signedContent)
            .digest('hex');
        
        return signature === `sha256=${computedSignature}`;
    } catch (error) {
        console.error('❌ Ошибка проверки подписи:', error);
        return false;
    }
}

// ============================================================
//  ОБРАБОТКА СООБЩЕНИЙ ИЗ ЧАТА
// ============================================================

async function handleChatMessage(event) {
    const userName = event.chatter_user_name || event.user_name;
    const messageText = event.message?.text || '';
    const broadcasterId = event.broadcaster_user_id;

    console.log(`💬 [${userName}]: ${messageText}`);

    // Проверяем активен ли розыгрыш
    const isActive = await redis.get('twitch_raffle_active') === 'true';
    if (!isActive) {
        console.log('⏸️ Розыгрыш неактивен, пропускаем');
        return;
    }

    // Получаем ключевое слово
    const keyword = await redis.get('twitch_keyword') || 'Голда';
    const keywordLower = keyword.toLowerCase();

    // Проверяем ключевое слово
    if (!messageText.toLowerCase().includes(keywordLower)) {
        return;
    }

    // Проверяем кулдаун (защита от спама)
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
        try {
            participants = JSON.parse(participants);
        } catch {
            participants = [];
        }
    }

    if (!participants.includes(userName)) {
        participants.push(userName);
        await redis.set(participantsKey, JSON.stringify(participants));
        console.log(`✅ ${userName} добавлен в розыгрыш! (Всего: ${participants.length})`);
        
        // Отправляем уведомление в winner-канал для оверлея (опционально)
        // Можно отправить событие "новый участник" если нужно
    } else {
        console.log(`👤 ${userName} уже участвует`);
    }
}

// ============================================================
//  ОБРАБОТКА ПОДТВЕРЖДЕНИЯ ПОДПИСКИ
// ============================================================

async function handleChallenge(req) {
    const challenge = req.body.challenge;
    if (challenge) {
        console.log('✅ Подписка подтверждена');
        return challenge;
    }
    return null;
}

// ============================================================
//  ОБРАБОТКА ПОДПИСКИ НА СОБЫТИЯ
// ============================================================

async function subscribeToEvents() {
    const token = await refreshAccessToken();
    if (!token) {
        console.error('❌ Не удалось получить токен для подписки');
        return false;
    }

    const subscriptions = [
        {
            type: 'channel.chat.message',
            version: '1',
            condition: {
                broadcaster_user_id: config.broadcasterId,
                user_id: config.botUserId,
            },
            transport: {
                method: 'webhook',
                callback: `${process.env.VERCEL_URL || 'https://stream-helper-psi.vercel.app'}/api/twitch-webhook`,
                secret: config.clientSecret,
            },
        },
        {
            type: 'stream.online',
            version: '1',
            condition: {
                broadcaster_user_id: config.broadcasterId,
            },
            transport: {
                method: 'webhook',
                callback: `${process.env.VERCEL_URL || 'https://stream-helper-psi.vercel.app'}/api/twitch-webhook`,
                secret: config.clientSecret,
            },
        },
    ];

    let allSuccess = true;

    for (const sub of subscriptions) {
        try {
            // Проверяем, есть ли уже такая подписка
            const existing = await fetch(
                `https://api.twitch.tv/helix/eventsub/subscriptions?type=${sub.type}&condition.broadcaster_user_id=${config.broadcasterId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Client-Id': config.clientId,
                    }
                }
            );
            const existingData = await existing.json();
            
            if (existingData.data && existingData.data.length > 0) {
                console.log(`ℹ️ Подписка на ${sub.type} уже существует`);
                continue;
            }

            const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': config.clientId,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(sub),
            });

            if (response.status === 202) {
                console.log(`✅ Подписка на ${sub.type} создана`);
            } else {
                const error = await response.text();
                console.warn(`⚠️ Ошибка подписки на ${sub.type}:`, error);
                allSuccess = false;
            }
        } catch (error) {
            console.error(`❌ Ошибка подписки на ${sub.type}:`, error);
            allSuccess = false;
        }
    }

    return allSuccess;
}

// ============================================================
//  ОБНОВЛЕНИЕ ТОКЕНА
// ============================================================

async function refreshAccessToken() {
    try {
        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                refresh_token: config.refreshToken,
                grant_type: 'refresh_token',
            }),
        });
        const data = await response.json();
        if (data.access_token) {
            console.log('✅ Токен обновлён');
            return data.access_token;
        }
        throw new Error('Не удалось обновить токен');
    } catch (error) {
        console.error('❌ Ошибка обновления токена:', error);
        return null;
    }
}

// ============================================================
//  ОСНОВНОЙ ОБРАБОТЧИК
// ============================================================

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Twitch-Eventsub-Message-Signature, Twitch-Eventsub-Message-Timestamp, Twitch-Eventsub-Message-Id');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // GET запрос — для подписки (challenge)
    if (req.method === 'GET') {
        // Инициализация подписок при GET запросе с параметром subscribe
        if (req.query.subscribe === 'true') {
            const result = await subscribeToEvents();
            return res.status(200).json({ 
                success: result,
                message: result ? 'Подписки созданы' : 'Ошибка при создании подписок'
            });
        }
        
        // Статус
        if (req.query.status === 'true') {
            const isActive = await redis.get('twitch_raffle_active') === 'true';
            const keyword = await redis.get('twitch_keyword') || 'Голда';
            const participants = await redis.get('twitch_participants') || [];
            return res.status(200).json({ 
                active: isActive, 
                keyword, 
                participants: typeof participants === 'string' ? JSON.parse(participants) : participants,
                connected: true
            });
        }

        // Только для проверки работы эндпоинта
        return res.status(200).json({ 
            status: 'ok', 
            message: 'Twitch webhook endpoint is working',
            endpoints: {
                subscribe: '/api/twitch-webhook?subscribe=true',
                status: '/api/twitch-webhook?status=true'
            }
        });
    }

    // POST запрос — уведомления от Twitch
    if (req.method === 'POST') {
        try {
            const body = req.body;
            const messageType = req.headers['twitch-eventsub-message-type'];

            // Проверка подписи (для безопасности)
            // if (!verifyTwitchSignature(req)) {
            //     console.warn('⚠️ Неверная подпись Twitch');
            //     return res.status(401).json({ error: 'Invalid signature' });
            // }

            // Обработка challenge (подтверждение подписки)
            if (messageType === 'webhook_callback_verification') {
                const challenge = body.challenge;
                console.log('✅ Подписка подтверждена');
                return res.status(200).send(challenge);
            }

            // Обработка уведомлений
            if (messageType === 'notification') {
                const event = body.event;
                const subType = body.subscription?.type;

                console.log(`📨 Получено событие: ${subType}`);

                switch (subType) {
                    case 'channel.chat.message':
                        await handleChatMessage(event);
                        break;

                    case 'stream.online':
                        console.log(`🟢 Стрим начался!`);
                        // Можно сбросить состояние или сделать что-то ещё
                        break;

                    default:
                        console.log(`📨 Неизвестное событие:`, body);
                }

                return res.status(200).json({ success: true });
            }

            // Revocation — подписка отозвана
            if (messageType === 'revocation') {
                console.log('🔴 Подписка отозвана:', body);
                return res.status(200).json({ success: true });
            }

            console.log('📨 Неизвестный тип сообщения:', messageType);
            return res.status(200).json({ success: true });

        } catch (error) {
            console.error('❌ Ошибка обработки webhook:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    res.status(405).json({ error: 'Method not allowed' });
}
