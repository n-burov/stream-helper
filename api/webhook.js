import { Redis } from '@upstash/redis';

// ===== ПРАВИЛЬНО: используем REST API URL, а не KV_URL =====
const redis = new Redis({
  url: process.env.KV_REST_API_URL,      // <- https://faithful-hound-124604.upstash.io
  token: process.env.KV_REST_API_TOKEN,   // <- gQAAAA...
});

const COMMAND_KEY = 'last_command';

export default async function handler(req, res) {
  // ===== CORS =====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ===== POST =====
  if (req.method === 'POST') {
    try {
      const { action, data } = req.body;

      if (!action) {
        return res.status(400).json({ error: 'action is required' });
      }

      const command = {
        action,
        data: data || null,
        timestamp: Date.now(),
      };

      await redis.set(COMMAND_KEY, JSON.stringify(command));
      console.log('📥 Команда сохранена:', action);

      return res.status(200).json({ success: true, action });
    } catch (error) {
      console.error('❌ POST ошибка:', error);
      return res.status(500).json({ error: 'Redis error', message: error.message });
    }
  }

  // ===== GET =====
  if (req.method === 'GET') {
    try {
      const raw = await redis.get(COMMAND_KEY);

      if (raw === null || raw === undefined) {
        return res.status(200).json({ action: null });
      }

      let command;
      if (typeof raw === 'string') {
        command = JSON.parse(raw);
      } else {
        command = raw;
      }

      await redis.del(COMMAND_KEY);
      console.log('📤 Команда отправлена:', command.action);

      return res.status(200).json(command);
    } catch (error) {
      console.error('❌ GET ошибка:', error);
      return res.status(500).json({ error: 'Redis error', message: error.message });
    }
  }

  // ===== DELETE =====
  if (req.method === 'DELETE') {
    try {
      await redis.del(COMMAND_KEY);
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: 'Redis error', message: error.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
