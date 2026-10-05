// js/core/revealChannel.js
// 「展示 / 公开」唯一权威（新增）—— 把三类"给对看点东西"的动作统一成一种会话：
//
//   kind = 'peek'    翻阅：限定张数的检索界面（主牌库 / 费用牌库）
//                      · 可勾选「公开」→ 对方看到正面；不勾 → 对方只看到牌背 ✓
//                      · 可「数量 +1」→ 对方那边的张数与内容一起跟着变 ✓
//   kind = 'search'  检索告知：我方检索并取走某张牌 → 对方界面弹出那张牌 ✓
//   kind = 'hand'    手牌展示：我挑选手牌公开给对方看 ✓（侧栏「展示」按钮）
//
// 设计要点（解耦）：
//   · 只维护一份「当前展示会话」；UI 全部由 subscribe 驱动；本模块不认识任何 UI 细节 ✓
//   · 联机只发一种消息 reveal_sync（带 rev 逻辑时钟，取新者胜 ✓）
//   · ★信息隐藏：未公开时发出去的卡面被抹成"牌背信息"（连 cardId 都不发 ✓），
//     所以对方就算翻包也看不到牌面 ✓ —— 与响应连锁的盖伏牌同一套思路 ✓
//   · 任何一步失败都只记日志，绝不影响其它功能 ✓

