// start.js
import { startIRC, stopIRC } from './twitch/irc.js';
import { startEventSub, disconnect } from './twitch/eventsub.js';

console.log('🚀 Запуск Twitch интеграции...');
console.log('📡 IRC — для чтения чата');
console.log('📡 EventSub — для stream.online');

startIRC();

// EventSub пока отключаем, если не нужен stream.online
// startEventSub();

process.on('SIGINT', () => {
    console.log('\n👋 Завершение работы...');
    stopIRC();
    // disconnect();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Завершение работы...');
    stopIRC();
    // disconnect();
    process.exit(0);
});
