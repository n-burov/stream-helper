// api/twitch-webhook.js
import { Redis } from '@upstash/redis';
import { config } from '../twitch/config.js';
import crypto from 'crypto';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

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

async function handleChatMessage(event) {
    const userName = event.chatter_user_name || event.user_name;
    const messageText = event.message?.text || '';

    console.log(`💬 [${userName}]: ${messageText}`);

    const isActive = await redis.get('twitch_raffle_active') === 'true';
    if (!isActive) {
        console.log('⏸️ Розыгрыш неактивен, пропускаем');
        return;
    }

    const keyword = await redis.get('twitch_keyword') || 'Голда';
    const keywordLower = keyword.toLowerCase();

    if (!messageText.toLowerCase().includes(keywordLower)) {
        return;
    }

    const cooldownKey = `twitch_cooldown_${userName}`;
    const lastMessage = await redis.get(cooldownKey);
    const now = Date.now();
    const cooldownSeconds = parseInt(await redis.get('twitch_cooldown') || '5');

    if (lastMessage && (now - parseInt(lastMessage)) < cooldownSeconds * 1000) {
        console.log(`⏳ ${userName} слишком часто (кулдаун)`);
        return;
    }
    await redis.set(cooldownKey, now.toString(), { ex: cooldownSeconds });

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
    } else {
        console.log(`👤 ${userName} уже участвует`);
    }
}

async function refreshAccessToken() {
    try {
        console.log('🔄 Обновляем User Access Token...');
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
            console.log('✅ User Access Token обновлён');
            return data.access_token;
        }
        console.error('❌ Ошибка обновления User Access Token:', data);
        return null;
    } catch (error) {
        console.error('❌ Ошибка обновления User Access Token:', error);
        return null;
    }
}

async function getAppAccessToken() {
    try {
        console.log('🔄 Получаем App Access Token...');
        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                grant_type: 'client_credentials',
            }),
        });
        const data = await response.json();
        if (data.access_token) {
            console.log('✅ App Access Token получен');
            return data.access_token;
        }
        console.error('❌ Ошибка получения App Access Token:', data);
        return null;
    } catch (error) {
        console.error('❌ Ошибка получения App Access Token:', error);
        return null;
    }
}

