// ============================================================
//  НАСТРОЙКИ TWITCH
//  Замените значения на свои!
// ============================================================

export const config = {
    // Данные приложения из Twitch Developer Console
    clientId: '6r23dqsif3hfl3tnta192qhka2cns1',
    clientSecret: '1nfn6kmlfla3vo8tifg1zlrrgrgbg0',

    // Токены (получить через twitchtokengenerator.com)
    accessToken: 'c76zdoi7mbma957udlr3canpz1dyn8',
    refreshToken: 'chcaa21yl8260mcjt29h1wax463u2xmbvnni0vucmkpja0ay8p',

    // ID канала и бота (можно найти через https://twitchinsights.net/tools/userid)
    broadcasterId: '1525586307',
    botUserId: '1525586307',

    // Настройки розыгрыша
    keyword: 'Голда',          // Ключевое слово по умолчанию
    cooldown: 5,              // Секунд между сообщениями от одного пользователя
    
    // Количество баллов канала за участие (если используете баллы)
    pointsCost: 0,
    vercelUrl: 'https://stream-helper-psi.vercel.app',
};
