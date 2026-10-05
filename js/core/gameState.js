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

    /**
     * 本端唯一 token（★关键修复）
     * 为什么必须有：instanceId 以前是 `inst_${Date.now()}_${n}`，两端的计数都从 1 开始、
     *   时间戳粒度又只有毫秒 → 两台机器【几乎必然生成同样的 id】✗。
     *   而本端查找卡牌是 self 优先（findCardInstance 先搜 self 再搜 opponent）✗，
     *   于是"查对方那张牌"会先命中自己同 id 的卡，表现为两个 bug：
     *     ① 对方看不到我场上的「新」标记（他渲染时读到的是他自己的卡）
     *     ② 点对方场上的卡弹出的是"自己卡"的菜单（拿到的实例其实是自己的）
     * 现在 id 里带上本端随机 token → 任何两端的 id 都不会相撞 ✓
     *   （对方发来的 id 仍原样沿用，所以两端对"同一张牌"的看法依旧一致 ✓）
     */
    const CLIENT_TOKEN = Math.random().toString(36).slice(2, 10);

    function generateInstanceId() {
        instanceIdCounter++;
        return `inst_${CLIENT_TOKEN}_${Date.now()}_${instanceIdCounter}`;
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
            // 「本回合进入战场」标记（1.2）：随从跨区进入前场时置 true，回合交替时清空
            enteredThisTurn: false,
            // ===== 控制权模型（转移控制权功能）=====
            //   owner      —— 所有者（归谁）：进墓/放逐/回库 回到所有者的区域 ✓
            //   controller —— 控制者（现在谁能操作它）：默认等于 owner；「转移」只改它 ✓
            //   origin     —— 来源标记：null | 'transfer'（被转移来的） | 'copy'（复制出来的）
            //                 → 卡面特效框用（见 css/card-origin.css）✓
            controller: owner,
            origin: null,
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

        // 说明：费用区【不做镜像】—— 对手的费用牌摆放与他看到的保持一致；
        //       前后场仍按原来的反向排列（视角翻转）
        const mirrorArray = (arr) => arr.slice().reverse();

        const cardToData = (card) => {
            if (!card) return null;
            return {
                // ★带上实例 id：两端对"同一张牌"必须用同一个标识，
                //   否则响应连锁的箭头锚点、目标名称等在本端都找不到那张牌（只能兜底到半场）
                instanceId: card.instanceId,
                cardId: card.cardId,
                faceDown: !!card.faceDown,
                active: card.active !== false,
                // ★入场标记也要同步：否则对方看不到「本回合进入战场」这个标记
                enteredThisTurn: !!card.enteredThisTurn,
                // ★控制者 / 所有者 / 来源标记也要同步：否则接收端只能靠"卡在谁半场"推断，
                //   转移控制权后两端看法会不一致 ✗
                owner: card.owner || 'self',
                controller: card.controller || card.owner || 'self',
                origin: card.origin || null,
                currentAttack: card.currentAttack ?? null,
                currentDefense: card.currentDefense ?? null,
                traits: card.traits ? [...card.traits] : [],
                customTexts: card.customTexts ? [...card.customTexts] : [],
                equippedCards: card.equippedCards ? card.equippedCards.map(ec => ({
                    instanceId: ec.instanceId,
                    cardId: ec.cardId,
                    effectText: ec.cardData?.effectText || ec.cardData?.description || ''
                })) : []
            };
        };

        return {
            health: state.health,
            frontField: mirrorArray(state.frontField).map(c => cardToData(c)),
            backField: mirrorArray(state.backField).map(c => cardToData(c)),
            costZone: state.costZone.map(c => cardToData(c)),
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

        const dataToCard = (item, zoneName) => {
            if (!item) return null;
            const inst = createCardInstance(item.cardId, player);
            // ★沿用对方发来的实例 id：让两端"同一张牌"的 instanceId 完全一致
            //   （否则箭头/目标/标记都会在本端找不到对应卡牌）
            if (item.instanceId) inst.instanceId = item.instanceId;
            inst.faceDown = !!item.faceDown;
            inst.active = item.active !== false;
            inst.enteredThisTurn = !!item.enteredThisTurn;   // 入场标记随公共状态同步
            // ★所有者 / 控制者：对方发来的字段是"以对方为 self"的视角 → 落到对手身上要左右翻转 ✓
            //   （player === 'opponent'：这份数据是对方在描述他自己那一侧；
            //     player === 'self'    ：是对方在描述我这一侧 → 视角相同，不翻转 ✓）
            const flipSide = s => {
                if (player !== 'opponent') return s;
                return s === 'self' ? 'opponent' : (s === 'opponent' ? 'self' : s);
            };
            const hasOwner = (item.owner === 'self' || item.owner === 'opponent');
            const hasController = (item.controller === 'self' || item.controller === 'opponent');
            inst.owner = hasOwner ? flipSide(item.owner) : player;
            inst.controller = hasController ? flipSide(item.controller) : inst.owner;
            inst.origin = (item.origin === 'transfer' || item.origin === 'copy') ? item.origin : null;
            // ★必须写入所在区域：卡面标记（「本回合进入战场」等）依赖 card.zone 判断 ✗
            if (zoneName) inst.zone = zoneName;
            inst.currentAttack = item.currentAttack ?? null;
            inst.currentDefense = item.currentDefense ?? null;
            inst.traits = item.traits ? [...item.traits] : [];
            inst.customTexts = item.customTexts ? [...item.customTexts] : [];
            inst.equippedCards = item.equippedCards ? item.equippedCards.map(ec => {
                const equipCard = createCardInstance(ec.cardId, player);
                if (ec.instanceId) equipCard.instanceId = ec.instanceId;
                if (ec.effectText) {
                    equipCard.cardData = { effectText: ec.effectText, description: ec.effectText };
                }
                return equipCard;
            }) : [];
            return inst;
        };

        /** 按区域批量还原对方卡牌（同时写入 zone / zoneIndex，保证卡面标记与区域逻辑一致） */
        const mapZoneCards = (arr, zoneName) => (arr || []).map((item, index) => {
            const inst = dataToCard(item, zoneName);
            if (inst) inst.zoneIndex = index;
            return inst;
        });

        /** 墓场 / 放逐只传 cardId（字符串），按 id 还原并写回区域 */
        const mapIdCards = (arr, zoneName) => (arr || []).map((cardId, index) => {
            const inst = createCardInstance(cardId, player);
            inst.zone = zoneName;
            inst.zoneIndex = index;
            return inst;
        });

        target.frontField = mapZoneCards(data.frontField, ZONE.FRONT_FIELD);
        target.backField = mapZoneCards(data.backField, ZONE.BACK_FIELD);
        target.costZone = mapZoneCards(data.costZone, ZONE.COST_ZONE);
        target.graveyard = mapIdCards(data.graveyard, ZONE.GRAVEYARD);
        target.exile = mapIdCards(data.exile, ZONE.EXILE);
        target.mainDeck = Array.from({ length: data.mainDeckCount }, () => createPlaceholderInstance(player, ZONE.MAIN_DECK));
        target.costDeck = Array.from({ length: data.costDeckCount }, () => createPlaceholderInstance(player, ZONE.COST_DECK));
        target.legendDeck = Array.from({ length: data.legendDeckCount || 0 }, () => createPlaceholderInstance(player, ZONE.LEGEND_DECK));  // 恢复传说牌库
        target.handMainCount = data.handMainCount || 0;
        target.handCostCount = data.handCostCount || 0;

        if (data.publicField) {
            gameState.publicField = mapZoneCards(data.publicField, ZONE.PUBLIC_FIELD);
        }

        if (data.personalZone) {
            target.personalZone = mapZoneCards(data.personalZone, ZONE.PERSONAL_ZONE);
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
        // 实例构造：复制卡牌 / 转移控制权等需要现场造一张新实例 ✓
        createCardInstance,
        setOpponentPublicState,
        addListener,
        notifyListeners,
    };
})(window);