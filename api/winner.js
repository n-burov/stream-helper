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

  // ===== POST =====
  if (req.method === 'POST') {
    try {
      const data = req.body;
      if (!data || !data.name) {
        return res.status(400).json({ error: 'name is required' });
      }
      // Сохраняем все данные: name, icon, color, subtitle, tag, emoji, title
      await redis.set('winner', JSON.stringify(data));
      console.log('🏆 Победитель сохранён:', data.name);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('❌ POST winner ошибка:', error);
      return res.status(500).json({ error: 'Redis error', message: error.message });
    }
  }

  // ===== GET =====
  if (req.method === 'GET') {
    try {
      const raw = await redis.get('winner');

      if (!raw) {
        return res.status(200).json({});
      }

      let data;
      if (typeof raw === 'string') {
        data = JSON.parse(raw);
      } else {
        data = raw;
      }

      await redis.del('winner');

      return res.status(200).json(data);
    } catch (error) {
      console.error('❌ GET winner ошибка:', error);
      return res.status(500).json({ error: 'Redis error', message: error.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