async function subscribeToEvents() {
    console.log('🚀 Начинаем создание подписок...');
    console.log(`📡 Client ID: ${config.clientId}`);
    console.log(`📡 Broadcaster ID: ${config.broadcasterId}`);
    console.log(`📡 Bot User ID: ${config.botUserId}`);
    console.log(`📡 Callback URL: ${config.vercelUrl}/api/twitch-webhook`);

    const appToken = await getAppAccessToken();
    if (!appToken) {
        console.error('❌ Не удалось получить App Access Token');
        return false;
    }
    console.log('✅ App Access Token получен');

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
                callback: `${config.vercelUrl}/api/twitch-webhook`,
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
                callback: `${config.vercelUrl}/api/twitch-webhook`,
                secret: config.clientSecret,
            },
        },
    ];

    let allSuccess = true;

    for (const sub of subscriptions) {
        console.log(`📝 Создаём подписку на ${sub.type}...`);

        try {
            const existing = await fetch(
                `https://api.twitch.tv/helix/eventsub/subscriptions?type=${sub.type}&condition.broadcaster_user_id=${config.broadcasterId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${appToken}`,
                        'Client-Id': config.clientId,
                    }
                }
            );
            const existingData = await existing.json();
            
            if (existingData.data && existingData.data.length > 0) {
                console.log(`ℹ️ Подписка на ${sub.type} уже существует, пропускаем`);
                continue;
            }

            console.log(`📤 Отправляем запрос на создание подписки ${sub.type}...`);
            
            const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${appToken}`,
                    'Client-Id': config.clientId,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(sub),
            });

            const responseText = await response.text();

            if (response.status === 202) {
                console.log(`✅ Подписка на ${sub.type} создана успешно`);
            } else {
                let errorJson;
                try {
                    errorJson = JSON.parse(responseText);
                } catch {
                    errorJson = { error: responseText };
                }
                console.error(`❌ Ошибка подписки на ${sub.type}:`);
                console.error(`   Статус: ${response.status}`);
                console.error(`   Ответ:`, errorJson);
                allSuccess = false;
            }
        } catch (error) {
            console.error(`❌ Исключение при подписке на ${sub.type}:`, error);
            allSuccess = false;
        }
    }

    if (allSuccess) {
        console.log('✅ Все подписки созданы успешно!');
    } else {
        console.error('❌ Некоторые подписки не созданы');
    }

    return allSuccess;
}

async function deleteAllSubscriptions() {
    console.log('🗑️ Удаляем все подписки...');
    const appToken = await getAppAccessToken();
    if (!appToken) {
        console.error('❌ Не удалось получить App Access Token');
        return false;
    }

    try {
        const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
            headers: {
                'Authorization': `Bearer ${appToken}`,
                'Client-Id': config.clientId,
            }
        });
        const data = await response.json();
        
        if (!data.data || data.data.length === 0) {
            console.log('ℹ️ Нет активных подписок');
            return true;
        }

        console.log(`📋 Найдено ${data.data.length} подписок`);

        for (const sub of data.data) {
            const id = sub.id;
            console.log(`🗑️ Удаляем подписку ${id} (${sub.type})...`);
            const deleteResponse = await fetch(
                `https://api.twitch.tv/helix/eventsub/subscriptions?id=${id}`,
                {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${appToken}`,
                        'Client-Id': config.clientId,
                    }
                }
            );
            if (deleteResponse.status === 204) {
                console.log(`✅ Подписка ${id} удалена`);
            } else {
                console.warn(`⚠️ Ошибка удаления подписки ${id}: ${deleteResponse.status}`);
            }
        }

        await redis.del('twitch_webhook_registered');
        console.log('✅ Все подписки удалены');
        return true;
    } catch (error) {
        console.error('❌ Ошибка удаления подписок:', error);
        return false;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Twitch-Eventsub-Message-Signature, Twitch-Eventsub-Message-Timestamp, Twitch-Eventsub-Message-Id');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        if (req.query.delete === 'true') {
            const result = await deleteAllSubscriptions();
            return res.status(200).json({ 
                success: result,
                message: result ? 'Все подписки удалены' : 'Ошибка при удалении подписок'
            });
        }

        if (req.query.subscribe === 'true') {
            const result = await subscribeToEvents();
            return res.status(200).json({ 
                success: result,
                message: result ? 'Подписки созданы' : 'Ошибка при создании подписок'
            });
        }
        
        if (req.query.status === 'true') {
            const isActive = await redis.get('twitch_raffle_active') === 'true';
            const keyword = await redis.get('twitch_keyword') || 'Голда';
            const participantsRaw = await redis.get('twitch_participants') || [];
            let participants = participantsRaw;
            if (typeof participants === 'string') {
                try { participants = JSON.parse(participants); } catch { participants = []; }
            }
            const webhookRegistered = await redis.get('twitch_webhook_registered') === 'true';
            return res.status(200).json({ 
                active: isActive, 
                keyword, 
                participants,
                connected: webhookRegistered
            });
        }

        if (req.query.set_connected === 'true') {
            await redis.set('twitch_webhook_registered', 'true');
            return res.status(200).json({ success: true, connected: true });
        }

        return res.status(200).json({ 
            status: 'ok', 
            message: 'Twitch webhook endpoint is working',
            endpoints: {
                subscribe: '/api/twitch-webhook?subscribe=true',
                delete: '/api/twitch-webhook?delete=true',
                status: '/api/twitch-webhook?status=true',
                set_connected: '/api/twitch-webhook?set_connected=true'
            }
        });
    }

    if (req.method === 'POST') {
        try {
            const body = req.body;
            
            if (body.action === 'set_connected') {
                await redis.set('twitch_webhook_registered', 'true');
                return res.status(200).json({ success: true, connected: true });
            }

            const messageType = req.headers['twitch-eventsub-message-type'];

            if (messageType === 'webhook_callback_verification') {
                const challenge = body.challenge;
                console.log('✅ Подписка подтверждена');
                await redis.set('twitch_webhook_registered', 'true');
                return res.status(200).send(challenge);
            }

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
                        break;

                    default:
                        console.log(`📨 Неизвестное событие:`, body);
                }

                return res.status(200).json({ success: true });
            }

            if (messageType === 'revocation') {
                console.log('🔴 Подписка отозвана:', body);
                await redis.del('twitch_webhook_registered');
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
