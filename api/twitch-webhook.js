// api/twitch-webhook.js
import { twitchAPI } from '../api/twitch.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action } = req.query;

    try {
        switch (action) {
            case 'start':
                const { keyword } = req.body;
                await twitchAPI.startRaffle(keyword);
                return res.status(200).json({ success: true });

            case 'stop':
                await twitchAPI.stopRaffle();
                return res.status(200).json({ success: true });

            case 'draw':
                const winner = await twitchAPI.drawWinner();
                return res.status(200).json({ winner });

            case 'status':
                const status = await twitchAPI.getStatus();
                return res.status(200).json(status);

            case 'participants':
                const participants = await twitchAPI.getParticipants();
                return res.status(200).json({ participants });

            default:
                return res.status(400).json({ error: 'Unknown action' });
        }
    } catch (error) {
        console.error('❌ Ошибка:', error);
        return res.status(500).json({ error: error.message });
    }
}
