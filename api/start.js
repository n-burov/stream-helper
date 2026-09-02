// start.js — запуск EventSub
import { startEventSub, disconnect } from './twitch/eventsub.js';

console.log('🚀 Запуск Twitch EventSub...');
startEventSub();

// Обработка завершения
process.on('SIGINT', () => {
    console.log('\n👋 Завершение работы...');
    disconnect();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Завершение работы...');
    disconnect();
    process.exit(0);
});
