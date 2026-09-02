// ============================================================
//  НАСТРОЙКИ TWITCH
//  Замените значения на свои!
// ============================================================

export const config = {
    // Данные приложения из Twitch Developer Console
    clientId: '6r23dqsif3hfl3tnta192qhka2cns1',
    clientSecret: '1nfn6kmlfla3vo8tifg1zlrrgrgbg0',

    // Токены (получить через twitchtokengenerator.com)
    accessToken: 'qj4gtiivbtamw9nvd79ylzt7n4ulwj',
    refreshToken: 'h81xvs074f592o1pkpc6958gfsvpsjdfoxva7sg8052felgs8d',

    // ID канала и бота (можно найти через https://twitchinsights.net/tools/userid)
    broadcasterId: '1525586307',
    botUserId: '1525586307',

    botUsername: 'naburov',
    channelName: 'naburov',

    // Настройки розыгрыша
    keyword: 'Голда',          // Ключевое слово по умолчанию
    cooldown: 5,              // Секунд между сообщениями от одного пользователя
    
    // Количество баллов канала за участие (если используете баллы)
    pointsCost: 0,
    vercelUrl: 'https://stream-helper-psi.vercel.app',
};
