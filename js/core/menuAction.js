// js/core/menuAction.js
// 菜单动作模块：处理需要选择目标格子的卡牌操作（登场、发动、支付、盖伏）及无需选择格子的操作
// 注意：装备目标选择已移至独立模块 equipController.js

(function(global) {
    let selectionState = null;
    let boundSlots = [];
    let globalCancelHandler = null;

    const PUBLIC_REVEAL_ORDER = [2, 1, 3, 0, 4];

    /**
     * 点亮某方某区域的空格
     * @param {string} zone 'frontField' | 'backField' | 'costZone'
     * @param {string} [side] 'self'（默认，保持旧行为 ✓）| 'opponent'（转移控制权时点亮对方半场 ✓）
     */
    function highlightEmptySlots(zone, side) {
        const who = (side === 'opponent') ? 'opponent' : 'self';
        const idMap = {
            frontField: who + '-front-field',
            backField: who + '-back-field',
            costZone: who + '-cost-zone'
        };

        const container = document.getElementById(idMap[zone] || '');
        if (!container) return [];
        const emptySlots = container.querySelectorAll('.field-slot.empty');
        emptySlots.forEach(slot => slot.classList.add('selectable'));
        return Array.from(emptySlots);
    }

    function highlightEmptySlotsMulti(zones) {
        let allSlots = [];
        zones.forEach(zone => {
            allSlots = allSlots.concat(highlightEmptySlots(zone));
        });
        return allSlots;
    }

    function clearHighlights() {
        boundSlots.forEach(slot => {
            slot.classList.remove('selectable');
            if (slot._menuActionHandler) {
                slot.removeEventListener('click', slot._menuActionHandler);
                delete slot._menuActionHandler;
            }
        });
        boundSlots = [];
    }

    function bindGlobalCancel() {
        if (globalCancelHandler) return;
        globalCancelHandler = (e) => {
            if (!e.target.closest('.field-slot.selectable')) {
                cancelSelection();
            }
        };
        document.addEventListener('mousedown', globalCancelHandler, true);
    }

    function cancelSelection() {
        if (selectionState) {
            clearHighlights();
            selectionState = null;
        }
        document.body.classList.remove('place-select');
        if (globalCancelHandler) {
            document.removeEventListener('mousedown', globalCancelHandler, true);
            globalCancelHandler = null;
        }
    }

    function startSelection(card, targetZone) {
        if (selectionState) cancelSelection();

        const slots = highlightEmptySlots(targetZone);
        if (slots.length === 0) {
            notify('没有可用的空位', 'warning');
            return false;
        }

        slots.forEach(slot => {
            const handler = (e) => {
                e.stopPropagation();
                handleSlotClick(slot, card, targetZone, false);
            };
            slot.addEventListener('click', handler);
            slot._menuActionHandler = handler;
            boundSlots.push(slot);
        });

        selectionState = { card, targetZone, faceDown: false };
        document.body.classList.add('place-select');
        bindGlobalCancel();
        return true;
    }

    function startSelectionMultiZone(card, zones, faceDown) {
        if (selectionState) cancelSelection();

        const slots = highlightEmptySlotsMulti(zones);
        if (slots.length === 0) {
            notify('没有可用的空位', 'warning');
            return false;
        }

        slots.forEach(slot => {
            const handler = (e) => {
                e.stopPropagation();
                handleSlotClickMultiZone(slot, card, zones, faceDown);
            };
            slot.addEventListener('click', handler);
            slot._menuActionHandler = handler;
            boundSlots.push(slot);
        });

        selectionState = { card, targetZones: zones, faceDown: faceDown };
        document.body.classList.add('place-select');
        bindGlobalCancel();
        return true;
    }

    /**
     * 落子：把卡放进某个空格（菜单里点「登场 / 发动 / 盖伏」后再点格子走这里）
     * 原来 handleSlotClick 与 handleSlotClickMultiZone 是两份 95% 相同的代码，
     * 现合并为一个 placeCardInSlot：多区域版先解析出具体区域，再走同一套放置逻辑。
     */
    function placeCardInSlot(slot, card, zoneKey, faceDown) {
        const zone = mapZone(zoneKey);
        if (!zone) return;
        card.faceDown = faceDown;
        const ok = global.CardActions.moveCard(card.instanceId, zone, getIndexFromSlot(slot, zoneKey));
        if (ok) refreshAll();
        else notify('放置失败', 'error');
        cancelSelection();
    }

    /**
     * 点亮某方【多个区域】的空格（前场 + 后场 一起用）✓
     * @returns {Array} [{ slot, zone }] 带区域信息的格子列表
     */
    function highlightEmptySlotsForSide(zones, side) {
        const list = [];
        (Array.isArray(zones) ? zones : [zones]).forEach(zone => {
            highlightEmptySlots(zone, side).forEach(slot => list.push({ slot: slot, zone: zone }));
        });
        return list;
    }

    /** 从格子反推它属于哪个区域（只认候选区域里的 ✓，按指定半场判断） */
    function zoneFromSlotForSide(slot, zones, side) {
        const who = (side === 'opponent') ? 'opponent' : 'self';
        const list = Array.isArray(zones) ? zones : [zones];
        if (list.indexOf('frontField') >= 0 && slot.closest('#' + who + '-front-field')) return 'frontField';
        if (list.indexOf('backField') >= 0 && slot.closest('#' + who + '-back-field')) return 'backField';
        if (list.indexOf('costZone') >= 0 && slot.closest('#' + who + '-cost-zone')) return 'costZone';
        return null;
    }

    /**
     * 通用「点格子」流程（支持指定半场 + 多个区域）
     * 转移控制权 / 复制卡牌 用它选落点：战场 = 前场 + 后场 都可点 ✓
     * @param {string|Array} zoneOrZones 'frontField' 或 ['frontField','backField']
     * @param {string} side   'self' | 'opponent'
     * @param {function} onPick (index, slot, zone) => void
     * @returns {boolean} 是否进入选格状态
     */
    function startSelectionOnSide(zoneOrZones, side, onPick) {
        if (selectionState) cancelSelection();

        const zones = Array.isArray(zoneOrZones) ? zoneOrZones : [zoneOrZones];
        const picked = highlightEmptySlotsForSide(zones, side);
        if (picked.length === 0) {
            notify('没有可用的空位', 'warning');
            return false;
        }

        picked.forEach(entry => {
            const slot = entry.slot;
            const zone = entry.zone;
            const handler = (e) => {
                e.stopPropagation();
                const index = getIndexFromSlot(slot, zone);
                const hitZone = zoneFromSlotForSide(slot, zones, side) || zone;
                cancelSelection();                    // 先收掉高亮，再执行动作 ✓
                if (typeof onPick === 'function') onPick(index, slot, hitZone);
            };
            slot.addEventListener('click', handler);
            slot._menuActionHandler = handler;
            boundSlots.push(slot);
        });

        selectionState = { zones: zones, side: side, onPick: onPick };
        document.body.classList.add('place-select');
        bindGlobalCancel();
        return true;
    }

    function handleSlotClick(slot, card, targetZone, faceDown) {
        placeCardInSlot(slot, card, targetZone, faceDown);
    }

    function handleSlotClickMultiZone(slot, card, zones, faceDown) {
        const zoneKey = determineZoneFromSlot(slot, zones);
        if (!zoneKey) return;
        placeCardInSlot(slot, card, zoneKey, faceDown);
    }

    function determineZoneFromSlot(slot, zones) {
        if (zones.includes('frontField') && slot.closest('#self-front-field')) return 'frontField';
        if (zones.includes('backField') && slot.closest('#self-back-field')) return 'backField';
        return null;
    }

    function getIndexFromSlot(slot, zone) {
        if (zone === 'costZone') {
            const costZone = slot.closest('.cost-zone');
            const rowEl = slot.closest('.cost-row');
            if (costZone && rowEl) {
                const rows = Array.from(costZone.querySelectorAll('.cost-row'));
                const rowIndex = rows.indexOf(rowEl);
                const colIndex = parseInt(slot.getAttribute('data-index') || '0', 10);
                return rowIndex * 5 + colIndex;
            }
            return 0;
        }
        return parseInt(slot.getAttribute('data-index') || '0', 10);
    }

    function mapZone(zone) {
        if (zone === 'frontField') return global.GameState.ZONE.FRONT_FIELD;
        if (zone === 'backField') return global.GameState.ZONE.BACK_FIELD;
        if (zone === 'costZone') return global.GameState.ZONE.COST_ZONE;
        return null;
    }

    // ========== 直接动作（不需要选格子，直接改状态） ==========

    /** 统一刷新界面（模块/方法缺失时静默跳过） */
    function refreshAll() {
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
    }

    /** 统一提示 */
    function notify(msg, type) {
        if (global.UI && global.UI.showNotification) global.UI.showNotification(msg, type || 'info');
    }

    /**
     * 动作统一收口：取消选择 → 执行 → 成功刷新 / 失败提示
     * （原来是 6 个各自挤成一行、300+ 字符的 if/else，重复度极高）
     */
    function runCardAction(card, action, failMsg) {
        cancelSelection();
        const ok = action(card);
        if (ok) refreshAll();
        else if (failMsg) notify(failMsg, 'error');
        return ok;
    }

    function returnToHand(card) {
        return runCardAction(card, c => {
            c.faceDown = false;      // 回手默认正面
            return global.CardActions.moveCard(c.instanceId, global.GameState.ZONE.HAND, -1);
        }, '回手失败');
    }

    function discard(card) {
        // 进墓回到【所有者】的墓场（控制权可能已转移，但归属不变 ✓）
        const ok = runCardAction(card,
            c => global.CardActions.moveCard(c.instanceId, global.GameState.ZONE.GRAVEYARD, -1,
                { toPlayer: c.owner || 'self' }),
            '进墓失败');
        notifyOwnerIfNeeded(card, 'graveyard');
        return ok;
    }

    function exile(card) {
        // 放逐回到【所有者】的放逐区（同上 ✓）
        const ok = runCardAction(card,
            c => global.CardActions.moveCard(c.instanceId, global.GameState.ZONE.EXILE, -1,
                { toPlayer: c.owner || 'self' }),
            '放逐失败');
        notifyOwnerIfNeeded(card, 'exile');
        return ok;
    }

    /**
     * 改动的是【对方的区域】时，单独通知对方 ✓
     * （常规同步只发送自己那一侧，"我的牌落进对方的墓场"这类改动传不过去 ✗）
     */
    function notifyOwnerIfNeeded(card, zone, atTop) {
        if (!card || (card.owner || 'self') === 'self') return;
        if (global.CardHandoverChannel && global.CardHandoverChannel.handover) {
            global.CardHandoverChannel.handover(card, { zone: zone, atTop: !!atTop });
        }
    }

    function toggleFaceDown(card) {
        return runCardAction(card, c => global.CardActions.toggleCardFaceDown(c), '翻盖失败');
    }

    /**
     * 「回库」：保留 顶 / 底 两个选项，但不再让玩家去挑"哪个牌库" ——
     * 费用牌 → 费用牌库；其余 → 主牌库 ✓
     */
    function returnToDeck(card) {
        cancelSelection();
        const anchorEl = document.querySelector(`[data-instance-id="${card.instanceId}"]`);
        if (!anchorEl) return;

        const isCost = !!(card.cardData && card.cardData.type === 'cost');
        const deck = isCost ? 'costDeck' : 'mainDeck';
        const deckName = isCost ? '费用牌库' : '主牌库';

        global.MenuUI.show({
            items: [
                { label: '回' + deckName + '顶', value: 'returnToTop', tone: 'danger' },
                { label: '回' + deckName + '底', value: 'returnToBottom', tone: 'danger' }
            ],
            anchorEl: anchorEl,
            onSelect: (value) => {
                cancelSelection();
                const atTop = (value === 'returnToTop');
                const ok = atTop
                    ? global.CardActions.returnCardToDeckTop(card.owner, deck, card)
                    : global.CardActions.returnCardToDeckBottom(card.owner, deck, card);
                // 改动的是【对方的牌库】时，单独通知对方 ✓（常规同步传不过去 ✗）
                if (ok && card.owner && card.owner !== 'self' &&
                    global.CardHandoverChannel && global.CardHandoverChannel.handover) {
                    global.CardHandoverChannel.handover(card, { zone: deck, atTop: atTop });
                }
                if (ok) refreshAll();
                else notify('回库失败', 'error');
            }
        });
    }

    function returnToMainDeckTop(card) {
        return runCardAction(card,
            c => global.CardActions.returnCardToDeckTop(c.owner, 'mainDeck', c),
            '回主牌库顶失败');
    }

    function returnToMainDeckBottom(card) {
        return runCardAction(card,
            c => global.CardActions.returnCardToDeckBottom(c.owner, 'mainDeck', c),
            '回主牌库底失败');
    }

    /** 「公开」：把主牌库的牌翻到公共区第一个空位（落点顺序见 PUBLIC_REVEAL_ORDER） */
    function publicReveal() {
        cancelSelection();
        const state = global.GameState.getState();
        if (!state) return;

        const targetIndex = PUBLIC_REVEAL_ORDER.find(idx => state.publicField[idx] === null);
        if (targetIndex === undefined) {
            notify('公共区已满', 'warning');
            return;
        }
        const ok = global.CardActions.moveCardFromDeckToZone(
            'self', 'mainDeck', global.GameState.ZONE.PUBLIC_FIELD, targetIndex);
        if (ok) refreshAll();
        else notify('公开失败', 'error');
    }

    /** 查阅某一堆（只读翻阅，最新的排在最前） */
    function viewZone(zoneKey, title) {
        cancelSelection();
        const state = global.GameState.getState();
        if (!state) return;
        const cards = state.players.self[zoneKey].slice().reverse();
        if (global.ViewerUI) global.ViewerUI.show(cards, title);
    }

    /**
     * 查阅（墓场 / 放逐区）：与检索同一套界面、同一套落点动作，差异只有两点 ✓
     *   · 事先不告知对方（仅查阅 = 纯私下 ✓）；一旦取牌才弹"查阅了这张" ✓
     *   · 不洗切 ✓
     * 实现在 js/ui/deckTakeUI.js 的 browse 模式 ✓
     */
    function viewGraveyard() { return !!(global.DeckTakeUI && global.DeckTakeUI.openBrowse('graveyard')); }
    function viewExile() { return !!(global.DeckTakeUI && global.DeckTakeUI.openBrowse('exile')); }

    // 目标区域中文名（检索落点提示用）
    const DEST_LABEL = {
        hand: '手牌',
        frontField: '前场',
        backField: '后场',
        graveyard: '墓场',
        exile: '放逐区'
    };

    // 落点 key → 区域常量名（替代原来那一长串三元表达式）
    const DEST_ZONE_KEY = {
        hand: 'HAND',
        frontField: 'FRONT_FIELD',
        backField: 'BACK_FIELD',
        graveyard: 'GRAVEYARD',
        exile: 'EXILE'
    };

    // 找某区域第一个空位（前场/后场各 5 格）
    function firstEmptySlot(playerState, zoneKey) {
        const arr = playerState[zoneKey];
        if (!Array.isArray(arr)) return -1;
        return arr.findIndex(c => !c);
    }

    // 检索取牌：从牌库把指定卡移到目标区域，并洗切牌库
    //   opts.silent    = true → 不告知对方（翻阅流程里对方已在看展示 ✓）
    //   opts.noShuffle = true → 不洗切（翻阅取牌保留牌库顶顺序 ✓）
    function takeCardFromDeck(deckType, cardInstance, action, opts) {
        const o = opts || {};
        const Z = global.GameState.ZONE;
        const dest = DEST_LABEL[action] ? action : 'hand';
        const toZone = Z[DEST_ZONE_KEY[dest]];

        const state = global.GameState.getState();
        if (!state) return false;
        const self = state.players.self;

        let toIndex = -1;
        if (toZone === Z.FRONT_FIELD || toZone === Z.BACK_FIELD) {
            toIndex = firstEmptySlot(self, toZone);
            if (toIndex === -1) {
                notify(`${DEST_LABEL[dest]}已满`, 'warning');
                return false;
            }
        }

        const ok = global.CardActions.moveSpecificCardFromDeckToZone('self', deckType, cardInstance.instanceId, toZone, toIndex);
        if (!ok) {
            notify('取牌失败', 'error');
            return false;
        }

        // 检索后洗切（常规规则；翻阅取牌不洗切，保留"牌库顶"语义 ✓）
        if (!o.noShuffle) global.CardActions.shuffleDeck('self', deckType);

        const card = cardInstance.cardData || global.CardLibrary.getCardById(cardInstance.cardId);

        // ★取牌后的"告知对方"统一收口（模式由 js/ui/deckTakeUI.js 的 take() 指定）：
        //   'search' 检索 → "检索告知"        'peek' 翻阅 → "翻到了这张牌"
        //   'browse' 查阅 → "查阅了这张"      'none' → 不告知（仅查阅 ✓）
        //   （peekNote / silent 是旧写法，保留兼容 ✓）
        const noticeMode = o.notify || (o.peekNote ? 'peek' : (o.silent ? 'none' : 'search'));
        const verb = noticeMode === 'peek' ? '翻阅' : (noticeMode === 'browse' ? '查阅' : '检索');

        if (global.BattleLog) {
            global.BattleLog.log(`${verb}「${card ? card.name : '未知'}」→ ${DEST_LABEL[dest]}`, 'self');
        }

        const RC = global.RevealChannel;
        if (noticeMode === 'peek' && RC && RC.notePeekTaken) {
            RC.notePeekTaken({ card: cardInstance, destLabel: DEST_LABEL[dest] });
        } else if (noticeMode === 'browse' && RC && RC.noteBrowseTaken) {
            RC.noteBrowseTaken({ zone: deckType, destLabel: DEST_LABEL[dest], card: cardInstance });
        } else if (noticeMode === 'search' && RC && RC.showSearchResult) {
            RC.showSearchResult({
                zone: deckType,
                destLabel: DEST_LABEL[dest],
                card: cardInstance
            });
        }
        refreshAll();
        return true;        // 供"翻阅"等调用方判断是否真的取走了牌 ✓
    }


    /**

    /* ================= 检索 / 翻阅（统一委托给 DeckTakeUI ✓） ================= */
    // 两者只是"取牌范围 + 取牌后处理"不同，界面与落点动作完全共用
    // 实现与差异点集中在 js/ui/deckTakeUI.js ✓

    /** 检索：整个牌库（取牌后洗切 + 告知对方"检索了哪张" ✓） */
    function searchDeck(deckType) {
        cancelSelection();
        return !!(global.DeckTakeUI && global.DeckTakeUI.openSearch(deckType));
    }

    // 查阅（只读翻阅牌库，不做任何移动）
    function viewDeck(deckType) {
        cancelSelection();
        const state = global.GameState.getState();
        if (!state) return;
        const deck = state.players.self[deckType];
        if (!Array.isArray(deck) || deck.length === 0) {
            notify('牌库是空的', 'warning');
            return;
        }
        const titleMap = { mainDeck: '主牌库查阅', costDeck: '费用牌库查阅', legendDeck: '传说牌库查阅' };
        if (global.ViewerUI) {
            global.ViewerUI.show(deck.slice(), titleMap[deckType] || '牌库查阅', null, { hint: '只读翻阅，不会移动卡牌' });
        }
    }

    /**
     * 翻阅：先问张数 → 只显示牌库顶 N 张
     * （取牌后不洗切 + 告知对方"翻到了这张" ✓；界面与落点动作与检索完全共用 ✓）
     */
    function peekDeck(deckType, anchorEl) {
        cancelSelection();
        const state = global.GameState.getState();
        const deck = state && state.players && state.players.self ? state.players.self[deckType] : null;
        if (!Array.isArray(deck) || deck.length === 0) {
            notify('牌库是空的', 'warning');
            return false;
        }
        if (!global.DeckTakeUI || !global.RevealPanelUI || !global.RevealPanelUI.askCount) {
            notify('取牌界面未加载，无法翻阅', 'error');
            return false;
        }
        global.RevealPanelUI.askCount({
            anchorEl: anchorEl || null,
            title: `翻阅${global.DeckTakeUI.zoneLabel(deckType)}几张？`,
            defaultValue: 1,
            onSubmit: (n) => global.DeckTakeUI.openPeek(deckType, n)
        });
        return true;
    }

    function toggleActive(card) {
        cancelSelection();
        if (!card) return;
        card.active = !card.active;
        if (global.UI && global.UI.applyCardMarkers) global.UI.applyCardMarkers();
        if (card.owner === 'self' && global.SyncManager && global.Network && global.Network.getState().isConnected) {
            global.SyncManager.sendPublicState('self');
        }
    }

    function modifyStats(card, anchorEl) {
        if (!card || !anchorEl) return;
        if (!card.cardData || card.cardData.type !== 'minion') {
            notify('只有随从卡可以修改攻防', 'warning');
            return;
        }

        const existing = document.querySelector('.stat-editor');
        if (existing) existing.remove();

        const StatManager = global.StatManager;
        const step = StatManager ? StatManager.getStep() : 1;

        const panel = document.createElement('div');
        panel.className = 'stat-editor';

        // ---- 头部：标题 + 卡名 ----
        const head = document.createElement('div');
        head.className = 'se-head';
        const title = document.createElement('span');
        title.className = 'se-title';
        title.textContent = '修改攻防';
        const name = document.createElement('span');
        name.className = 'se-name';
        name.textContent = card.cardData.name || '';
        head.append(title, name);
        panel.appendChild(head);

        // ---- 数值行：攻击 / 防御，各带 − 值 + ----
        const stats = document.createElement('div');
        stats.className = 'se-stats';
        const valueEls = {};

        const readValue = (key) => {
            if (key === 'attack') {
                return card.currentAttack != null ? card.currentAttack : (card.cardData.attack ?? 0);
            }
            return card.currentDefense != null ? card.currentDefense : (card.cardData.defense ?? 0);
        };

        [['攻击', 'attack', 'atk'], ['防御', 'defense', 'def']].forEach(([label, key, cls]) => {
            const row = document.createElement('div');
            row.className = `se-stat se-${cls}`;

            const k = document.createElement('span');
            k.className = 'se-k';
            k.textContent = label;

            const ctrl = document.createElement('div');
            ctrl.className = 'se-ctrl';

            const minus = document.createElement('button');
            minus.type = 'button';
            minus.className = 'se-btn se-minus';
            minus.textContent = '−';

            const val = document.createElement('span');
            val.className = 'se-val';

            const plus = document.createElement('button');
            plus.type = 'button';
            plus.className = 'se-btn se-plus';
            plus.textContent = '+';

            const apply = (sign) => {
                if (!StatManager) return;
                const delta = (StatManager.getStep() || 1) * sign;
                if (key === 'attack') StatManager.modifyAttack(card, delta);
                else StatManager.modifyDefense(card, delta);
                if (global.UI && global.UI.applyCardMarkers) global.UI.applyCardMarkers();
                refreshValues();
            };

            minus.addEventListener('click', (e) => { e.stopPropagation(); apply(-1); });
            plus.addEventListener('click', (e) => { e.stopPropagation(); apply(1); });

            ctrl.append(minus, val, plus);
            row.append(k, ctrl);
            stats.appendChild(row);
            valueEls[key] = val;
        });
        panel.appendChild(stats);

        // ---- 底部：步长选择（分段控件） ----
        const foot = document.createElement('div');
        foot.className = 'se-foot';
        const stepLabel = document.createElement('span');
        stepLabel.className = 'se-step-label';
        stepLabel.textContent = '步长';
        const steps = document.createElement('div');
        steps.className = 'se-steps';
        const stepButtons = [];

        [1, 3, 5, 10, 20].forEach(value => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'se-step' + (value === step ? ' is-active' : '');
            btn.textContent = value;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                StatManager?.setStep(value);
                stepButtons.forEach(b => b.classList.toggle('is-active', b === btn));
            });
            steps.appendChild(btn);
            stepButtons.push(btn);
        });
        foot.append(stepLabel, steps);
        panel.appendChild(foot);

        function refreshValues() {
            if (valueEls.attack) valueEls.attack.textContent = readValue('attack');
            if (valueEls.defense) valueEls.defense.textContent = readValue('defense');
        }
        refreshValues();

        document.body.appendChild(panel);
        positionMenu(panel, anchorEl);

        function close() {
            panel.remove();
            document.removeEventListener('mousedown', handleOutsideClick);
            document.removeEventListener('keydown', handleKeyDown);
        }
        function handleOutsideClick(e) {
            if (!panel.contains(e.target)) close();
        }
        function handleKeyDown(e) {
            if (e.key === 'Escape') close();
        }
        setTimeout(() => {
            document.addEventListener('mousedown', handleOutsideClick);
            document.addEventListener('keydown', handleKeyDown);
        }, 0);
    }

    /** 浮层定位：统一走 UIKit（原先 menuUI / 这里 / counterPopup 各写了一份重复实现） */
    function positionMenu(menuEl, anchorEl) {
        if (global.UIKit) global.UIKit.positionFloating(menuEl, anchorEl);
    }

    // ========== 菜单入口 ==========
    function playToFront(card) { card.faceDown = false; startSelection(card, 'frontField'); }

    // ===== 响应连锁：两个"产生时点"的动作入口（只广播，不改动任何数据） =====
    function declareAttack(card) {
        if (!card || !global.TimePointBus) return;
        global.TimePointBus.emit({
            type: 'attack:declare',
            actor: (card.controller || card.owner) === 'opponent' ? 'opponent' : 'self',
            card
        });
    }

    function activateEffect(card) {
        if (!card || !global.TimePointBus) return;
        global.TimePointBus.emit({
            type: 'minion:effect',
            actor: (card.controller || card.owner) === 'opponent' ? 'opponent' : 'self',
            card
        });
    }
    function activateToBack(card) { card.faceDown = false; startSelection(card, 'backField'); }
    function payToCost(card) { card.faceDown = false; startSelection(card, 'costZone'); }
    function setFaceDown(card) { startSelectionMultiZone(card, ['frontField', 'backField'], true); }

    global.MenuAction = {
        playToFront,
        activateToBack,
        payToCost,
        declareAttack,
        activateEffect,
        returnToHand,
        discard,
        exile,
        returnToDeck,
        setFaceDown,
        toggleFaceDown,
        returnToMainDeckTop,
        returnToMainDeckBottom,
        publicReveal,
        viewGraveyard,
        viewExile,
        searchDeck,
        peekDeck,
        // ★取牌入口：翻阅面板要复用它（以前没导出 → 翻阅里点"加入手牌/登场"没反应 ✗）
        takeCardFromDeck,
        viewDeck,
        // 转移控制权 / 复制卡牌的选格入口（见 js/core/controlManager.js）✓
        startSelectionOnSide,
        // 这两个是原有接口，必须保留 ✓
        cancelSelection,
        toggleActive,
        modifyStats
        // 注意：不再包含 startEquipSelection
    };
})(window);