// api/auth.js
export default function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    console.error('❌ ADMIN_PASSWORD не задан в Environment Variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (password === adminPassword) {
    // Генерируем простой токен (можно усложнить позже)
    const token = Buffer.from(`${Date.now()}:${password}`).toString('base64');
    return res.status(200).json({ success: true, token });
  }

  return res.status(401).json({ success: false, error: 'Неверный пароль' });
}
