export default async function handler(req, res) {
    // Twitch отправляет GET для проверки подписки
    if (req.method === 'GET') {
        const challenge = req.query['hub.challenge'];
        if (challenge) {
            return res.status(200).send(challenge);
        }
        return res.status(400).send('No challenge');
    }

    // POST — входящее сообщение из чата
    if (req.method === 'POST') {
        // Проверка подписи (webhook secret)
        const secret = process.env.TWITCH_WEBHOOK_SECRET;
        // ... проверка HMAC-SHA256

        const event = req.body.event;
        if (event?.type === 'channel.chat_message') {
            const username = event.chatter_user_name;
            const message = event.message.text;

            console.log(`📨 EventSub: ${username}: ${message}`);

            // Здесь нужно передать данные в index.html
            // Можно через WebSocket, или сохранять в KV, или использовать Server-Sent Events
        }

        return res.status(200).send('OK');
    }

    res.status(405).end();
}
