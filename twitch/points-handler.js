// ============================================================
//  ОБРАБОТКА ПОКУПОК ЗА БАЛЛЫ КАНАЛА
// ============================================================

import { config } from './config.js';

// Карта соответствия ID награды -> действие
const rewardActions = new Map();

// Регистрация награды
export function registerReward(rewardId, action, params = {}) {
    rewardActions.set(rewardId, { action, params });
    console.log(`🎯 Зарегистрирована награда ${rewardId}: ${action}`);
}

// Обработка покупки
export function handlePointsRedemption(event) {
    const rewardId = event.reward.id;
    const userName = event.user_name;
    const userInput = event.user_input || '';

    const action = rewardActions.get(rewardId);
    if (!action) {
        console.log(`ℹ️ Неизвестная награда: ${rewardId}`);
        return;
    }

    console.log(`🎯 ${userName} активировал награду ${rewardId}: ${userInput}`);

    // Выполняем действие
    switch (action.action) {
        case 'add_participant':
            // Добавляем участника в розыгрыш
            // import { addParticipant } from './chat-handler.js';
            // addParticipant(userName);
            console.log(`✅ ${userName} добавлен в розыгрыш через баллы`);
            break;

        case 'add_ticket':
            // Добавляем дополнительные билеты
            console.log(`🎫 ${userName} получил дополнительные билеты`);
            break;

        default:
            console.log(`⚠️ Неизвестное действие: ${action.action}`);
    }
}
