// js/cards.js
(function(global) {
    const CARD_TYPES = { MINION: 'minion', TACTIC: 'tactic', COST: 'cost' };
    const LEGEND_SERIES = '传说';

    const COST_COLORS = ['red', 'blue', 'green', 'white', 'purple', 'yellow', 'cyan'];
    const COST_COLOR_NAMES = {
        red: '红色法力',
        blue: '蓝色法力',
        green: '绿色法力',
        white: '白色法力',
        purple: '紫色法力',
        yellow: '黄色法力',
        cyan: '青色法力'

    };
    const COST_COLOR_EMOJIS = {
        red: '🔥',
        blue: '💧',
        green: '🌿',
        white: '✨',
        purple: '💜',
        yellow: '💛',
        cyan: '💠'
    };

    const BUILT_IN_CARDS = [
    ];

    if (global.CardLibrary) {
        BUILT_IN_CARDS.forEach(card => {
            const result = global.CardLibrary.registerCard(card);
            if (!result.success) {
                console.warn('[cards] 注册内置卡牌失败:', card.id, result.errors);
            }
        });
        global.CardLibrary.loadCardPacks();
    }

    global.Cards = {
        CARD_TYPES,
        COST_COLORS,
        COST_COLOR_NAMES,
        COST_COLOR_EMOJIS,
        getCardsByType: (type) => global.CardLibrary.getCardsByType(type),
        getCardById: (id) => global.CardLibrary.getCardById(id),
        get ALL_CARDS() { return global.CardLibrary.getAllCards(); }
    };
})(window);