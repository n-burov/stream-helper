// api/webhook.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// ============================================================
//  ФУНКЦИИ ДЛЯ TWITCH
// ============================================================

async function getTwitchStatus() {
    const active = await redis.get('twitch_raffle_active') === 'true';
    const keyword = await redis.get('twitch_keyword') || 'Голда';
    const participants = await redis.get('twitch_participants') || [];
    const connected = await redis.get('twitch_connected') === 'true';
    return { active, keyword, participants, connected };
}

async function startRaffle(keyword) {
    await redis.set('twitch_raffle_active', 'true');
    await redis.set('twitch_keyword', keyword);
    await redis.del('twitch_participants');
    return true;
}

async function stopRaffle() {
    await redis.set('twitch_raffle_active', 'false');
    return true;
}

async function resetRaffle() {
    await redis.del('twitch_raffle_active');
    await redis.del('twitch_keyword');
    await redis.del('twitch_participants');
    return true;
}

async function drawWinner() {
    const participants = await redis.get('twitch_participants') || [];
    if (participants.length === 0) return null;
    const winner = participants[Math.floor(Math.random() * participants.length)];
    await redis.del('twitch_participants');
    await redis.set('twitch_raffle_active', 'false');
    return winner;
}

async function addParticipant(username) {
    const participants = await redis.get('twitch_participants') || [];
    if (!participants.includes(username)) {
        participants.push(username);
        await redis.set('twitch_participants', participants);
        return true;
    }
    return false;
}

// ============================================================
//  ОСНОВНОЙ ОБРАБОТЧИК
// ============================================================

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ============================================================
    //  TWITCH API (через query param ?twitch=action)
    // ============================================================
    
    if (req.query.twitch) {
        const action = req.query.twitch;
        
        try {
            switch (action) {
                case 'status':
                    const isActive = await redis.get('twitch_raffle_active') === 'true';
                    const keyword = await redis.get('twitch_keyword') || 'Голда';
                    const participantsRaw = await redis.get('twitch_participants') || [];
                    let participants = participantsRaw;
                    if (typeof participants === 'string') {
                        try { participants = JSON.parse(participants); } catch { participants = []; }
                    }
                    // Проверяем, что вебхук зарегистрирован
                    const webhookRegistered = await redis.get('twitch_webhook_registered') === 'true';
                    return res.status(200).json({ 
                        active: isActive, 
                        keyword, 
                        participants,
                        connected: webhookRegistered
                    });
    
                case 'start':
                    const { keyword: kw } = req.body;
                    if (!kw) {
                        return res.status(400).json({ error: 'keyword is required' });
                    }
                    await redis.set('twitch_raffle_active', 'true');
                    await redis.set('twitch_keyword', kw);
                    await redis.del('twitch_participants');
                    return res.status(200).json({ success: true });
    
                case 'stop':
                    await redis.set('twitch_raffle_active', 'false');
                    return res.status(200).json({ success: true });
    
                case 'reset':
                    await redis.del('twitch_raffle_active');
                    await redis.del('twitch_keyword');
                    await redis.del('twitch_participants');
                    return res.status(200).json({ success: true });
    
                case 'draw':
                    const participantsData = await redis.get('twitch_participants') || [];
                    let pList = participantsData;
                    if (typeof pList === 'string') {
                        try { pList = JSON.parse(pList); } catch { pList = []; }
                    }
                    if (pList.length === 0) {
                        return res.status(400).json({ error: 'No participants' });
                    }
                    const winner = pList[Math.floor(Math.random() * pList.length)];
                    await redis.del('twitch_participants');
                    await redis.set('twitch_raffle_active', 'false');
                    return res.status(200).json({ winner });
    
                default:
                    return res.status(400).json({ error: 'Unknown twitch action' });
            }
        } catch (error) {
            console.error('❌ Ошибка Twitch API:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // ============================================================
    //  ОСНОВНЫЕ МЕХАНИКИ (keyword, wheel, sniper, bank)
    // ============================================================

    if (req.method === 'POST') {
        try {
            const { mechanic, data } = req.body;

            if (!mechanic || !data) {
                return res.status(400).json({ error: 'mechanic and data are required' });
            }

            const key = `${mechanic}_state`;
            await redis.set(key, JSON.stringify(data));
            console.log(`📥 Состояние ${mechanic} обновлено:`, data);

            if (data.winner) {
                const winnerData = {
                    name: data.winner,
                    emoji: data.emoji || '🏆',
                    title: data.title || 'ПОБЕДИТЕЛЬ!',
                    subtitle: data.subtitle || '🎉 Поздравляем!',
                    tag: data.tag || '🎯 Розыгрыш',
                    icon: data.icon || null,
                    color: data.color || null,
                };
                await redis.set('winner', JSON.stringify(winnerData));
                console.log('🏆 Победитель отправлен в winner-канал:', data.winner);
            }

            return res.status(200).json({ success: true, mechanic });
        } catch (error) {
            console.error('❌ POST ошибка:', error);
            return res.status(500).json({ error: 'Redis error', message: error.message });
        }
    }

    if (req.method === 'GET') {
        try {
            const { mechanic } = req.query;

            if (!mechanic) {
                return res.status(400).json({ error: 'mechanic query param is required' });
            }

            const key = `${mechanic}_state`;
            const raw = await redis.get(key);

            if (!raw) {
                return res.status(200).json({ status: 'idle' });
            }

            let data;
            if (typeof raw === 'string') {
                data = JSON.parse(raw);
            } else {
                data = raw;
            }

            return res.status(200).json(data);
        } catch (error) {
            console.error('❌ GET ошибка:', error);
            return res.status(500).json({ error: 'Redis error', message: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const { mechanic } = req.query;

            if (!mechanic) {
                return res.status(400).json({ error: 'mechanic query param is required' });
            }

            const key = `${mechanic}_state`;
            await redis.del(key);
            console.log(`🗑️ Состояние ${mechanic} сброшено`);

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: 'Redis error', message: error.message });
        }
    }

    res.status(405).json({ error: 'Method not allowed' });
}
