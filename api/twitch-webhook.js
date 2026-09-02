// api/twitch-webhook.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
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
                message: 'Twitch webhook endpoint is working'
            });
        }

        if (req.method === 'POST') {
            const body = req.body;
            
            if (body.action === 'set_connected') {
                await redis.set('twitch_webhook_registered', 'true');
                return res.status(200).json({ success: true, connected: true });
            }

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('❌ Ошибка:', error);
        return res.status(500).json({ error: error.message });
    }
}
