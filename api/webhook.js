import { Redis } from '@upstash/redis';

// Подключаемся к Upstash Redis через переменные окружения
const redis = Redis.fromEnv();

const COMMAND_KEY = 'last_command';

export default async function handler(req, res) {
  // ===== CORS =====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ===== POST - отправить команду =====
  if (req.method === 'POST') {
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
  }

  // ===== GET - получить команду =====
  if (req.method === 'GET') {
    const raw = await redis.get(COMMAND_KEY);

    if (!raw) {
      return res.status(200).json({ action: null });
    }

    const command = JSON.parse(raw);

    // Удаляем команду после прочтения
    await redis.del(COMMAND_KEY);
    console.log('📤 Команда отправлена:', command.action);

    return res.status(200).json(command);
  }

  // ===== DELETE - удалить команду =====
  if (req.method === 'DELETE') {
    await redis.del(COMMAND_KEY);
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
