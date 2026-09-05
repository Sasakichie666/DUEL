// js/deckManager.js
// 卡组管理模块：支持自动保存与加载，新增传说卡组，支持系列多值识别

(function(global) {
    const DECK_CONFIG = {
        MAIN_DECK_SIZE: 30,
        MAIN_DECK_MAX_COPIES: 3,
        COST_DECK_SIZE: 20,
        COST_DECK_MAX_COPIES: Infinity,
        LEGEND_DECK_SIZE: 10,
        LEGEND_DECK_MAX_COPIES: 3,       // 新增：传说卡每种最多3张
        LEGEND_SERIES: '传说',
    };

    let mainDeck = [];
    let costDeck = [];
    let legendDeck = [];

    function getCardById(id) {
        return global.CardLibrary ? global.CardLibrary.getCardById(id) : null;
    }

    function hasSeries(card, seriesName) {
        if (!card || !card.series) return false;
        const seriesList = String(card.series).split(/[,，]/).map(s => s.trim());
        return seriesList.includes(seriesName);
    }

    function autoSaveDeck() {
        const deckData = {
            mainDeck: [...mainDeck],
            costDeck: [...costDeck],
            legendDeck: [...legendDeck],
            savedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem('savedDeck', JSON.stringify(deckData));
        } catch (e) {
            console.warn('自动保存卡组失败:', e);
        }
    }

    function addCardToMainDeck(cardId) {
        const card = getCardById(cardId);
        if (!card) return { error: '卡牌不存在' };
        if (card.type === 'cost') {
            return { error: '费用卡请添加到费用卡组' };
        }
        if (hasSeries(card, DECK_CONFIG.LEGEND_SERIES)) {
            return { error: '传说卡请添加到传说卡组' };
        }
        if (mainDeck.length >= DECK_CONFIG.MAIN_DECK_SIZE) {
            return { error: `主卡组已满（${DECK_CONFIG.MAIN_DECK_SIZE}张）` };
        }
        const copies = mainDeck.filter(id => id === cardId).length;
        if (copies >= DECK_CONFIG.MAIN_DECK_MAX_COPIES) {
            return { error: `每种卡最多${DECK_CONFIG.MAIN_DECK_MAX_COPIES}张` };
        }
        mainDeck.push(cardId);
        autoSaveDeck();
        return { success: true, cardName: card.name };
    }

    function removeCardFromMainDeck(index) {
        if (index >= 0 && index < mainDeck.length) {
            const card = getCardById(mainDeck[index]);
            mainDeck.splice(index, 1);
            autoSaveDeck();
            return { success: true, cardName: card ? card.name : '' };
        }
        return { error: '无效索引' };
    }

    function addCardToCostDeck(cardId) {
        const card = getCardById(cardId);
        if (!card || card.type !== 'cost') {
            return { error: '无效的费用卡' };
        }
        if (costDeck.length >= DECK_CONFIG.COST_DECK_SIZE) {
            return { error: `费用卡组已满（${DECK_CONFIG.COST_DECK_SIZE}张）` };
        }
        costDeck.push(cardId);
        autoSaveDeck();
        return { success: true, cardName: card.name };
    }

    function removeCardFromCostDeck(index) {
        if (index >= 0 && index < costDeck.length) {
            const card = getCardById(costDeck[index]);
            costDeck.splice(index, 1);
            autoSaveDeck();
            return { success: true, cardName: card ? card.name : '' };
        }
        return { error: '无效索引' };
    }

    function addCardToLegendDeck(cardId) {
        const card = getCardById(cardId);
        if (!card) return { error: '卡牌不存在' };
        if (!hasSeries(card, DECK_CONFIG.LEGEND_SERIES)) {
            return { error: '只有传说系列卡牌才能加入传说卡组' };
        }
        if (legendDeck.length >= DECK_CONFIG.LEGEND_DECK_SIZE) {
            return { error: `传说卡组已满（${DECK_CONFIG.LEGEND_DECK_SIZE}张）` };
        }
        const copies = legendDeck.filter(id => id === cardId).length;
        if (copies >= DECK_CONFIG.LEGEND_DECK_MAX_COPIES) {
            return { error: `每种传说卡最多${DECK_CONFIG.LEGEND_DECK_MAX_COPIES}张` };
        }
        legendDeck.push(cardId);
        autoSaveDeck();
        return { success: true, cardName: card.name };
    }

    function removeCardFromLegendDeck(index) {
        if (index >= 0 && index < legendDeck.length) {
            const card = getCardById(legendDeck[index]);
            legendDeck.splice(index, 1);
            autoSaveDeck();
            return { success: true, cardName: card ? card.name : '' };
        }
        return { error: '无效索引' };
    }

    function getLegendDeck() {
        return [...legendDeck];
    }

    function getMainDeck() {
        return [...mainDeck];
    }

    function getCostDeck() {
        return [...costDeck];
    }

    function getDeckStatus() {
        const mainOk = mainDeck.length === DECK_CONFIG.MAIN_DECK_SIZE;
        const costOk = costDeck.length === DECK_CONFIG.COST_DECK_SIZE;
        const legendOk = legendDeck.length === DECK_CONFIG.LEGEND_DECK_SIZE;
        return {
            mainCount: mainDeck.length,
            costCount: costDeck.length,
            legendCount: legendDeck.length,
            mainOk,
            costOk,
            legendOk,
            isDeckReady: mainOk && costOk && legendOk,
        };
    }

    function saveDeck() {
        const status = getDeckStatus();
        if (!status.mainOk || !status.costOk || !status.legendOk) {
            return { error: '卡组不完整，无法保存！' };
        }
        autoSaveDeck();
        return { success: true };
    }

    function loadDeck() {
        const saved = localStorage.getItem('savedDeck');
        if (!saved) {
            return { error: '没有找到已保存的卡组' };
        }
        try {
            const deckData = JSON.parse(saved);
            if (deckData.mainDeck && Array.isArray(deckData.mainDeck)) {
                mainDeck = deckData.mainDeck;
            }
            if (deckData.costDeck && Array.isArray(deckData.costDeck)) {
                costDeck = deckData.costDeck;   // 修改：不再过滤，保留所有ID
            }
            if (deckData.legendDeck && Array.isArray(deckData.legendDeck)) {
                legendDeck = deckData.legendDeck;
            }
            return { success: true };
        } catch (e) {
            return { error: '卡组数据损坏，无法加载' };
        }
    }

    function clearDeck() {
        mainDeck = [];
        costDeck = [];
        legendDeck = [];
        autoSaveDeck();
        return { success: true };
    }

    global.DeckManager = {
        DECK_CONFIG,
        hasSeries,
        addCardToMainDeck,
        removeCardFromMainDeck,
        addCardToCostDeck,
        removeCardFromCostDeck,
        addCardToLegendDeck,
        removeCardFromLegendDeck,
        getMainDeck,
        getCostDeck,
        getLegendDeck,
        getDeckStatus,
        saveDeck,
        loadDeck,
        clearDeck
    };
})(window);