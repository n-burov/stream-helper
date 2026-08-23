import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ===== POST =====
  if (req.method === 'POST') {
    try {
      const { mechanic, data } = req.body;

      if (!mechanic || !data) {
        return res.status(400).json({ error: 'mechanic and data are required' });
      }

      const key = `${mechanic}_state`;
      await redis.set(key, JSON.stringify(data));
      console.log(`📥 Состояние ${mechanic} обновлено`);

      // Если есть победитель — отправляем его в отдельный канал для оверлея
      if (data.winner) {
        const winnerData = {
          name: data.winner,
          emoji: data.emoji || '🏆',
          title: data.title || 'ПОБЕДИТЕЛЬ!',
          subtitle: data.subtitle || '🎉 Поздравляем!',
          tag: data.tag || '🎯 Розыгрыш',
        };
        await redis.set('winner', JSON.stringify(winnerData));
        console.log('🏆 Победитель отправлен в winner-канал');
      }

      return res.status(200).json({ success: true, mechanic });
    } catch (error) {
      console.error('❌ POST ошибка:', error);
      return res.status(500).json({ error: 'Redis error', message: error.message });
    }
  }

  // ===== GET =====
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

  // ===== DELETE =====
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
