// js/core/gameState.js
// 纯状态容器：负责保存游戏状态、提供访问接口和监听器，不包含业务操作
// 修改：新增传说牌库 legendDeck 支持；移除标记/顺序；保留装备卡逻辑

(function(global) {
    const ZONE = {
        HAND: 'hand',
        MAIN_DECK: 'mainDeck',
        COST_DECK: 'costDeck',
        FRONT_FIELD: 'frontField',
        BACK_FIELD: 'backField',
        COST_ZONE: 'costZone',
        GRAVEYARD: 'graveyard',
        EXILE: 'exile',
        PUBLIC_FIELD: 'publicField',
        PERSONAL_ZONE: 'personalZone',
        LEGEND_DECK: 'legendDeck'   // 新增传说牌库区域
    };

    const INITIAL_HAND_SIZE = 4;
    const INITIAL_COST_HAND_SIZE = 3;

    let instanceIdCounter = 0;
    let gameState = null;
    let listeners = [];

    function generateInstanceId() {
        instanceIdCounter++;
        return `inst_${Date.now()}_${instanceIdCounter}`;
    }

    function createCardInstance(cardId, owner) {
        const card = global.CardLibrary ? global.CardLibrary.getCardById(cardId) : null;
        return {
            instanceId: generateInstanceId(),
            cardId: cardId || 'unknown',
            cardData: card || null,
            owner: owner,
            zone: null,
            zoneIndex: -1,
            faceUp: true,
            faceDown: false,
            active: true,
            currentAttack: (card && card.type === 'minion') ? card.attack : null,
            currentDefense: (card && card.type === 'minion') ? card.defense : null,
            traits: [],
            customTexts: [],
            equippedCards: [],
        };
    }

    function createPlaceholderInstance(owner, zone) {
        return {
            instanceId: generateInstanceId(),
            cardId: 'placeholder',
            cardData: null,
            owner: owner,
            zone: zone,
            zoneIndex: -1,
            faceUp: false,
            faceDown: false,
            active: true,
            currentAttack: null,
            currentDefense: null,
            traits: [],
            customTexts: [],
            equippedCards: [],
        };
    }

    function createPlayerState(owner, mainDeckIds, costDeckIds, legendDeckIds = []) {
        const mainDeck = mainDeckIds.map(id => createCardInstance(id, owner));
        const costDeck = costDeckIds.map(id => createCardInstance(id, owner));
        const legendDeck = legendDeckIds.map(id => createCardInstance(id, owner));

        mainDeck.forEach(card => { card.zone = ZONE.MAIN_DECK; });
        costDeck.forEach(card => { card.zone = ZONE.COST_DECK; });
        legendDeck.forEach(card => { card.zone = ZONE.LEGEND_DECK; });

        return {
            owner: owner,
            health: 30,
            hand: [],
            frontField: new Array(5).fill(null),
            backField: new Array(5).fill(null),
            costZone: new Array(10).fill(null),
            mainDeck: mainDeck,
            costDeck: costDeck,
            legendDeck: legendDeck,     // 新增传说牌库
            graveyard: [],
            exile: [],
            personalZone: [],
            handMainCount: 0,
            handCostCount: 0,
        };
    }

    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function initGame(mainDeckIds, costDeckIds, legendDeckIds = []) {
        const shuffledMain = shuffleArray([...mainDeckIds]);
        const shuffledCost = shuffleArray([...costDeckIds]);
        const shuffledLegend = shuffleArray([...legendDeckIds]);

        gameState = {
            players: {
                self: createPlayerState('self', shuffledMain, shuffledCost, shuffledLegend),
                opponent: createPlayerState('opponent', [], [], []),
            },
            currentTurn: 'self',
            turnNumber: 1,
            phase: 'main',
            publicField: new Array(5).fill(null),
        };

        notifyListeners();
        return gameState;
    }

    function getState() {
        return gameState;
    }

    function getPlayerState(player) {
        return gameState ? gameState.players[player] : null;
    }

    function getHand(player) {
        const state = getPlayerState(player);
        return state ? state.hand : [];
    }

    function getZoneCards(player, zone, index = null) {
        const state = getPlayerState(player);
        if (!state) return null;
        if (index === null) return state[zone];
        return state[zone][index];
    }

    function getPublicState(player) {
        const state = getPlayerState(player);
        if (!state) return null;

        const mirrorArray = (arr) => arr.slice().reverse();
        const mirrorCostZone = (costZone) => {
            const rows = [costZone.slice(0,5), costZone.slice(5,10)];
            const mirrored = rows.reverse().map(row => row.reverse());
            return mirrored.flat();
        };

        const cardToData = (card) => {
            if (!card) return null;
            return {
                cardId: card.cardId,
                faceDown: !!card.faceDown,
                active: card.active !== false,
                currentAttack: card.currentAttack ?? null,
                currentDefense: card.currentDefense ?? null,
                traits: card.traits ? [...card.traits] : [],
                customTexts: card.customTexts ? [...card.customTexts] : [],
                equippedCards: card.equippedCards ? card.equippedCards.map(ec => ({
                    cardId: ec.cardId,
                    effectText: ec.cardData?.effectText || ec.cardData?.description || ''
                })) : []
            };
        };

        return {
            health: state.health,
            frontField: mirrorArray(state.frontField).map(c => cardToData(c)),
            backField: mirrorArray(state.backField).map(c => cardToData(c)),
            costZone: mirrorCostZone(state.costZone).map(c => cardToData(c)),
            mainDeckCount: state.mainDeck.length,
            costDeckCount: state.costDeck.length,
            legendDeckCount: state.legendDeck.length,   // 新增传说牌库计数
            graveyard: state.graveyard.map(c => c.cardId),
            exile: state.exile.map(c => c.cardId),
            handMainCount: state.handMainCount,
            handCostCount: state.handCostCount,
            publicField: gameState.publicField ? gameState.publicField.map(c => cardToData(c)) : new Array(5).fill(null),
            personalZone: state.personalZone.map(c => cardToData(c)),
        };
    }

    function setPublicState(player, data) {
        if (!gameState) return;
        const target = gameState.players[player];
        if (!target) return;

        target.health = data.health;

        const dataToCard = (item) => {
            if (!item) return null;
            const inst = createCardInstance(item.cardId, player);
            inst.faceDown = !!item.faceDown;
            inst.active = item.active !== false;
            inst.currentAttack = item.currentAttack ?? null;
            inst.currentDefense = item.currentDefense ?? null;
            inst.traits = item.traits ? [...item.traits] : [];
            inst.customTexts = item.customTexts ? [...item.customTexts] : [];
            inst.equippedCards = item.equippedCards ? item.equippedCards.map(ec => {
                const equipCard = createCardInstance(ec.cardId, player);
                if (ec.effectText) {
                    equipCard.cardData = { effectText: ec.effectText, description: ec.effectText };
                }
                return equipCard;
            }) : [];
            return inst;
        };

        target.frontField = data.frontField.map(item => dataToCard(item));
        target.backField = data.backField.map(item => dataToCard(item));
        target.costZone = data.costZone.map(item => dataToCard(item));
        target.graveyard = data.graveyard.map(cardId => createCardInstance(cardId, player));
        target.exile = data.exile.map(cardId => createCardInstance(cardId, player));
        target.mainDeck = Array.from({ length: data.mainDeckCount }, () => createPlaceholderInstance(player, ZONE.MAIN_DECK));
        target.costDeck = Array.from({ length: data.costDeckCount }, () => createPlaceholderInstance(player, ZONE.COST_DECK));
        target.legendDeck = Array.from({ length: data.legendDeckCount || 0 }, () => createPlaceholderInstance(player, ZONE.LEGEND_DECK));  // 恢复传说牌库
        target.handMainCount = data.handMainCount || 0;
        target.handCostCount = data.handCostCount || 0;

        if (data.publicField) {
            gameState.publicField = data.publicField.map(item => dataToCard(item));
        }

        if (data.personalZone) {
            target.personalZone = data.personalZone.map(item => dataToCard(item));
        }
    }

    function setOpponentPublicState(data) {
        setPublicState('opponent', data);
    }

    function addListener(fn) {
        listeners.push(fn);
    }

    function notifyListeners() {
        listeners.forEach(fn => fn(gameState));
    }

    global.GameState = {
        ZONE,
        INITIAL_HAND_SIZE,
        INITIAL_COST_HAND_SIZE,
        initGame,
        getState,
        getPlayerState,
        getHand,
        getZoneCards,
        getPublicState,
        setPublicState,
        setOpponentPublicState,
        addListener,
        notifyListeners,
    };
})(window);