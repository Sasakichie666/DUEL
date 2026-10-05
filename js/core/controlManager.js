// js/core/controlManager.js
// 控制权管理器（新增）：转移控制权 / 复制卡牌 的**唯一权威实现**
//
// 概念（模块化核心）：
//   owner      —— 所有者：这张牌归谁。进墓 / 放逐 / 回库 一律回到【所有者】的对应区域 ✓
//   controller —— 控制者：现在谁能操作它。默认 = owner；「转移」只改 controller，不改 owner ✓
//   origin     —— 来源标记：null | 'transfer'（被转移来的）| 'copy'（复制出来的）→ 卡面特效框 ✓
//
// 用法（其它模块只调用这里的 API，不自己拼逻辑 ✓）：
//   ControlManager.isMine(card)                      // 我能不能操作它（权限判断统一入口）
//   ControlManager.emptySlots('opponent', 'frontField')  // 对方的空格
//   ControlManager.transferToField(card, index)      // 把控制权连卡一起交给对方，放进对方第 index 格
//   ControlManager.transferToHand(card)              // 把这张牌交给对方（进对方手牌）
//   ControlManager.copyToField(card, index)          // 复制对方场上的卡，放进我方第 index 格
//   ControlManager.copyToHand(card)                  // 复制对方场上的卡，进我方手牌
//
// 联机：转移涉及把牌交到对方区域/手牌，本地无法凭空生成 → 统一走 CardHandoverChannel ✓

