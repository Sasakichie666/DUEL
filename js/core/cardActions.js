// js/core/cardActions.js
// 卡牌底层操作模块：从 gameState 迁移过来的原子操作，不包含菜单业务语义
// 修改：支持传说牌库 legendDeck 的抽牌、移回、检索、洗切；装备逻辑保持不变

(function(global) {
    const GameState = global.GameState;
    const ZoneManager = global.ZoneManager;

    function drawFromDeck(player, deckType, count = 1) {
        const state = GameState.getState();
        if (!state) return [];
        const playerState = state.players[player];
        if (!playerState) return [];

        const deck = playerState[deckType];
        const drawnCards = [];

        for (let i = 0; i < count; i++) {
            if (deck.length === 0) break;
            const card = deck.shift();
            card.zone = GameState.ZONE.HAND;
            card.zoneIndex = playerState.hand.length;
            playerState.hand.push(card);
            drawnCards.push(card);
        }

        updateHandCounts(playerState);
        if (drawnCards.length > 0 && global.BattleLog) {
            const deckName = deckType === 'mainDeck' ? '主牌库'
                           : deckType === 'costDeck' ? '费用牌库' : '传说牌库';
            const who = player === 'self' ? 'self' : 'opponent';
            global.BattleLog.log(`从${deckName}抽了 ${drawnCards.length} 张牌`, who);
        }
        GameState.notifyListeners();
        return drawnCards;
    }

    function drawInitialHand(player) {
        const drawnMain = drawFromDeck(player, 'mainDeck', GameState.INITIAL_HAND_SIZE);
        const drawnCost = drawFromDeck(player, 'costDeck', GameState.INITIAL_COST_HAND_SIZE);
        // 传说牌库不参与初始抽牌，可根据需要添加
        return [...drawnMain, ...drawnCost];
    }

    /**
     * 内部移动实现
     * @param {Object} [opts] { toPlayer } —— 指定"放进哪个玩家的区域"
     *        不传时保持原行为（放进卡牌当前所在方的区域）✓ 零破坏；
     *        「进墓 / 放逐 / 回库」这类按【所有者】归属的操作，由调用方传 card.owner ✓
     */
    function _moveCard(instanceId, toZone, toIndex, opts) {
        const state = GameState.getState();
        if (!state) return false;

        let card = null;
        let player = null;
        const publicIndex = state.publicField ? state.publicField.findIndex(c => c && c.instanceId === instanceId) : -1;
        if (publicIndex !== -1) {
            card = state.publicField[publicIndex];
            state.publicField[publicIndex] = null;
            player = state.players['self'];
        } else {
            const result = removeCardFromCurrentZone(instanceId);
            if (!result) return false;
            card = result.card;
            player = result.player;
        }

        const sourceZone = card.zone;

        // 归属覆盖：把卡放进"指定玩家"的区域（不指定时 = 它当前所在方 ✓ 原行为不变）
        if (opts && opts.toPlayer && state.players[opts.toPlayer]) {
            player = state.players[opts.toPlayer];
        }

        // 从战场移到非战场区域时，重置攻防并处理装备卡
        if ((sourceZone === GameState.ZONE.FRONT_FIELD || sourceZone === GameState.ZONE.BACK_FIELD) &&
            (toZone !== GameState.ZONE.FRONT_FIELD && toZone !== GameState.ZONE.BACK_FIELD)) {
            resetAttackDefenseIfMinion(card);
            moveEquippedCardsToGraveyard(card);
        }

        if (toZone === GameState.ZONE.HAND) {
            card.faceDown = false;
        }
        if (toZone === GameState.ZONE.PERSONAL_ZONE) {
            card.faceDown = false;
            player.personalZone.push(card);
            card.zone = GameState.ZONE.PERSONAL_ZONE;
            card.zoneIndex = player.personalZone.length - 1;
            GameState.notifyListeners();
            return true;
        }

        if (toZone === GameState.ZONE.PUBLIC_FIELD) {
            if (toIndex < 0 || toIndex >= state.publicField.length) {
                placeCardInZone(player, card, card.zone, card.zoneIndex);
                GameState.notifyListeners();
                return false;
            }
            if (state.publicField[toIndex] !== null) {
                if (card.zone === GameState.ZONE.PUBLIC_FIELD) {
                    state.publicField[card.zoneIndex] = card;
                } else {
                    placeCardInZone(player, card, card.zone, card.zoneIndex);
                }
                GameState.notifyListeners();
                return false;
            }
            state.publicField[toIndex] = card;
            card.zone = GameState.ZONE.PUBLIC_FIELD;
            card.zoneIndex = toIndex;
            GameState.notifyListeners();
            return true;
        }

        if (ZoneManager.isSlotZone(toZone)) {
            if (!ZoneManager.isSlotAvailable(player.owner, toZone, toIndex)) {
                if (card.zone === GameState.ZONE.PUBLIC_FIELD) {
                    state.publicField[card.zoneIndex] = card;
                } else {
                    placeCardInZone(player, card, card.zone, card.zoneIndex);
                }
                GameState.notifyListeners();
                return false;
            }
        }

        placeCardInZone(player, card, toZone, toIndex);
        GameState.notifyListeners();
        return true;
    }

    // ===== 移动日志包装器：统一记录卡牌在区域间的移动（供对局日志展示） =====
    const ZONE_ACTION_NAMES = {
        hand: '回手',
        frontField: '登场',
        backField: '发动',
        costZone: '支付',
        graveyard: '送入墓场',
        exile: '放逐',
        mainDeck: '放回主牌库',
        costDeck: '放回费用牌库',
        legendDeck: '放回传说牌库',
        personalZone: '置于个人区',
        publicField: '公开'
    };

    /**
     * 找实例 + 所属方 + 卡面数据 —— 【全项目唯一的卡牌查找实现】
     * 框架整理：ui / cardDetailUI / sidePanel / equipController / dragController
     * 里各自写的那份重复实现已全部改为调用这里（各自还都有缺漏：有的漏 legendDeck、
     * 大多漏 publicField）。这里统一覆盖：公共区 + 双方手牌/前后场/费用区/墓场/
     * 放逐/个人区/主牌库/费用牌库/传说牌库。
     */
    function findCardInstance(instanceId) {
        if (!instanceId) return null;
        const state = GameState.getState();
        if (!state) return null;

        const withData = (card, player) => ({
            card,
            player,
            data: card.cardData
                || (global.CardLibrary && global.CardLibrary.getCardById(card.cardId))
                || null
        });

        // 公共区
        if (Array.isArray(state.publicField)) {
            const pub = state.publicField.find(c => c && c.instanceId === instanceId);
            if (pub) return withData(pub, pub.owner === 'opponent' ? 'opponent' : 'self');
        }

        for (const p of ['self', 'opponent']) {
            const ps = state.players[p];
            if (!ps) continue;
            const zones = [ps.hand, ps.frontField, ps.backField, ps.costZone,
                           ps.graveyard, ps.exile, ps.personalZone,
                           ps.mainDeck, ps.costDeck, ps.legendDeck];
            for (const z of zones) {
                if (!Array.isArray(z)) continue;
                const card = z.find(c => c && c.instanceId === instanceId);
                if (card) return withData(card, p);
            }
        }
        return null;
    }

    /** 便捷版：只要卡牌实例本体（多处调用只关心卡本身） */
    function getCardInstance(instanceId) {
        const found = findCardInstance(instanceId);
        return found ? found.card : null;
    }

    /**
     * 位置变动后广播「时点」事件（供响应连锁系统感知）。
     * 连锁系统不存在 / 被关闭时，这里只是往空的总线 emit，零副作用：
     * 现有功能的稳定性不受影响。
     */
    /** 战场区域（前场 / 后场）—— 战场内互相移动不算"登场" ✓ */
    function isBattlefieldZone(zone) {
        return zone === GameState.ZONE.FRONT_FIELD || zone === GameState.ZONE.BACK_FIELD;
    }

    function emitTimePoint(instanceId, toZone, fromZone) {
        if (!global.TimePointBus || !global.TimePointBus.emit) return;

        // ★响应连锁的呼出条件：只有【从非战场区域进入战场】才广播时点 ✓
        //   已经在战场上的卡在前/后场之间挪格子 → 不触发响应连锁界面 ✗
        if (isBattlefieldZone(toZone) && isBattlefieldZone(fromZone)) return;

        const found = findCardInstance(instanceId);
        if (!found || !found.card) return;
        const actor = found.player === 'opponent' ? 'opponent' : 'self';
        const type = found.data ? found.data.type : null;

        if (toZone === GameState.ZONE.FRONT_FIELD) {
            if (!found.card.faceDown) {                 // 伏盖不算"登场"
                global.TimePointBus.emit({ type: 'minion:enter', actor, card: found.card, toZone });
            }
        } else if (toZone === GameState.ZONE.BACK_FIELD && type === 'tactic') {
            global.TimePointBus.emit({ type: 'tactic:activate', actor, card: found.card, toZone });
        }

        // ★「翻盖」时点：盖伏着进入战场（手牌菜单的「翻盖」= 盖伏登场 ✓）也算一次翻盖行动 ✓
        //   （正因为是盖伏，上面那句 minion:enter 被跳过了，所以这里不会重复开窗 ✓）
        if (isBattlefieldZone(toZone) && !isBattlefieldZone(fromZone) && found.card.faceDown) {
            global.TimePointBus.emit({
                type: 'flip:declare', actor, card: found.card, toZone, reason: 'enter'
            });
        }
    }

    /**
     * 「翻盖」时点（新增）：玩家执行「翻盖」行动后广播，供响应连锁呼出窗口 ✓
     *   · 只有【战场上】的卡才算翻盖行动（前场 / 后场右键菜单里的「翻盖」✓）
     *   · 翻成盖伏、或把盖伏翻回正面，点的是同一个「翻盖」按钮 → 都算一次翻盖行动 ✓
     *     事件里带 faceDown 表示翻完之后的状态，将来若只想对"盖下去"开窗，加一句判断即可 ✓
     *   · 永不抛错：时点总线内部已做异常隔离，这里只负责发事件 ✓
     */
    function emitFlipTimePoint(card) {
        if (!card || !global.TimePointBus || !global.TimePointBus.emit) return;
        if (card.zone !== GameState.ZONE.FRONT_FIELD && card.zone !== GameState.ZONE.BACK_FIELD) return;
        const found = findCardInstance(card.instanceId);
        const actor = (found && found.player === 'opponent') ? 'opponent' : 'self';
        global.TimePointBus.emit({
            type: 'flip:declare', actor, card, faceDown: !!card.faceDown, reason: 'toggle'
        });
    }

    /** 卡牌当前所在区域（用于判断是否"跨区进入"） */
    function zoneOf(instanceId) {
        const found = findCardInstance(instanceId);
        return (found && found.card) ? found.card.zone : null;
    }

    /**
     * 进区后自动「切换」（横置 / 竖置）—— 等同于玩家手动点右键菜单里的「切换」。
     * 触发条件（只在【跨区进入】时触发，避免同区内换格被反复切换）：
     *   · 费牌进入费用区
     * 注意（1.2 改动）：随从进入前场【不再自动切换】✗ —— 改成打「本回合进入战场」标记 ✓，
     *                  见 markBattlefieldEntry()；手动「切换」依然保留可用。
     */
    function applyAutoToggle(instanceId, toZone, fromZone) {
        if (!toZone || fromZone === toZone) return;
        const found = findCardInstance(instanceId);
        if (!found || !found.card) return;
        const type = found.data ? found.data.type : null;
        if (toZone !== GameState.ZONE.COST_ZONE || type !== 'cost') return;

        if (global.MenuAction && global.MenuAction.toggleActive) {
            global.MenuAction.toggleActive(found.card);        // 与手动「切换」完全一致
        } else {
            found.card.active = !found.card.active;
            if (global.UI && global.UI.applyCardMarkers) global.UI.applyCardMarkers();
        }
    }

    /**
     * 把「本回合进入战场」标记的变化同步给对手（只同步自己的卡）✓
     * 为什么必须单独补一次同步：
     *   moveCard 内部是先 placeCardInZone → GameState.notifyListeners()（这时联机已经发过状态），
     *   本标记是在那之后才设置的 ✗ → 若不补发，对方会看到随从入场、却看不到「新」标记（仅自己可见）✗
     */
    function syncEnteredMark(found) {
        if (!found || found.player !== 'self') return;
        if (global.SyncManager && global.SyncManager.sendPublicState) {
            global.SyncManager.sendPublicState('self');
        }
    }

    /**
     * 「本回合进入战场」标记（1.2 新增，替代原来的随从入场自动切换）：
     *   · 随从【跨区进入前场】→ 打上 card.enteredThisTurn = true
     *     （伏盖不算「登场」，与 minion:enter 时点的口径保持一致 ✓）
     *   · 进入前场以外的区域 → 清掉标记（避免卡牌离开战场后标记还跟着它）
     *   · 标记在回合交替时统一清空 —— 见 clearEnteredThisTurnMarks()
     *   · 标记变化后立即同步给对手，保证双端视角一致 ✓
     */
    function markBattlefieldEntry(instanceId, toZone, fromZone) {
        const found = findCardInstance(instanceId);
        if (!found || !found.card) return;
        const card = found.card;
        const type = found.data ? found.data.type : null;

        const enteringFront = (toZone === GameState.ZONE.FRONT_FIELD
            && type === 'minion'
            && !isBattlefieldZone(fromZone)      // ★战场内移动不重新打「新」标记（与连锁口径一致 ✓）
            && !card.faceDown);

        const before = !!card.enteredThisTurn;

        if (enteringFront) {
            card.enteredThisTurn = true;
        } else if (toZone !== GameState.ZONE.FRONT_FIELD) {
            card.enteredThisTurn = false;      // 离开前场 → 标记作废
        }

        if (card.enteredThisTurn !== before) syncEnteredMark(found);   // ★变化才同步，避免无意义刷屏
    }

    /** 回合交替：清空【两端】所有「本回合进入战场」标记（返回清掉的数量） */
    function clearEnteredThisTurnMarks() {
        const state = GameState.getState();
        if (!state || !state.players) return 0;
        let cleared = 0;
        let selfCleared = 0;
        ['self', 'opponent'].forEach(p => {
            const ps = state.players[p];
            if (!ps) return;
            ['frontField', 'backField'].forEach(zoneName => {
                if (!Array.isArray(ps[zoneName])) return;
                ps[zoneName].forEach(c => {
                    if (c && c.enteredThisTurn) {
                        c.enteredThisTurn = false;
                        cleared++;
                        if (p === 'self') selfCleared++;
                    }
                });
            });
        });
        syncEnteredMark(selfCleared > 0 ? { player: 'self' } : null);   // 自己的卡变了 → 补一次同步 ✓
        return cleared;
    }

    /** 进入新区域后的统一处理：① 广播时点（响应连锁）② 费牌进费用区自动切换 ③ 入场标记 */
    function afterZoneEnter(instanceId, toZone, fromZone) {
        emitTimePoint(instanceId, toZone, fromZone);
        applyAutoToggle(instanceId, toZone, fromZone);
        markBattlefieldEntry(instanceId, toZone, fromZone);
    }

    function findCardBrief(instanceId) {
        const state = GameState.getState();
        if (!state) return null;
        const zones = [];
        if (state.publicField) zones.push(state.publicField);
        ['self', 'opponent'].forEach(p => {
            const ps = state.players[p];
            if (!ps) return;
            zones.push(ps.hand, ps.frontField, ps.backField, ps.costZone,
                       ps.graveyard, ps.exile, ps.personalZone,
                       ps.mainDeck, ps.costDeck, ps.legendDeck);
        });
        for (const z of zones) {
            if (!Array.isArray(z)) continue;
            const found = z.find(c => c && c.instanceId === instanceId);
            if (found) {
                const data = found.cardData || (global.CardLibrary && global.CardLibrary.getCardById(found.cardId));
                // controller：日志/提示要按【谁在操作】归属，转移控制权后 owner ≠ 操作者 ✓
                return { name: (data && data.name) || '未知卡牌', owner: found.owner, controller: found.controller };
            }
        }
        return null;
    }

    function moveCard(instanceId, toZone, toIndex, opts) {
        const before = findCardBrief(instanceId);
        const fromZone = zoneOf(instanceId);             // 移动前所在区域（用于判断是否"跨区进入"）
        const result = _moveCard(instanceId, toZone, toIndex, opts);
        if (result && before && global.BattleLog) {
            const action = ZONE_ACTION_NAMES[toZone] || '移动';
            // 归属按【控制者】算（转移控制权后，操作者是 controller 而不是 owner ✓）
            const who = (before.controller || before.owner) === 'self' ? 'self' : 'opponent';
            global.BattleLog.log(`将「${before.name}」${action}`, who);
        }
        if (result) afterZoneEnter(instanceId, toZone, fromZone);   // 广播时点 + 自动「切换」
        return result;
    }

    function drawTopCardFromDeck(player, deckType) {
        const state = GameState.getState();
        if (!state) return null;
        const playerState = state.players[player];
        if (!playerState) return null;
        const deck = playerState[deckType];
        if (deck.length === 0) return null;
        const card = deck.shift();
        card.zone = null;
        card.zoneIndex = -1;
        GameState.notifyListeners();
        return card;
    }

    function moveCardFromDeckToZone(player, deckType, toZone, toIndex) {
        const state = GameState.getState();
        if (!state) return false;
        const playerState = state.players[player];
        if (!playerState) return false;

        const deck = playerState[deckType];
        if (deck.length === 0) return false;
        const card = deck.shift();

        if (toZone === GameState.ZONE.PERSONAL_ZONE) {
            card.faceDown = false;
            playerState.personalZone.push(card);
            card.zone = GameState.ZONE.PERSONAL_ZONE;
            card.zoneIndex = playerState.personalZone.length - 1;
            GameState.notifyListeners();
            return true;
        }

        if (toZone === GameState.ZONE.PUBLIC_FIELD) {
            if (toIndex < 0 || toIndex >= state.publicField.length || state.publicField[toIndex] !== null) {
                deck.unshift(card);
                card.zone = deckType;
                GameState.notifyListeners();
                return false;
            }
            state.publicField[toIndex] = card;
            card.zone = GameState.ZONE.PUBLIC_FIELD;
            card.zoneIndex = toIndex;
            GameState.notifyListeners();
            return true;
        }

        if (ZoneManager.isSlotZone(toZone)) {
            if (!ZoneManager.isSlotAvailable(player, toZone, toIndex)) {
                deck.unshift(card);
                card.zone = deckType;
                GameState.notifyListeners();
                return false;
            }
        }

        const fromZone = card.zone;                  // 移动前所在区域（牌库）
        card.faceDown = false;
        placeCardInZone(playerState, card, toZone, toIndex);
        GameState.notifyListeners();
        afterZoneEnter(card.instanceId, toZone, fromZone);   // 广播时点 + 自动「切换」
        return true;
    }

    function moveSpecificCardFromDeckToZone(player, deckType, instanceId, toZone, toIndex) {
        const state = GameState.getState();
        if (!state) return false;
        const playerState = state.players[player];
        if (!playerState) return false;

        const deck = playerState[deckType];
        const index = deck.findIndex(c => c && c.instanceId === instanceId);
        if (index === -1) return false;

        const card = deck.splice(index, 1)[0];

        if (toZone === GameState.ZONE.PUBLIC_FIELD) {
            if (toIndex < 0 || toIndex >= state.publicField.length || state.publicField[toIndex] !== null) {
                deck.splice(index, 0, card);
                card.zone = deckType;
                GameState.notifyListeners();
                return false;
            }
            state.publicField[toIndex] = card;
            card.zone = GameState.ZONE.PUBLIC_FIELD;
            card.zoneIndex = toIndex;
            GameState.notifyListeners();
            return true;
        }

        if (toZone === GameState.ZONE.PERSONAL_ZONE) {
            card.faceDown = false;
            playerState.personalZone.push(card);
            card.zone = GameState.ZONE.PERSONAL_ZONE;
            card.zoneIndex = playerState.personalZone.length - 1;
            GameState.notifyListeners();
            return true;
        }

        if (ZoneManager.isSlotZone(toZone)) {
            if (!ZoneManager.isSlotAvailable(player, toZone, toIndex)) {
                deck.splice(index, 0, card);
                card.zone = deckType;
                GameState.notifyListeners();
                return false;
            }
        }

        const fromZone2 = card.zone;                 // 移动前所在区域（牌库）
        placeCardInZone(playerState, card, toZone, toIndex);
        GameState.notifyListeners();
        afterZoneEnter(card.instanceId, toZone, fromZone2);   // 广播时点 + 自动「切换」
        return true;
    }

    function returnCardToDeckTop(player, deckType, card) {
        const state = GameState.getState();
        if (!state || !card) return false;
        const playerState = state.players[player];
        if (!playerState) return false;

        const result = removeCardFromAnywhere(card.instanceId);
        if (!result) return false;

        const sourceZone = card.zone;
        if (sourceZone === GameState.ZONE.FRONT_FIELD || sourceZone === GameState.ZONE.BACK_FIELD) {
            resetAttackDefenseIfMinion(card);
            moveEquippedCardsToGraveyard(card);
        }

        // ★回库 = 控制权复位为所有者（★进库前触发 ✓）
        if (global.ControlManager && global.ControlManager.resetControlOnLeave) {
            global.ControlManager.resetControlOnLeave(card, deckType);
        }
        playerState[deckType].unshift(card);
        card.zone = deckType;
        card.zoneIndex = 0;
        for (let i = 1; i < playerState[deckType].length; i++) {
            playerState[deckType][i].zoneIndex = i;
        }
        GameState.notifyListeners();
        return true;
    }

    function returnCardToDeckBottom(player, deckType, card) {
        const state = GameState.getState();
        if (!state || !card) return false;
        const playerState = state.players[player];
        if (!playerState) return false;

        const result = removeCardFromAnywhere(card.instanceId);
        if (!result) return false;

        const sourceZone = card.zone;
        if (sourceZone === GameState.ZONE.FRONT_FIELD || sourceZone === GameState.ZONE.BACK_FIELD) {
            resetAttackDefenseIfMinion(card);
            moveEquippedCardsToGraveyard(card);
        }

        // ★回库 = 控制权复位为所有者（★进库前触发 ✓）
        if (global.ControlManager && global.ControlManager.resetControlOnLeave) {
            global.ControlManager.resetControlOnLeave(card, deckType);
        }
        playerState[deckType].push(card);
        card.zone = deckType;
        card.zoneIndex = playerState[deckType].length - 1;
        GameState.notifyListeners();
        return true;
    }

    function changeHealth(player, delta) {
        const state = GameState.getState();
        if (!state) return;
        const playerState = state.players[player];
        if (!playerState) return;
        playerState.health = Math.max(0, playerState.health + delta);
        GameState.notifyListeners();
    }

    function shuffleDeck(player, deckType) {
        const state = GameState.getState();
        if (!state) return false;
        const playerState = state.players[player];
        if (!playerState) return false;
        const deck = playerState[deckType];
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        deck.forEach((card, index) => { card.zoneIndex = index; });
        GameState.notifyListeners();
        return true;
    }

    function toggleCardFaceDown(card) {
        if (!card) return false;
        card.faceDown = !card.faceDown;
        GameState.notifyListeners();
        emitFlipTimePoint(card);          // ★「翻盖」行动 → 触发翻盖时点（响应连锁会据此开窗 ✓）
        return true;
    }

    function equipCardToTarget(equipCard, targetCard) {
        const state = GameState.getState();
        if (!state || !equipCard || !targetCard) return false;

        if (targetCard.zone !== GameState.ZONE.FRONT_FIELD && targetCard.zone !== GameState.ZONE.BACK_FIELD) {
            return false;
        }

        if (!equipCard.cardData && equipCard.cardId) {
            equipCard.cardData = global.CardLibrary ? global.CardLibrary.getCardById(equipCard.cardId) : null;
        }

        const removeResult = removeCardFromAnywhere(equipCard.instanceId);
        if (!removeResult) return false;

        if (!targetCard.equippedCards) targetCard.equippedCards = [];
        targetCard.equippedCards.push(equipCard);
        equipCard.zone = 'equipped';
        equipCard.zoneIndex = -1;

        GameState.notifyListeners();
        return true;
    }

    function resetAttackDefenseIfMinion(card) {
        if (card && card.cardData && card.cardData.type === 'minion') {
            card.currentAttack = card.cardData.attack;
            card.currentDefense = card.cardData.defense;
        }
    }

    function moveEquippedCardsToGraveyard(targetCard) {
        if (targetCard && targetCard.equippedCards && targetCard.equippedCards.length > 0) {
            const state = GameState.getState();
            targetCard.equippedCards.forEach(equipCard => {
                if (!equipCard.cardData && equipCard.cardId) {
                    equipCard.cardData = global.CardLibrary ? global.CardLibrary.getCardById(equipCard.cardId) : null;
                }
                const ownerState = state.players[equipCard.owner];
                if (ownerState) {
                    ownerState.graveyard.push(equipCard);
                    equipCard.zone = GameState.ZONE.GRAVEYARD;
                    equipCard.zoneIndex = ownerState.graveyard.length - 1;

                    // 装备卡归属对方时，同样要单独通知对方（常规同步只发自己那一侧 ✗）
                    if (equipCard.owner !== 'self' &&
                        global.CardHandoverChannel && global.CardHandoverChannel.handover) {
                        global.CardHandoverChannel.handover(equipCard, { zone: 'graveyard' });
                    }
                }
            });
            targetCard.equippedCards = [];
        }
    }

    function removeCardFromAnywhere(instanceId) {
        const state = GameState.getState();
        if (!state) return null;

        if (state.publicField) {
            const pubIndex = state.publicField.findIndex(c => c && c.instanceId === instanceId);
            if (pubIndex !== -1) {
                const card = state.publicField[pubIndex];
                state.publicField[pubIndex] = null;
                return { card, player: state.players['self'] };
            }
        }

        return removeCardFromCurrentZone(instanceId);
    }

    function removeCardFromCurrentZone(instanceId) {
        const state = GameState.getState();
        if (!state) return null;

        for (const playerKey of ['self', 'opponent']) {
            const player = state.players[playerKey];

            const personalIndex = player.personalZone.findIndex(c => c && c.instanceId === instanceId);
            if (personalIndex !== -1) {
                const card = player.personalZone.splice(personalIndex, 1)[0];
                return { card, player };
            }

            const handIndex = player.hand.findIndex(c => c && c.instanceId === instanceId);
            if (handIndex !== -1) {
                const card = player.hand.splice(handIndex, 1)[0];
                updateHandCounts(player);
                return { card, player };
            }

            for (let i = 0; i < player.frontField.length; i++) {
                if (player.frontField[i] && player.frontField[i].instanceId === instanceId) {
                    const card = player.frontField[i];
                    player.frontField[i] = null;
                    return { card, player };
                }
            }

            for (let i = 0; i < player.backField.length; i++) {
                if (player.backField[i] && player.backField[i].instanceId === instanceId) {
                    const card = player.backField[i];
                    player.backField[i] = null;
                    return { card, player };
                }
            }

            for (let i = 0; i < player.costZone.length; i++) {
                if (player.costZone[i] && player.costZone[i].instanceId === instanceId) {
                    const card = player.costZone[i];
                    player.costZone[i] = null;
                    return { card, player };
                }
            }

            const pileZones = ['mainDeck', 'costDeck', 'legendDeck', 'graveyard', 'exile'];
            for (const pileZone of pileZones) {
                const idx = player[pileZone].findIndex(c => c && c.instanceId === instanceId);
                if (idx !== -1) {
                    const card = player[pileZone].splice(idx, 1)[0];
                    return { card, player };
                }
            }
        }
        return null;
    }

    function placeCardInZone(player, card, zone, index) {
        if (zone !== GameState.ZONE.FRONT_FIELD &&
            zone !== GameState.ZONE.BACK_FIELD &&
            zone !== GameState.ZONE.COST_ZONE &&
            zone !== GameState.ZONE.PUBLIC_FIELD) {
            card.active = true;
        }

        // ★控制权复位判定（见 controlManager.resetControlOnLeave）✓
        //   进墓 / 放逐 / 回库 → 复位为所有者；回手 / 费用区 / 个人区 / 公共区 / 战场内移动 → 保留 ✓
        if (global.ControlManager && global.ControlManager.resetControlOnLeave) {
            global.ControlManager.resetControlOnLeave(card, zone);
        }

        card.zone = zone;
        card.zoneIndex = index;

        switch (zone) {
            case GameState.ZONE.HAND:
                if (index === undefined || index < 0 || index >= player.hand.length) {
                    player.hand.push(card);
                    card.zoneIndex = player.hand.length - 1;
                } else {
                    player.hand.splice(index, 0, card);
                }
                updateHandCounts(player);
                break;
            case GameState.ZONE.FRONT_FIELD:
                if (index >= 0 && index < player.frontField.length) {
                    player.frontField[index] = card;
                }
                break;
            case GameState.ZONE.BACK_FIELD:
                if (index >= 0 && index < player.backField.length) {
                    player.backField[index] = card;
                }
                break;
            case GameState.ZONE.COST_ZONE:
                if (index >= 0 && index < player.costZone.length) {
                    player.costZone[index] = card;
                }
                break;
            case GameState.ZONE.MAIN_DECK:
                player.mainDeck.unshift(card);
                card.zoneIndex = 0;
                for (let i = 1; i < player.mainDeck.length; i++) {
                    player.mainDeck[i].zoneIndex = i;
                }
                break;
            case GameState.ZONE.COST_DECK:
                player.costDeck.unshift(card);
                card.zoneIndex = 0;
                for (let i = 1; i < player.costDeck.length; i++) {
                    player.costDeck[i].zoneIndex = i;
                }
                break;
            case GameState.ZONE.LEGEND_DECK:
                player.legendDeck.unshift(card);
                card.zoneIndex = 0;
                for (let i = 1; i < player.legendDeck.length; i++) {
                    player.legendDeck[i].zoneIndex = i;
                }
                break;
            case GameState.ZONE.GRAVEYARD:
                player.graveyard.push(card);
                card.zoneIndex = player.graveyard.length - 1;
                break;
            case GameState.ZONE.EXILE:
                player.exile.push(card);
                card.zoneIndex = player.exile.length - 1;
                break;
        }
    }

    function updateHandCounts(player) {
        let main = 0, cost = 0;
        player.hand.forEach(instance => {
            if (!instance) return;
            const card = instance.cardData || global.CardLibrary?.getCardById(instance.cardId);
            if (card && card.type === 'cost') cost++;
            else main++;
        });
        player.handMainCount = main;
        player.handCostCount = cost;
    }

    /* ================= 费用区：批量整理（供「费用区界面」与「自动对齐」按钮使用） ================= */

    /** 费用区第一个空格（满则返回 -1） */
    function firstEmptyCostSlot(player) {
        const p = typeof player === 'string' ? GameState.getPlayerState(player) : player;
        if (!p || !Array.isArray(p.costZone)) return -1;
        for (let i = 0; i < p.costZone.length; i++) {
            if (!p.costZone[i]) return i;
        }
        return -1;
    }

    /**
     * 费用区自动对齐：按「阅读顺序」（第一行从左到右，再第二行）把牌左移补齐。
     * 例：第一行「空空红空黄」+ 第二行「空绿绿」 → 红黄绿绿（超出第一行自然排到第二行）
     */
    function compactCostZone(player) {
        const p = typeof player === 'string' ? GameState.getPlayerState(player) : player;
        if (!p || !Array.isArray(p.costZone)) return 0;
        const cards = p.costZone.filter(Boolean);          // filter 保留的就是阅读顺序
        if (cards.length === p.costZone.length) return 0;  // 本来就没有空格
        let moved = 0;
        for (let i = 0; i < p.costZone.length; i++) {
            const next = cards[i] || null;
            if (p.costZone[i] !== next) moved++;
            p.costZone[i] = next;
            if (next) next.zoneIndex = i;
        }
        if (moved) GameState.notifyListeners();
        return moved;
    }

    /** 费用区调换：交换两张牌在费用区里的位置（两张都必须在该玩家的费用区里） */
    function swapCostZoneSlots(player, idA, idB) {
        const p = typeof player === 'string' ? GameState.getPlayerState(player) : player;
        if (!p || !Array.isArray(p.costZone)) return false;
        const ia = p.costZone.findIndex(c => c && c.instanceId === idA);
        const ib = p.costZone.findIndex(c => c && c.instanceId === idB);
        if (ia < 0 || ib < 0 || ia === ib) return false;
        const tmp = p.costZone[ia];
        p.costZone[ia] = p.costZone[ib];
        p.costZone[ib] = tmp;
        if (p.costZone[ia]) p.costZone[ia].zoneIndex = ia;
        if (p.costZone[ib]) p.costZone[ib].zoneIndex = ib;
        GameState.notifyListeners();
        return true;
    }

    global.CardActions = {
        drawFromDeck,
        drawInitialHand,
        moveCard,
        drawTopCardFromDeck,
        moveCardFromDeckToZone,
        moveSpecificCardFromDeckToZone,
        returnCardToDeckTop,
        returnCardToDeckBottom,
        changeHealth,
        shuffleDeck,
        toggleCardFaceDown,
        emitFlipTimePoint,
        equipCardToTarget,
        // 费用区：批量整理（自动对齐 / 调换 / 找空格）
        firstEmptyCostSlot,
        compactCostZone,
        swapCostZoneSlots,
        // 入场标记：随从进入前场打「本回合进入战场」标记 / 回合交替时统一清空
        markBattlefieldEntry,
        clearEnteredThisTurnMarks,
        // 公共查询：按 instanceId 找卡牌实例（返回 { card, player, data }）
        // —— 响应连锁 / 标记系统等都需要，统一从这里取，避免各模块各写一套查找
        findCardInstance,
        // 便捷版：只要卡牌本体（老代码大多数只需要卡本身）
        getCardInstance,
        // 手牌计数（转移/复制进手牌后需要重算）
        updateHandCounts,
        // 从任意区域取出卡牌实例（转移控制权交给对方时用）✓
        removeCardFromAnywhere
    };
})(window);