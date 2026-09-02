// ============================================================
//  TWITCH EVENTSUB — ПОДКЛЮЧЕНИЕ И ОБРАБОТКА СОБЫТИЙ
// ============================================================

import WebSocket from 'ws';
import { config } from './config.js';
import { handleChatMessage } from './chat-handler.js';

let ws = null;
let sessionId = null;
let reconnectTimeout = null;
let isConnected = false;

// Функция обновления токена
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
            config.accessToken = data.access_token;
            console.log('✅ Токен обновлён');
            return data.access_token;
        }
        throw new Error('Не удалось обновить токен');
    } catch (error) {
        console.error('❌ Ошибка обновления токена:', error);
        return null;
    }
}

// Подписка на события
async function subscribeToEvents(token) {
    const subscriptions = [
        {
            type: 'channel.chat.message',
            version: '1',
            condition: {
                broadcaster_user_id: config.broadcasterId,
                user_id: config.botUserId,
            },
        },
        {
            type: 'stream.online',
            version: '1',
            condition: {
                broadcaster_user_id: config.broadcasterId,
            },
        },
        // Раскомментируйте для работы с баллами канала
        // {
        //     type: 'channel.channel_points_custom_reward_redemption.add',
        //     version: '1',
        //     condition: {
        //         broadcaster_user_id: config.broadcasterId,
        //     },
        // },
    ];

    for (const sub of subscriptions) {
        try {
            const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': config.clientId,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ...sub,
                    transport: {
                        method: 'websocket',
                        session_id: sessionId,
                    },
                }),
            });

            if (response.status === 202) {
                console.log(`✅ Подписка на ${sub.type} создана`);
            } else {
                const error = await response.json();
                console.warn(`⚠️ Ошибка подписки на ${sub.type}:`, error);
            }
        } catch (error) {
            console.error(`❌ Ошибка подписки на ${sub.type}:`, error);
        }
    }
}

// Обработка входящих сообщений
function handleMessage(data) {
    const message = JSON.parse(data.toString());

    // Приветствие от сервера
    if (message.metadata?.message_type === 'session_welcome') {
        sessionId = message.payload.session.id;
        console.log(`🔌 Сессия установлена: ${sessionId}`);
        
        // Подписываемся на события
        subscribeToEvents(config.accessToken);
        return;
    }

    // Обработка уведомлений
    if (message.metadata?.message_type === 'notification') {
        const event = message.payload.event;
        const subType = message.metadata.subscription_type;

        switch (subType) {
            case 'channel.chat.message':
                handleChatMessage(event);
                break;
            
            case 'stream.online':
                console.log(`🟢 Стрим начался!`);
                // Здесь можно сбросить состояние розыгрыша
                break;

            case 'channel.channel_points_custom_reward_redemption.add':
                console.log(`🎯 Покупка за баллы: ${event.user_name}`, event);
                // Здесь обработка баллов
                break;

            default:
                console.log(`📨 Событие: ${subType}`, event);
        }
        return;
    }

    // Ошибки
    if (message.metadata?.message_type === 'session_reconnect') {
        console.log('🔄 Сервер просит переподключиться');
        reconnect();
        return;
    }

    if (message.metadata?.message_type === 'session_keepalive') {
        // Пинг от сервера, ничего не делаем
        return;
    }

    console.log('📨 Получено:', message);
}

// Подключение к WebSocket
function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('⚠️ Соединение уже активно');
        return;
    }

    console.log('🔌 Подключение к Twitch EventSub...');
    ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

    ws.on('open', () => {
        isConnected = true;
        console.log('✅ WebSocket подключён');
    });

    ws.on('message', handleMessage);

    ws.on('close', (code, reason) => {
        isConnected = false;
        console.log(`🔌 Соединение закрыто: ${code} ${reason}`);
        // Переподключаемся через 5 секунд
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connect, 5000);
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket ошибка:', error);
    });
}

// Переподключение
function reconnect() {
    if (ws) {
        try { ws.close(); } catch (e) {}
        ws = null;
    }
    sessionId = null;
    connect();
}

// Остановка
function disconnect() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    if (ws) {
        try { ws.close(); } catch (e) {}
        ws = null;
    }
    isConnected = false;
    console.log('🔌 Отключено');
}

// Запуск
export function startEventSub() {
    // Проверяем настройки
    if (!config.clientId || config.clientId === 'ВАШ_CLIENT_ID') {
        console.error('❌ Ошибка: заполните clientId в twitch/config.js');
        return;
    }
    if (!config.accessToken || config.accessToken === 'ВАШ_ACCESS_TOKEN') {
        console.error('❌ Ошибка: заполните accessToken в twitch/config.js');
        return;
    }
    if (!config.broadcasterId || config.broadcasterId === 'ID_КАНАЛА') {
        console.error('❌ Ошибка: заполните broadcasterId в twitch/config.js');
        return;
    }

    console.log('🚀 Запуск Twitch EventSub...');
    connect();
}

export { disconnect, isConnected };
