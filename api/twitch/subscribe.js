export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { clientId, accessToken, channel, webhookSecret, callbackUrl } = req.body;

    try {
        // Получаем ID пользователя
        const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${accessToken}`,
            }
        });
        const userData = await userRes.json();
        const userId = userData.data?.[0]?.id;
        if (!userId) throw new Error('Пользователь не найден');

        // Создаём подписку EventSub
        const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
            method: 'POST',
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type: 'channel.chat_message',
                version: '1',
                condition: {
                    broadcaster_user_id: userId,
                    user_id: userId,
                },
                transport: {
                    method: 'webhook',
                    callback: callbackUrl || 'https://stream-helper-psi.vercel.app/api/twitch/webhook',
                    secret: webhookSecret,
                }
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Ошибка подписки');

        res.status(200).json({ success: true, data });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
