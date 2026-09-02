import { Redis } from '@upstash/redis';
import { config } from '../twitch/config.js';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// Экспорт функций для управления розыгрышем
export const twitchAPI = {
    // Запуск розыгрыша
    async startRaffle(keyword) {
        await redis.set('twitch_raffle_active', 'true');
        await redis.set('twitch_keyword', keyword);
        console.log(`🎯 Розыгрыш запущен с ключевым словом: ${keyword}`);
    },

    // Остановка розыгрыша
    async stopRaffle() {
        await redis.set('twitch_raffle_active', 'false');
        console.log('⏹️ Розыгрыш остановлен');
    },

    // Добавление участника
    async addParticipant(username) {
        const participants = await redis.get('twitch_participants') || [];
        if (!participants.includes(username)) {
            participants.push(username);
            await redis.set('twitch_participants', participants);
            console.log(`✅ ${username} добавлен в розыгрыш`);
        }
    },

    // Выбор победителя
    async drawWinner() {
        const participants = await redis.get('twitch_participants') || [];
        if (participants.length === 0) return null;
        const winner = participants[Math.floor(Math.random() * participants.length)];
        await redis.del('twitch_participants');
        await redis.set('twitch_raffle_active', 'false');
        return winner;
    },

    // Получение статуса
    async getStatus() {
        const active = await redis.get('twitch_raffle_active') === 'true';
        const keyword = await redis.get('twitch_keyword') || '!лут';
        const participants = await redis.get('twitch_participants') || [];
        return { active, keyword, participants };
    }
};