(function(global) {
    const PROTOCOL = 1;

    let session = null;      // 本地视角的当前会话（null = 无）
    let rev = 0;             // 逻辑时钟（与 ChainManager 同思路：两端见过的最大值 +1 ✓）
    let listeners = [];

    function flip(side) { return side === 'self' ? 'opponent' : 'self'; }

    function isConnected() {
        const n = global.Network;
        return !!(n && n.getState && n.getState().isConnected);
    }

    function notify() {
        listeners.slice().forEach(fn => {
            try { fn(session); } catch (e) { console.error('[RevealChannel] 订阅者异常（已忽略）', e); }
        });
    }

    function log(text, type) {
        if (global.BattleLog && global.BattleLog.log) global.BattleLog.log(text, type || 'system');
    }

    function notifyUser(msg, type) {
        if (global.UI && global.UI.showNotification) global.UI.showNotification(msg, type || 'info');
    }

    function bumpRev() {
        rev = Math.max(rev, (session && Number(session.rev)) || 0) + 1;
        if (session) session.rev = rev;
        return rev;
    }

    /* ================= 卡面快照 ================= */

    /** 完整卡面（公开时用 ✓） */
    function fullSnapshot(instance) {
        if (!instance) return null;
        const data = instance.cardData
            || (global.CardLibrary && global.CardLibrary.getCardById(instance.cardId))
            || {};
        return {
            cardId: instance.cardId || data.id || null,
            instanceId: instance.instanceId || null,
            name: data.name || '未知卡牌',
            type: data.type || 'minion',
            cost: data.cost != null ? data.cost : null,
            attack: instance.currentAttack != null ? instance.currentAttack
                : (data.attack != null ? data.attack : null),
            defense: instance.currentDefense != null ? instance.currentDefense
                : (data.defense != null ? data.defense : null),
            color: data.color || null,
            effectText: data.effectText || data.description || '',
            faceDown: false,
            hidden: false
        };
    }

    /** 牌背信息（未公开时用 ✓）：只保留"这里有一张牌"，其余一概不给 ✓ */
    function hiddenSnapshot() {
        return {
            cardId: null,
            instanceId: null,
            name: null,
            type: undefined,
            cost: null,
            attack: null,
            defense: null,
            color: null,
            effectText: '',
            faceDown: true,
            hidden: true
        };
    }

    /** 按"是否公开"生成一批卡面快照 ✓ */
    function buildCards(instances, revealed) {
        return (instances || []).map(inst => (revealed ? fullSnapshot(inst) : hiddenSnapshot()));
    }

    /** 我方的牌库顶（index 0 = 顶 ✓，与 drawFromDeck 的 shift 一致） */
    function topOfDeck(zone, count) {
        const deck = myDeck(zone);
        if (!Array.isArray(deck)) return [];
        return deck.slice(0, Math.max(0, count));
    }

    function myDeck(zone) {
        const GS = global.GameState;
        const state = GS && GS.getState ? GS.getState() : null;
        return (state && state.players && state.players.self)
            ? state.players.self[zone] : null;
    }

    function deckSize(zone) {
        const deck = myDeck(zone);
        return Array.isArray(deck) ? deck.length : 0;
    }

    /* ================= 出网 ================= */

    /** 会话 → 对方视角（owner 翻转；卡面快照本身与视角无关 ✓） */
    function mirrorSession(s) {
        if (!s) return null;
        return {
            id: s.id,
            v: PROTOCOL,
            kind: s.kind,
            owner: flip(s.owner || 'self'),
            zone: s.zone || null,
            count: s.count || 0,
            revealed: !!s.revealed,
            stage: s.stage,
            phase: s.phase || null,                                  // ★翻阅：peeking / taken ✓
            taken: s.taken ? {                                       // ★取走的那张（正面告知 ✓）
                card: Object.assign({}, s.taken.card),
                destLabel: s.taken.destLabel || ''
            } : null,
            note: s.note || '',
            rev: s.rev,
            cards: (s.cards || []).map(c => Object.assign({}, c))
        };
    }

    function broadcast() {
        if (!global.Network || !isConnected() || !global.Network.sendMessage) return;
        try {
            global.Network.sendMessage(JSON.stringify({
                type: 'reveal_sync',
                v: PROTOCOL,
                rev: rev,
                session: mirrorSession(session)
            }));
        } catch (e) {
            console.error('[RevealChannel] 发送展示快照失败（已忽略）', e);
        }
    }

    /* ================= 公共构造（检索 / 翻阅 共用 ✓） ================= */

    const DECK_LABEL = {
        mainDeck: '主牌库', costDeck: '费用牌库', legendDeck: '传说牌库',
        graveyard: '墓场', exile: '放逐区'      // 查阅用 ✓
    };

    /** 牌库中文名（三处入口共用一份，避免各写一遍 ✓） */
    function zoneLabel(zone) { return DECK_LABEL[zone] || '牌库'; }

    /** 会话统一构造：默认值集中在这里，各入口只传差异字段 ✓ */
    function makeSession(fields) {
        const f = fields || {};
        return {
            id: f.id || ('rv_' + (f.kind || 'x') + '_' + Date.now()),
            kind: f.kind,
            owner: 'self',                      // 只有我方会新建会话 ✓
            zone: f.zone || null,
            count: f.count || 0,
            revealed: !!f.revealed,
            stage: f.stage || 'open',           // open=进行中 / closed=已完成（对方可确认 ✓）
            phase: f.phase || null,             // 翻阅专用：peeking / taken ✓
            taken: f.taken || null,             // 翻阅取走的那张（对方界面直接显示 ✓）
            note: f.note || '',
            cards: f.cards || [],
            rev: 0
        };
    }

    /* ================= 对外：翻阅 ================= */

    function clampCount(count, size) {
        const n = Math.max(1, Math.floor(Number(count) || 1));
        return size ? Math.min(n, size) : n;
    }

    /** 开始翻阅（我方是发起方 ✓）：从牌库顶取 N 张 ✓ */
    function startPeek(zone, count) {
        const size = deckSize(zone);
        if (!size) { notifyUser('牌库是空的', 'warning'); return false; }

        const n = clampCount(count, size);
        session = makeSession({
            kind: 'peek',
            zone: zone,
            count: n,
            revealed: false,                  // 默认不公开 → 对方只看牌背 ✓
            stage: 'open',
            phase: 'peeking',                 // peeking=正在翻看 / taken=刚取走一张 ✓
            note: `${zoneLabel(zone)} 翻阅`,
            cards: buildCards(topOfDeck(zone, n), false)
        });
        bumpRev();
        log(`我方翻阅${zoneLabel(zone)} ${n} 张（未勾选公开时对方只看到牌背）`, 'self');
        broadcast();
        notify();
        return true;
    }

    /** 数量 +1（对方同步 ✓） */
    function addCount(delta) {
        if (!session || session.owner !== 'self' || session.kind !== 'peek') return false;
        const size = deckSize(session.zone);
        const next = clampCount(session.count + (Number(delta) || 1), size);
        if (next === session.count) {
            notifyUser('已经翻到底了', 'warning');
            return false;
        }
        session.count = next;
        log(`我方翻阅数量 → ${next} 张`, 'self');
        refreshCards();
        return true;
    }

    /** 勾选 / 取消「公开」✓ */
    function setRevealed(v) {
        if (!session || session.owner !== 'self') return false;
        const next = !!v;
        if (session.revealed === next) return false;
        session.revealed = next;
        log(`我方${next ? '公开' : '取消公开'}了展示内容`, 'self');
        refreshCards();
        return true;
    }

    /**
     * ★「取走一张牌」的统一收口（检索 / 翻阅 / 查阅 共用 ✓）
     *   三者只差一个 kind：
     *     · 检索 → 新开一个"已完成"会话，内容就是这张牌 ✓
     *     · 查阅 → 同上（但事先不告知对方 ✓，仅查阅=纯私下 ✓）
     *     · 翻阅 → 就地转入 taken 阶段：对方界面从"牌库顶列表"切换成"这张牌" ✓
     * @param {object} opts { kind:'search'|'peek'|'browse', zone, destLabel, card }
     */
    function pushCardNotice(opts) {
        const o = opts || {};
        const card = o.card;
        if (!card) return false;

        const isPeek = o.kind === 'peek';
        const verb = isPeek ? '翻阅' : (o.kind === 'browse' ? '查阅' : '检索');
        const note = `${verb} ${zoneLabel(o.zone)}${o.destLabel ? ' → ' + o.destLabel : ''}`;

        if (isPeek) {
            if (!session || session.owner !== 'self' || session.kind !== 'peek') return false;
            session.phase = 'taken';
            session.taken = { card: fullSnapshot(card), destLabel: o.destLabel || '' };
            session.note = note;
            // 列表顺手刷新（牌库顶 N 张会顺延 ✓）；对方此刻看的是"那张牌" ✓
            session.count = clampCount(session.count, deckSize(session.zone));
            session.cards = buildCards(topOfDeck(session.zone, session.count), session.revealed);
        } else {
            session = makeSession({
                kind: o.kind === 'browse' ? 'browse' : 'search',
                zone: o.zone,
                count: 1,
                revealed: true,
                stage: 'closed',                 // ★已完成：对方看到牌 + 确认按钮 ✓
                note: note,
                cards: [fullSnapshot(card)]
            });
        }

        bumpRev();
        log(`我方${verb}取牌：${(card.cardData || {}).name || '未知'} → ${o.destLabel || '—'}（已告知对方）`, 'self');
        broadcast();
        notify();
        return true;
    }

    /** 翻阅取牌告知（对方界面切换成"翻到了这张" ✓） */
    function notePeekTaken(opts) {
        return pushCardNotice({
            kind: 'peek',
            zone: session && session.zone,
            destLabel: opts && opts.destLabel,
            card: opts && opts.card
        });
    }

    /** 查阅取牌告知（墓场 / 放逐区）—— 仅查阅不取牌时完全不会走到这里 ✓ */
    function noteBrowseTaken(opts) {
        return pushCardNotice({
            kind: 'browse',
            zone: opts && opts.zone,
            destLabel: opts && opts.destLabel,
            card: opts && opts.card
        });
    }

    /** 依据当前会话重算卡面（取走牌 / 数量变化后调用 ✓）并广播 */
    function refreshCards() {
        if (!session) return false;
        if (session.kind === 'peek') {
            session.count = clampCount(session.count, deckSize(session.zone));
            session.cards = buildCards(topOfDeck(session.zone, session.count), session.revealed);
        }
        bumpRev();
        broadcast();
        notify();
        return true;
    }

    /* ================= 对外：检索（进行中 / 已完成 两阶段） ================= */

    /**
     * 我方打开了检索面板 → 对方先看到「对方正在检索中，等待对方行动」✓
     * ★这一阶段不发任何牌面信息（cards 为空、连牌背都不给 ✓）
     */
    function startSearch(deckType) {
        session = makeSession({
            kind: 'search',
            zone: deckType || null,
            count: 0,
            revealed: true,
            stage: 'open',                  // 进行中：对方只看到等待提示 ✓
            note: `检索 ${zoneLabel(deckType)}`,
            cards: []                       // ★进行中不发任何牌面信息 ✓
        });
        bumpRev();
        log(`我方开始检索${zoneLabel(deckType)}（对方看到"等待对方行动"）`, 'self');
        broadcast();
        notify();
        return true;
    }

    /** 我方关掉了面板却没取牌（检索 / 查阅）→ 由 close() 统一收尾 ✓ */

    /* ================= 对外：检索告知（已完成） ================= */

    /** 检索告知（普通检索取走一张后 ✓）：与翻阅共用同一条收口 ✓ */
    function showSearchResult(opts) {
        return pushCardNotice({
            kind: 'search',
            zone: opts && opts.zone,
            destLabel: opts && opts.destLabel,
            card: opts && opts.card
        });
    }

    /* ================= 对外：手牌展示 ================= */

    /** 展示我方若干手牌（侧栏「展示」按钮 ✓） */
    function showHand(instances) {
        const list = (instances || []).filter(Boolean);
        if (!list.length) { notifyUser('没有选择要展示的手牌', 'warning'); return false; }

        session = {
            id: 'rv_hand_' + Date.now(),
            kind: 'hand',
            owner: 'self',
            zone: null,
            count: list.length,
            revealed: true,
            stage: 'closed',                 // 展示即"已完成" → 对方看到牌 + 确认按钮 ✓
            note: '手牌展示',
            cards: buildCards(list, true),
            rev: 0
        };
        bumpRev();
        log(`我方展示了 ${list.length} 张手牌`, 'self');
        broadcast();
        notify();
        return true;
    }

    /** 结束展示（我方主动收起 ✓）：★保留卡片内容 —— 对方要点「确认」后才关闭 ✓ */
    function close(reason) {
        if (!session) return false;
        if (session.owner !== 'self') return false;           // 对方发起的由对方收 ✓
        if (session.stage === 'closed') return false;         // 已收起 → 不重复广播 ✓
        const kind = session.kind;
        session.stage = 'closed';
        session.note = (session.note || '') + '（已结束）';    // 对方窗口据此显示"等待对方行动"→"请确认" ✓
        bumpRev();
        broadcast();
        notify();
        if (reason !== 'silent') log(kind === 'hand' ? '我方收起了手牌展示' : '我方结束了展示', 'self');
        return true;
    }

    /* ================= 收到对方的展示 ================= */

    function handle(msg) {
        if (!msg || msg.type !== 'reveal_sync') return;
        if (Number(msg.v || 1) > PROTOCOL) return;            // 对方协议更新 → 忽略 ✓

        const inRev = Number(msg.rev) || 0;
        if (inRev <= rev) return;                             // 旧快照 → 丢弃 ✓
        rev = inRev;

        const incoming = msg.session;                         // 对方发送前已镜像 → 直接可用 ✓
        if (!incoming) { session = null; notify(); return; }

        session = incoming;
        if (session.stage === 'open' && session.owner === 'opponent') {
            const who = session.kind === 'peek' ? '对方正在翻阅'
                : session.kind === 'hand' ? '对方展示了手牌' : '对方检索了';
            log(`${who}${session.note ? '（' + session.note + '）' : ''}`, 'opponent');
        }
        notify();
    }

    /* ================= 查询 / 订阅 ================= */

    function getSession() { return session; }
    function isMine() { return !!session && session.owner === 'self'; }
    function isOpen() { return !!session && session.stage === 'open'; }

    /** 我方翻阅会话里正在展示的【真实卡牌实例】（我方自己渲染用 ✓） */
    function myVisibleInstances() {
        if (!session || session.owner !== 'self') return [];
        if (session.kind === 'peek') return topOfDeck(session.zone, session.count);
        return [];
    }

    function subscribe(fn) {
        if (typeof fn !== 'function') return function() { };
        listeners.push(fn);
        try { fn(session); } catch (e) { console.error(e); }
        return function unsub() {
            const i = listeners.indexOf(fn);
            if (i !== -1) listeners.splice(i, 1);
        };
    }

    global.RevealChannel = {
        // 我方操作
        startPeek,
        notePeekTaken,
        startSearch,
        noteBrowseTaken,
        addCount,
        setRevealed,
        refreshCards,
        showSearchResult,
        showHand,
        close,
        // 联机
        handle,
        // 查询
        getSession,
        isMine,
        isOpen,
        myVisibleInstances,
        subscribe,
        // 工具（调试 / 测试用 ✓）
        fullSnapshot,
        hiddenSnapshot,
        buildCards,
        topOfDeck,
        mirrorSession
    };
})(window);
