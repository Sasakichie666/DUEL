// js/core/cardHandoverChannel.js
// 卡牌交牌通道（重构后【唯一】的一条）：把一张牌交给对方 / 放进对方的区域
//
// 为什么需要它：
//   公共状态同步只描述"各自的区域"，对手的手牌内容本来也是保密的 ✗；
//   所以只要"一张牌要落到对方那边"（对方战场 / 手牌 / 墓场 / 放逐 / 牌库），
//   对方本地都不存在它 → 必须直接把这张牌的数据发过去，由对方自己放好 ✓
//
// 协议：{ type: 'card_handover', card: 快照, zone, index, atTop }
//   zone: 'hand' | 'frontField' | 'backField' | 'graveyard' | 'exile' | 'mainDeck' | 'costDeck' | 'legendDeck'
//   · 战场格需要【半场镜像换算】（两端半场左右相反：0↔4 ✓）
//   · 牌库用 atTop 区分回顶 / 回底 ✓
//
// 约定（与 controlManager 的控制权规则一致，这里只有一个分支都没有 ✓）：
//   · 快照字段一律按【接收方】视角写（self = 接收方 ✓）
//   · 到手后 controller 一律写 'self'：
//       落到战场/手牌 → 由接收方控制 ✓
//       落到牌堆（墓场/放逐/牌库）→ 已离开战场，控制权复位为所有者 ✓
//         （牌堆里的牌一定属于所在方 ✓ 所以 'self' 就是正确答案 ✓）
//
// 安全性：只接受 CardLibrary 里存在的 cardId（卡面数据以本端卡库为准 ✓）

