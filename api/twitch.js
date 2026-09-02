// api/twitch.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// Функции для работы с Redis
async function getRaffleStatus() {
    const active = await redis.get('twitch_raffle_active') === 'true';
    const keyword = await redis.get('twitch_keyword') || 'Голда';
    const participants = await redis.get('twitch_participants') || [];
    return { active, keyword, participants };
}

async function startRaffle(keyword) {
    await redis.set('twitch_raffle_active', 'true');
    await redis.set('twitch_keyword', keyword);
    await redis.del('twitch_participants');
    console.log(`🎯 Розыгрыш запущен с ключевым словом: ${keyword}`);
}

async function stopRaffle() {
    await redis.set('twitch_raffle_active', 'false');
    console.log('⏹️ Розыгрыш остановлен');
}

async function resetRaffle() {
    await redis.del('twitch_raffle_active');
    await redis.del('twitch_keyword');
    await redis.del('twitch_participants');
    console.log('🔄 Розыгрыш сброшен');
}

async function addParticipant(username) {
    const participants = await redis.get('twitch_participants') || [];
    if (!participants.includes(username)) {
        participants.push(username);
        await redis.set('twitch_participants', participants);
        console.log(`✅ ${username} добавлен в розыгрыш`);
        return true;
    }
    return false;
}

async function drawWinner() {
    const participants = await redis.get('twitch_participants') || [];
    if (participants.length === 0) return null;
    const winner = participants[Math.floor(Math.random() * participants.length)];
    await redis.del('twitch_participants');
    await redis.set('twitch_raffle_active', 'false');
    return winner;
}

export default async function handler(req, res) {
    // CORS заголовки
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action } = req.query;

    try {
        switch (action) {
            case 'status':
                const status = await getRaffleStatus();
                // Проверяем, запущен ли EventSub (заглушка, нужно будет добавить реальную проверку)
                const connected = await redis.get('twitch_connected') === 'true';
                return res.status(200).json({ 
                    ...status, 
                    connected: connected || false 
                });

            case 'start':
                const { keyword } = req.body;
                if (!keyword) {
                    return res.status(400).json({ error: 'keyword is required' });
                }
                await startRaffle(keyword);
                return res.status(200).json({ success: true });

            case 'stop':
                await stopRaffle();
                return res.status(200).json({ success: true });

            case 'reset':
                await resetRaffle();
                return res.status(200).json({ success: true });

            case 'draw':
                const winner = await drawWinner();
                if (winner) {
                    return res.status(200).json({ winner });
                } else {
                    return res.status(400).json({ error: 'No participants' });
                }

            case 'add':
                const { username } = req.body;
                if (!username) {
                    return res.status(400).json({ error: 'username is required' });
                }
                const added = await addParticipant(username);
                return res.status(200).json({ success: added });

            case 'participants':
                const participants = await redis.get('twitch_participants') || [];
                return res.status(200).json({ participants });

            default:
                return res.status(400).json({ error: 'Unknown action' });
        }
    } catch (error) {
        console.error('❌ Ошибка API:', error);
        return res.status(500).json({ error: error.message });
    }
}
