// api/verify.js
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false });
  }

  const token = authHeader.substring(7);
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).json({ valid: false });
  }

  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [, password] = decoded.split(':');
    if (password === adminPassword) {
      return res.status(200).json({ valid: true });
    }
  } catch (e) {
    // игнорируем
  }

  return res.status(401).json({ valid: false });
}