(function(global) {
    const FIELD_SIZE = 5;
    const BATTLE_ZONES = ['frontField', 'backField'];
    const PILE_ZONES = ['graveyard', 'exile', 'mainDeck', 'costDeck', 'legendDeck'];

    /** 发起方视角的格下标 ↔ 接收方真实下标（半场镜像：0↔4, 1↔3, 2↔2 ✓） */
    function mirrorIndex(index) {
        const i = Number(index);
        if (!Number.isFinite(i) || i < 0 || i >= FIELD_SIZE) return -1;
        return FIELD_SIZE - 1 - i;
    }

    /** 卡牌实例 → 接收方视角的快照（owner 翻转；不传 controller，由接收方决定 ✓） */
    function snapshot(card) {
        const flip = s => (s === 'self' ? 'opponent' : (s === 'opponent' ? 'self' : s));
        return {
            cardId: card.cardId,
            instanceId: card.instanceId,            // 保留实例 id：两端"同一张牌"才算同一张 ✓
            owner: flip(card.owner || 'self'),
            origin: card.origin || null,
            faceDown: !!card.faceDown,
            active: card.active !== false,
            enteredThisTurn: !!card.enteredThisTurn,
            currentAttack: card.currentAttack ?? null,
            currentDefense: card.currentDefense ?? null,
            traits: card.traits ? [...card.traits] : [],
            customTexts: card.customTexts ? [...card.customTexts] : []
        };
    }

    /** 由快照在本端造出实例（卡面数据取自本端卡库 ✓） */
    function instantiate(snap) {
        const inst = global.GameState.createCardInstance(snap.cardId, 'self');
        if (snap.instanceId) inst.instanceId = snap.instanceId;    // ★保持一致，标记 / 特效才对得上 ✓
        inst.owner = (snap.owner === 'self' || snap.owner === 'opponent') ? snap.owner : 'opponent';
        inst.controller = 'self';                                  // 到手即由我控制（牌堆=复位为所有者 ✓）
        inst.origin = (snap.origin === 'transfer' || snap.origin === 'copy') ? snap.origin : null;
        inst.faceDown = !!snap.faceDown;
        inst.active = snap.active !== false;
        inst.enteredThisTurn = !!snap.enteredThisTurn;
        inst.currentAttack = snap.currentAttack ?? inst.currentAttack;
        inst.currentDefense = snap.currentDefense ?? inst.currentDefense;
        inst.traits = snap.traits ? [...snap.traits] : [];
        inst.customTexts = snap.customTexts ? [...snap.customTexts] : [];
        return inst;
    }

    /**
     * 发起方调用：把这张牌交给对方（或放进对方的区域）
     * @param {object} card 卡牌实例（调用时仍是我方状态 ✓）
     * @param {object} opts { zone, index?, atTop? }
     */
    function handover(card, opts) {
        if (!card || !opts || !opts.zone) return false;
        const { Network } = global;
        if (!Network || !Network.getState || !Network.getState().isConnected) {
            return false;      // 单机模式：没有对手可交付 ✓
        }
        Network.sendMessage(JSON.stringify({
            type: 'card_handover',
            card: snapshot(card),
            zone: opts.zone,
            index: typeof opts.index === 'number' ? opts.index : 0,
            atTop: !!opts.atTop
        }));
        return true;
    }


    /**
     * 把实例放进对应区域（唯一的一处落地逻辑 ✓）
     * · 手牌 / 战场：一定落在"接收方（我）"这边 ✓
     * · 牌堆（墓场/放逐/牌库）：按【归属】落位 —— 我的牌进我的堆；
     *   对方的牌进"我这边对方镜像堆"（我只是同步镜像，对方才是权威 ✓）
     *   ★牌堆不变量：控制权 = 所有者（牌堆里不再区分控制者 ✓ 与重构规则一致 ✓）
     */
    function placeInto(inst, zone, msg, state) {
        const me = state.players.self;
        const peer = state.players.opponent;

        if (zone === 'hand') {
            me.hand.push(inst);
            inst.zone = 'hand';
            inst.zoneIndex = me.hand.length - 1;
            if (global.CardActions && global.CardActions.updateHandCounts) {
                global.CardActions.updateHandCounts(me);
            }
            return true;
        }

        if (BATTLE_ZONES.indexOf(zone) >= 0) {
            const arr = me[zone];
            if (!Array.isArray(arr)) return false;
            let index = mirrorIndex(msg.index);                       // 半场镜像换算 ✓
            if (index < 0 || arr[index]) index = arr.findIndex(cell => !cell);   // 兜底：第一个空位 ✓
            if (index < 0) return false;
            arr[index] = inst;
            inst.zone = zone;
            inst.zoneIndex = index;
            return true;
        }

        if (PILE_ZONES.indexOf(zone) >= 0) {
            const target = (inst.owner === 'self') ? me : peer;       // 按归属落位 ✓
            const arr = target && target[zone];
            if (!Array.isArray(arr)) return false;

            inst.controller = inst.owner;                             // ★牌堆不变量 ✓
            if (zone === 'graveyard' || zone === 'exile' || !msg.atTop) {
                arr.push(inst);
                inst.zoneIndex = arr.length - 1;
            } else {
                arr.unshift(inst);                                    // 回牌库顶 ✓
                inst.zoneIndex = 0;
                for (let i = 1; i < arr.length; i++) arr[i].zoneIndex = i;
            }
            inst.zone = zone;
            return true;
        }

        return false;
    }

    /** 接收方调用（由 main.js 的消息分发转进来） */
    function handle(msg) {
        const { GameState, CardLibrary } = global;
        if (!GameState || !GameState.getState()) return;
        const state = GameState.getState();
        const me = state.players && state.players.self;
        const snap = msg && msg.card;
        if (!me || !snap || !snap.cardId) return;
        if (CardLibrary && !CardLibrary.getCardById(snap.cardId)) return;   // 本端卡库没有这张卡 → 忽略 ✓

        // 先清掉本机可能残留的同 id 实例（避免重复显示 / 重复入堆 ✓）
        if (global.CardActions && global.CardActions.removeCardFromAnywhere) {
            global.CardActions.removeCardFromAnywhere(snap.instanceId);
        }

        const inst = instantiate(snap);
        if (!placeInto(inst, msg.zone, msg, state)) return;

        // 按同一规则整理来源标记：已复位（不在战场且控制权=所有者）→ 删掉「转」✓
        if (global.ControlManager && global.ControlManager.syncOriginTag) {
            global.ControlManager.syncOriginTag(inst, inst.zone);
        }

        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
        // 回一次同步：让发起方那边的"我的手牌数 / 我的战场 / 我的牌堆"立刻正确 ✓
        if (global.SyncManager && global.SyncManager.sendPublicState) {
            global.SyncManager.sendPublicState('self');
        }
        if (global.UI && global.UI.showNotification) {
            global.UI.showNotification('收到对方移交的卡牌', 'info');
        }
    }

    global.CardHandoverChannel = { handover, handle, mirrorIndex };
})(window);
