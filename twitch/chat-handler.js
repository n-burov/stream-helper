// ============================================================
//  ОБРАБОТКА СООБЩЕНИЙ ИЗ ЧАТА
// ============================================================

import { config } from './config.js';

// Хранилище участников (в памяти, для продакшена лучше использовать Redis или БД)
const participants = new Map();
let isRaffleActive = false;
let currentKeyword = config.keyword;

// Таймауты для защиты от спама (user -> timestamp)
const messageTimestamps = new Map();

// Получить список участников
export function getParticipants() {
    return Array.from(participants.keys());
}

// Очистить список участников
export function clearParticipants() {
    participants.clear();
    console.log('🧹 Список участников очищен');
}

// Активировать/деактивировать розыгрыш
export function setRaffleActive(active) {
    isRaffleActive = active;
    if (!active) {
        // При остановке розыгрыша можно очистить участников или оставить
        // clearParticipants();
    }
    console.log(`🎯 Розыгрыш ${active ? 'активирован' : 'остановлен'}`);
}

// Изменить ключевое слово
export function setKeyword(keyword) {
    currentKeyword = keyword.trim().toLowerCase();
    console.log(`🔑 Ключевое слово изменено: ${currentKeyword}`);
}

// Основная функция обработки сообщения
export function handleChatMessage(event) {
    const userName = event.chatter_user_name || event.user_name;
    const messageText = event.message?.text || '';

    // Проверяем, активен ли розыгрыш
    if (!isRaffleActive) return;

    // Проверяем ключевое слово (регистронезависимо)
    const messageLower = messageText.toLowerCase();
    const keywordLower = currentKeyword.toLowerCase();

    if (!messageLower.includes(keywordLower)) return;

    // Проверяем кулдаун (защита от спама)
    const now = Date.now();
    const lastMessage = messageTimestamps.get(userName) || 0;
    if (now - lastMessage < (config.cooldown || 5) * 1000) {
        console.log(`⏳ ${userName} слишком часто (кулдаун)`);
        return;
    }
    messageTimestamps.set(userName, now);

    // Добавляем участника (если ещё не участвует)
    if (!participants.has(userName)) {
        participants.set(userName, {
            name: userName,
            tickets: 1,
            joinedAt: new Date().toISOString(),
        });
        console.log(`✅ ${userName} участвует в розыгрыше! (Всего: ${participants.size})`);
        
        // Можно отправить ответ в чат (если есть права chat:edit)
        // sendChatMessage(`@${userName}, ты участвуешь в розыгрыше! 🎉`);
    } else {
        // Если уже участвует — можно увеличить количество билетов
        const user = participants.get(userName);
        user.tickets += 1;
        participants.set(userName, user);
        console.log(`🎫 ${userName} получил дополнительный билет! (Всего: ${user.tickets})`);
    }
}

// Выбор победителя
export function drawWinner() {
    if (participants.size === 0) {
        console.log('⚠️ Нет участников для розыгрыша');
        return null;
    }

    // Создаём массив билетов (каждый участник = его количество билетов)
    const ticketPool = [];
    for (const [name, data] of participants) {
        for (let i = 0; i < data.tickets; i++) {
            ticketPool.push(name);
        }
    }

    // Случайный выбор
    const winner = ticketPool[Math.floor(Math.random() * ticketPool.length)];
    console.log(`🏆 Победитель: ${winner} (из ${participants.size} участников, ${ticketPool.length} билетов)`);
    return winner;
}

// Получить статистику
export function getStats() {
    let totalTickets = 0;
    for (const [name, data] of participants) {
        totalTickets += data.tickets;
    }
    return {
        totalParticipants: participants.size,
        totalTickets: totalTickets,
        participants: Array.from(participants.entries()).map(([name, data]) => ({
            name,
            tickets: data.tickets,
        })),
    };
}
