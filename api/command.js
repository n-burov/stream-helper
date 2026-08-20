// api/command.js

// Временное хранилище в памяти (глобальная переменная)
// Данные живут между вызовами в пределах одного инстанса
let lastCommand = null;

export default function handler(req, res) {
  // ===== CORS для OBS =====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ===== GET - получить команду (для оверлея) =====
  if (req.method === 'GET') {
    const command = lastCommand;
    if (command) {
      // Проверяем, не слишком ли старая команда (старше 30 секунд)
      const age = Date.now() - command.timestamp;
      if (age > 30000) {
        lastCommand = null;
        return res.status(200).json({ action: null, message: 'Команда устарела' });
      }
      
      // Возвращаем команду и удаляем (чтобы не повторялась)
      lastCommand = null;
      console.log('📤 Команда отправлена:', command.action);
      return res.status(200).json(command);
    }
    return res.status(200).json({ action: null });
  }

  // ===== POST - отправить команду (с основного сайта) =====
  if (req.method === 'POST') {
    const { action, data } = req.body;
    
    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    // Сохраняем команду с timestamp
    lastCommand = {
      action,
      data: data || null,
      timestamp: Date.now(),
    };
    
    console.log('📥 Команда сохранена:', action);
    return res.status(200).json({ 
      success: true, 
      action,
      message: 'Команда сохранена' 
    });
  }

  // ===== DELETE - удалить команду (для сброса) =====
  if (req.method === 'DELETE') {
    lastCommand = null;
    return res.status(200).json({ success: true, message: 'Команда удалена' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