(function(global) {
    const SIDES = ['self', 'opponent'];

    /** 前场固定 5 格（与 gameState.createPlayerState 一致） */
    const FIELD_SIZE = 5;

    const other = side => (side === 'self' ? 'opponent' : 'self');

    // ================= 基础查询 =================

    /** 当前控制者（老数据没有 controller 时回退 owner，再回退 self） */
    function getController(card) {
        if (!card) return null;
        return card.controller || card.owner || 'self';
    }

    /** 这张牌现在是否由我方控制（= 我能否操作它） */
    function isMine(card) {
        return getController(card) === 'self';
    }

    /**
     * 来源标记整理：控制权已复位 → 删掉「转」标签 ✓
     *   · 只在"不在战场 且 controller === owner"（= 已复位）时清理 ✓
     *   · 'copy'（复制体）是这张牌的永久属性 → 一律保留 ✓
     */
    function syncOriginTag(card, zone) {
        if (!card) return;
        if (zone === 'frontField' || zone === 'backField') return;              // 战场上保留 ✓
        if (card.controller && card.owner && card.controller !== card.owner) return;  // 仍受对方控制 → 保留 ✓
        if (card.origin === 'transfer') card.origin = null;                    // 已复位 → 删除「转」✓
    }

    /**
     * 需要「控制权复位」的去向：进墓 / 放逐 / 回库（主牌库·费用牌库·传说牌库）✓
     *   —— 只有这类"离场归档"的去向，才把控制权交还【所有者】✓
     */
    const CONTROL_RESET_ZONES = ['graveyard', 'exile', 'mainDeck', 'costDeck', 'legendDeck'];

    /**
     * 进墓 / 放逐 / 回库（进库前）→ 控制权复位为【所有者】✓
     *
     * 规则（★按需求修订）：
     *   · 进墓 / 放逐 / 回库                        → 复位为所有者（牌回到所有者的对应区域 ✓）
     *   · 回手 / 费用区 / 个人区 / 公共区 / 战场内移动 → 【保留控制权】✓
     *
     * 为什么「回手」必须保留控制权：
     *   转移来的牌被当前控制者「回手」后，它应该和「转移到对方手牌」的牌一样，
     *   仍由当前控制者正常使用（登场 / 发动 / 装备 / 转移）✓
     *   旧规则一离开战场就复位 ✗ → 牌明明进了控制者的手牌，却挂着他人的控制权 →
     *   点它弹不出菜单、也拖不动，等于一张废卡 ✗
     *
     * 调用点：cardActions.placeCardInZone() 与 returnCardToDeckTop/Bottom()（所有放置出口 ✓）
     */
    function resetControlOnLeave(card, toZone) {
        if (!card) return;
        if (CONTROL_RESET_ZONES.indexOf(toZone) >= 0 &&
            card.controller && card.controller !== card.owner) {
            card.controller = card.owner || 'self';      // 复位 ✓
        }
        syncOriginTag(card, toZone);                     // ★复位后删「转」；未复位则保留「转」✓
    }

    /** 设置来源标记（'transfer' | 'copy' | null），供卡面特效框使用 */
    function setOrigin(card, kind) {
        if (!card) return;
        card.origin = (kind === 'transfer' || kind === 'copy') ? kind : null;
    }

    function playerState(side) {
        const state = global.GameState && global.GameState.getState();
        if (!state || !state.players) return null;
        return state.players[side] || null;
    }

    /** 某方某区域的空位下标数组（只支持格子区域；内部使用 ✓） */
    function rawEmptySlots(side, zone) {
        const ps = playerState(side);
        if (!ps) return [];
        const arr = ps[zone];
        if (!Array.isArray(arr)) return [];
        const out = [];
        arr.forEach((cell, i) => { if (!cell) out.push(i); });
        return out;
    }

    /** 对外：某方某区域的空位下标数组 */
    function emptySlots(side, zone) {
        return rawEmptySlots(side, zone);
    }

    function hasEmptySlot(side, zone) {
        return rawEmptySlots(side, zone).length > 0;
    }

    /** 多个区域里是否还有空位（战场 = 前场 + 后场 ✓） */
    function hasEmptySlotIn(side, zones) {
        return (Array.isArray(zones) ? zones : [zones]).some(z => hasEmptySlot(side, z));
    }

    function notify(msg, type) {
        if (global.UI && global.UI.showNotification) global.UI.showNotification(msg, type || 'info');
    }

    /** 统一收尾：刷新界面 + 让对手看到（自己的状态变了） */
    function settle(silentSync) {
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
        if (silentSync) return;
        if (global.SyncManager && global.SyncManager.sendPublicState) {
            global.SyncManager.sendPublicState('self');
        }
    }

    // ================= 转移控制权 =================

    /** 战场包含的区域（转移 / 复制时可以落到其中任意一格 ✓） */
    const FIELD_ZONES = ['frontField', 'backField'];

    /**
     * 把「我控制的这张牌」的控制权交给对方，并放到对方战场的指定格
     * @param {object} card
     * @param {string} zone  'frontField'（前场）| 'backField'（后场）
     * @param {number} index 目标格下标
     * @returns {boolean}
     */
    function transferToField(card, zone, index) {
        // 兼容旧调用：transferToField(card, index) → 默认前场
        if (typeof zone === 'number') { index = zone; zone = 'frontField'; }
        const toZone = FIELD_ZONES.indexOf(zone) >= 0 ? zone : 'frontField';

        if (!card || !isMine(card)) {
            notify('只能转移自己控制的卡牌', 'warning');
            return false;
        }
        const targetSide = other(getController(card));
        const ps = playerState(targetSide);
        if (!ps || !Array.isArray(ps[toZone])) {
            notify('目标区域不可用', 'warning');
            return false;
        }
        if (!hasEmptySlotIn(targetSide, FIELD_ZONES)) {
            notify('对方战场没有空位，无法转移', 'warning');
            return false;
        }
        if (ps[toZone][index]) {
            notify('目标格子已被占用', 'warning');
            return false;
        }

        // 本地：把这张牌移进"对方半场"的指定格（moveCard 的 toPlayer 选项 ✓ 不传就保持原行为）
        const ok = global.CardActions.moveCard(card.instanceId, toZone, index, { toPlayer: targetSide });
        if (!ok) {
            notify('转移失败', 'error');
            return false;
        }

        card.controller = targetSide;          // 控制权移交（所有者不变 ✓）
        setOrigin(card, 'transfer');

        // 把这张牌交给对方（他们本地还没有它）+ 让对手看到
        if (global.CardHandoverChannel) {
            global.CardHandoverChannel.handover(card, { zone: toZone, index: index });
        }
        settle();
        notify(`已将「${cardName(card)}」的控制权交给对方（${toZone === 'frontField' ? '前场' : '后场'}）`, 'success');
        return true;
    }

    /**
     * 把「我控制的这张牌」交给对方（进入对方手牌）
     * 手牌内容不参与公共状态同步 → 必须走 CardHandoverChannel 直接把牌交过去 ✓
     */
    function transferToHand(card) {
        if (!card || !isMine(card)) {
            notify('只能转移自己控制的卡牌', 'warning');
            return false;
        }
        const targetSide = other(getController(card));
        const ps = playerState(targetSide);
        if (!ps) return false;

        card.controller = targetSide;
        setOrigin(card, 'transfer');

        // 先把快照交给对方（此时卡还在我的区域里，数据完整 ✓）
        if (global.CardHandoverChannel) {
            global.CardHandoverChannel.handover(card, { zone: 'hand' });
        }

        // 本地：从我方区域移除这张牌，并让"对方手牌数"+1（我这边只统计数量）
        if (global.CardActions.removeCardFromAnywhere) {
            global.CardActions.removeCardFromAnywhere(card.instanceId);
        }
        const data = card.cardData || (global.CardLibrary && global.CardLibrary.getCardById(card.cardId));
        if ((data && data.type) === 'cost') ps.handCostCount = (ps.handCostCount || 0) + 1;
        else ps.handMainCount = (ps.handMainCount || 0) + 1;

        settle();
        notify(`已将「${cardName(card)}」交给对方（进入对方手牌）`, 'success');
        return true;
    }

    function cardName(card) {
        const data = card && (card.cardData || (global.CardLibrary && global.CardLibrary.getCardById(card.cardId)));
        return (data && data.name) || '未知卡牌';
    }

    // ================= 复制卡牌 =================

    /** 用一张"模板卡"的卡面与状态造一张新实例（归我方所有/控制） */
    function buildCopy(card, side) {
        const inst = global.GameState.createCardInstance(card.cardId, side);
        if (card.cardData) inst.cardData = card.cardData;      // 卡面数据（名称/费用/效果等）原样 ✓
        inst.traits = card.traits ? [...card.traits] : [];
        inst.customTexts = card.customTexts ? [...card.customTexts] : [];
        inst.currentAttack = card.currentAttack ?? inst.currentAttack;
        inst.currentDefense = card.currentDefense ?? inst.currentDefense;
        inst.active = card.active !== false;
        inst.faceDown = false;                                  // 复制出来默认正面 ✓
        inst.controller = side;                                 // 控制者 = 我方 ✓
        inst.owner = side;                                      // 所有者 = 我方 ✓（进墓等回我方 ✓）
        setOrigin(inst, 'copy');
        return inst;
    }

    /**
     * 复制「对方场上的卡」，放进我方战场指定格（所有者/控制者都是我方 ✓）
     * @param {string} zone 'frontField'（前场）| 'backField'（后场）
     */
    function copyToField(card, zone, index) {
        if (typeof zone === 'number') { index = zone; zone = 'frontField'; }
        const toZone = FIELD_ZONES.indexOf(zone) >= 0 ? zone : 'frontField';

        if (!card) return false;
        // ★自己 / 对方的卡都能复制（复制出来的永远归我方所有/控制 ✓）
        const ps = playerState('self');
        if (!ps || !Array.isArray(ps[toZone]) || ps[toZone][index]) {
            notify('目标格子已被占用', 'warning');
            return false;
        }

        const inst = buildCopy(card, 'self');
        ps[toZone][index] = inst;
        inst.zone = toZone;
        inst.zoneIndex = index;
        // 只有进【前场】才带「本回合进入战场」标记（与正常登场的口径一致 ✓）
        inst.enteredThisTurn = (toZone === 'frontField');

        settle();
        notify(`已复制「${cardName(card)}」到你的${toZone === 'frontField' ? '前场' : '后场'}`, 'success');
        return true;
    }

    /** 复制「对方场上的卡」→ 进入我方手牌（所有者/控制者都是我方 ✓） */
    function copyToHand(card) {
        if (!card) return false;
        // ★自己 / 对方的卡都能复制（复制出来的永远归我方所有/控制 ✓）
        const ps = playerState('self');
        if (!ps) return false;

        const inst = buildCopy(card, 'self');
        ps.hand.push(inst);
        inst.zone = 'hand';
        inst.zoneIndex = ps.hand.length - 1;
        if (global.CardActions.updateHandCounts) global.CardActions.updateHandCounts(ps);

        settle();
        notify(`已复制「${cardName(card)}」到你的手牌`, 'success');
        return true;
    }

    global.ControlManager = {
        getController,
        isMine,
        setOrigin,
        resetControlOnLeave,
        syncOriginTag,
        CONTROL_RESET_ZONES,
        emptySlots,
        hasEmptySlot,
        hasEmptySlotIn,
        FIELD_ZONES,
        transferToField,
        transferToHand,
        copyToField,
        copyToHand,
        FIELD_SIZE
    };
})(window);
