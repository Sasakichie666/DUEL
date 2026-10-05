// js/core/chainManager.js
// 响应连锁管理器 —— 纯「协调层」：不改动任何游戏数据（卡牌移动/数值仍由玩家用现有 UI 手动完成），
// 只负责：① 感知时点；② 生成"时点窗口"并在双方界面呈现；③ 记录响应序列（序列1/2/3…）。
//
// 本地视角约定：窗口里所有 side 字段都以本端为 'self' 存储；
// 发送/接收时整体镜像一次（mirrorWindow），两端各自看到"我/对方"。
//
// 状态机：
//   phase 'targeting'：行动方在选目标（另一方看到「对方正在选择目标…」）
//   phase 'deciding' ：另一方决定 响应 / 略过 /（可阻挡时）阻挡
//   响应 → 追加序列 + 角色互换；阻挡 → 追加序列 + 攻击箭头转黄改指
//   phase 'resolving'：没人再响应了，进入【处理阶段】——
//       从"序列值最大"的效果发动者开始，逐个回滚处理（后发先至，同堆栈结算）：
//       该发动者点「处理」→ 该序列销毁（其箭头同步消失）→ 回到上一个（更小）序列
//       → …全部序列销毁后，双方一起关闭响应界面。
//
// 注：实现约定 —— "序列销毁"= 从 links 数组中移除该段，UI 的箭头完全由 links 派生，
//     所以销毁后箭头自然消失，不需要额外通知。

(function(global) {
    const PROTOCOL_VERSION = 1;

    let enabled = true;
    let current = null;          // 本地视角的当前窗口（null = 无窗口）
    let rev = 0;                 // 单调递增版本号

    /* ================= 基础工具 ================= */

    function flip(side) { return global.ChainTarget ? global.ChainTarget.flipSide(side) : (side === 'self' ? 'opponent' : 'self'); }
    function sideLabel(side) { return global.ChainTarget ? global.ChainTarget.sideLabel(side) : (side === 'self' ? '我方' : '对方'); }
    function rules() { return global.ChainRules; }

    function isConnected() {
        const n = global.Network;
        return !!(n && n.getState && n.getState().isConnected);
    }

    function notify() {
        listeners.slice().forEach(fn => {
            try { fn(current); } catch (e) { console.error('[ChainManager] 订阅者异常（已忽略）', e); }
        });
    }

    function log(text, type) {
        if (global.BattleLog && global.BattleLog.log) global.BattleLog.log(text, type || 'system');
    }

    let listeners = [];

    /* ================= 目标（统一委托给 ChainTarget：目标语义的唯一事实来源） ================= */

    function T() { return global.ChainTarget; }

    function normalizeTarget(raw) { return T() ? T().normalize(raw) : null; }
    function normalizeTargets(list) { return T() ? T().normalizeList(list) : []; }
    function flipTarget(t) { return T() ? T().flip(t) : null; }

    /**
     * 统一的 rev 递增 —— 逻辑时钟（Lamport）。
     * 永远写成"本端见过的最大 rev + 1"，保证这次更新对方一定接受；
     * 避免两端各自计数导致 rev 撞车后互相丢弃快照（症状：只看到自己的箭头）。
     */
    function bumpRev(win) {
        const w = win || current;
        rev = Math.max(rev, (w && Number(w.rev)) || 0) + 1;
        if (w) w.rev = rev;
        return rev;
    }

    const FORCE_REASONS = ['manual', 'disconnect', 'reset', 'endTurn', 'disabled', 'debug', 'force'];
    const PHASE_RANK = { targeting: 0, deciding: 1, resolving: 2 };

    /**
     * 唯一实例：窗口 id 由「事件内容 + 时间桶」推导，而不是随机数。
     * 这样两端即使因各自收到时点事件而同时开窗，得到的 id 也相同
     * → 天然是"同一个实例"，后续只会收敛，绝不会长期并存两份。
     */
    function makeWindowId(timePoint, actor, cardInstanceId) {
        const bucket = Math.floor(Date.now() / 5000);
        return ['cw', timePoint, actor, cardInstanceId || '-', bucket].join('_');
    }

    /** 进度评分：阶段靠后优先；处理阶段"序列越少越靠后"（因为处理阶段只会销毁），其他阶段"越多越靠后"（只会追加） */
    function progressOf(win) {
        const rank = PHASE_RANK[win.phase] || 0;
        const n = (win.links || []).length;
        return { rank, spread: win.phase === 'resolving' ? -n : n };
    }

    /**
     * 两端几乎同时改动时的【对称合并】——结果与参数顺序无关（可交换），
     * 两端各算一次得到的状态必然相同：
     *   · 主体（阶段/轮次/sequence 列表）取"进度更靠后"的一方
     *     —— 这样既能表达"追加了新序列"，也能表达"序列已处理销毁"（并集会复活已销毁的序列，所以不用并集）
     *   · 只把另一方的 targets 并进【同一个 seq】里（选目标时谁点的都不丢）
     */
    function mergeWindows(a, b) {
        const pa = progressOf(a);
        const pb = progressOf(b);
        let aWin;
        if (pa.rank !== pb.rank) aWin = pa.rank > pb.rank;
        else if (pa.spread !== pb.spread) aWin = pa.spread > pb.spread;
        else aWin = String(a.id || '') <= String(b.id || '');
        const w = aWin ? a : b;
        const o = aWin ? b : a;

        const links = (w.links || []).map(l => Object.assign({}, l, { targets: (l.targets || []).slice() }));
        (o.links || []).forEach(ol => {
            const dl = links.find(x => x.seq === ol.seq);
            if (!dl) return;
            const list = dl.targets || (dl.targets = []);
            (ol.targets || []).forEach(t => { if (!list.some(x => x.key === t.key)) list.push(t); });
            if (!dl.card && ol.card) dl.card = ol.card;
            if (!dl.desc && ol.desc) dl.desc = ol.desc;
            if (ol.blocked && !dl.blocked) {
                dl.blocked = true; dl.blockedBy = ol.blockedBy; dl.blockedBySide = ol.blockedBySide;
            }
        });

        const seqs = [a.resolveSeq, b.resolveSeq].filter(v => v != null);
        return {
            id: String(a.id || '') <= String(b.id || '') ? a.id : b.id,
            v: w.v || PROTOCOL_VERSION,
            timePoint: w.timePoint,
            rev: Math.max(Number(a.rev) || 0, Number(b.rev) || 0),
            host: w.host || w.initiator,
            initiator: w.initiator,
            responder: w.responder,
            activeSide: w.activeSide,
            decideSide: w.decideSide,
            phase: w.phase,
            status: 'awaiting',
            resolveSeq: w.phase === 'resolving'
                ? (seqs.length ? Math.min.apply(null, seqs) : null)
                : (w.resolveSeq != null ? w.resolveSeq : null),
            allowBlock: w.phase === 'resolving' ? false : w.allowBlock,
            links: links.sort((x, y) => x.seq - y.seq)
        };
    }

    /**
     * 出网前的卡面快照整理（★信息隐藏）
     *   只要快照标了 hideFront（= 盖伏登场那种"还没公开过"的盖牌）⇒ 对方只该看到「牌背」
     *   → 抹掉一切能看出身份的信息（名称 / 费用 / 攻防 / 效果文本 / 实例 id ✓，
     *     连类型也不给：类型会影响牌背配色，等于变相泄露"主牌库 / 费用牌库"✗）
     * 只作用于【发出去的那一份】：本地窗口不动，所以发起方自己始终看得见正面 ✓
     *
     * 什么时候会标 hideFront（见 cardSnapshot）：
     *   · 从手牌翻盖到战场（盖伏登场）→ 隐藏 ✓（对方只看到牌背）
     *   · 场上翻盖（正面盖下去 / 从反面翻到正面）→ 不隐藏 ✓（这两次对方都该看到正面）
     */
    function outboundCard(card) {
        if (!card || !card.hideFront) return card;      // 不隐藏（含"翻盖"两次亮正面）→ 原样发 ✓
        return {
            faceDown: true,
            hideFront: true,          // 保留标记：对方再转发/重开窗时依旧只给牌背 ✓
            cardId: null,
            id: null,
            name: null,
            type: undefined,
            cost: null,
            attack: null,
            defense: null,
            color: null,
            effectText: ''
        };
    }

    /**
     * ★保护本端自己那段链的卡面数据
     * 修 bug（盖伏登场后对方略过 → 轮到我处理时卡面变空白 ✗）：
     *   盖伏登场时发给对方的是「牌背快照」（hideFront，卡名/费用/攻防等已被抹掉 ✓），
     *   对方略过 / 确认目标后会把整份窗口广播回来 ✗ → 里面那张卡是抹过的 ✗
     *   → 若直接采用，我本地这段（我自己发动的）卡面也变成空白数据 ✗
     * 处理：合并时，凡"对方那份被抹过、而我这份是完整的" → 回填我这份 ✓
     *   （card 只是展示数据，不参与状态机判定，所以两端这一行显示不同也没关系 ✓）
     */
    function keepLocalCardData(incoming, local) {
        if (!incoming || !local || !(incoming.links || []).length) return incoming;
        const links = incoming.links.map(inc => {
            if (!inc) return inc;
            const mine = (local.links || []).find(l => l && l.seq === inc.seq);
            if (!mine) return inc;
            const incMasked = !!(inc.card && inc.card.hideFront && !inc.card.name);
            const mineFull = !!(mine.card && mine.card.name);
            return (incMasked && mineFull) ? Object.assign({}, inc, { card: mine.card }) : inc;
        });
        return Object.assign({}, incoming, { links: links });
    }

    /** 卡面快照：让对方也能渲染卡牌详情（不依赖对方卡库一定同版本） */
    function cardSnapshot(instance, opts) {
        if (!instance) return null;
        const data = instance.cardData
            || (global.CardLibrary && global.CardLibrary.getCardById(instance.cardId))
            || {};
        return {
            instanceId: instance.instanceId || null,
            cardId: instance.cardId || data.id || null,
            id: instance.cardId || data.id || null,
            name: data.name || '未知卡牌',
            // ★盖伏标记：对方据此只渲染牌背（出网时身份信息会被 outboundCard 抹掉 ✓）
            faceDown: !!instance.faceDown,
            // ★是否隐藏正面：
            //   · 默认：盖着就当牌背（对方看不到正面信息 ✓）
            //   · 只有【翻盖（toggle）】这一次要亮正面 → 开窗时传 { revealFace: true }
            //   （需求：从手牌翻盖到战场 = 盖伏登场 → 隐藏；场上把正面盖下去 / 从反面翻到正面 → 亮正面 ✓）
            hideFront: !!instance.faceDown && !(opts && opts.revealFace),
            type: data.type || 'minion',
            cost: data.cost != null ? data.cost : null,
            attack: instance.currentAttack != null ? instance.currentAttack
                : (data.attack != null ? data.attack : null),
            defense: instance.currentDefense != null ? instance.currentDefense
                : (data.defense != null ? data.defense : null),
            color: data.color || null,
            effectText: data.effectText || data.description || ''
        };
    }
    /* ================= 窗口读写 ================= */

    function getWindow() { return current; }
    function isOpen() { return !!current; }

    function computeAllowBlock(win) {
        const R = rules();
        if (!win || !R) return false;
        const rule = R.get(win.timePoint);
        if (!rule || !rule.allowBlock) return false;
        // 攻击段把目标指向了响应方的头像 → 响应方可以阻挡
        const first = win.links[0];
        const targets = (first && first.targets) || [];
        return targets.some(t => t && t.type === 'avatar' && t.side === win.responder);
    }

    /* ================= 打开窗口（由时点事件驱动） ================= */

    function openFromEvent(event, opts) {
        if (!enabled || !event || !event.type) return false;
        const force = !!(opts && opts.force);        // 调试模式：允许单窗口打开
        const R = rules();
        if (!R) return false;

        const timePoint = R.fromBusType(event.type);
        if (!timePoint) return false;
        if (current) return false;                    // 同屏只允许一个窗口
        if (!global.UI || !global.UI.isGameStarted || !global.UI.isGameStarted()) return false;
        if (global.MulliganManager && global.MulliganManager.isActive && global.MulliganManager.isActive()) return false;
        if (window.__isEquipSelecting) return false;  // 装备选择中不打扰

        const rule = R.get(timePoint);
        if (!rule) return false;

        const actor = event.actor === 'opponent' ? 'opponent' : 'self';

        // ★盖伏登场那种"还没公开过"的盖牌：对方不该看到正面信息（战报里也不写卡名 ✓）
        //   场上翻盖（toggle）是把"已经公开过的牌"翻面 → 这两次都亮正面 ✓
        const hideFace = !!(event.card && event.card.faceDown && event.reason !== 'toggle');

        // ★唯一实例：只有"我自己的动作"才允许开窗；对方的动作一律等快照同步过来。
        //   这样两端绝不会各开一个实例、各看各的箭头（debugOpen 的强制模式除外）。
        if (!force && actor !== 'self') {
            console.log('[ChainManager] 对方的时点事件，等待对方开窗后同步（本端不自行开窗）:', timePoint);
            return false;
        }

        // 未联机：只写战报，不弹面板（否则没有对手可响应，窗口无法收尾）
        if (!force && !isConnected()) {
            const nm = (event.card && !hideFace) ? ((event.card.cardData || {}).name) : null;
            log(`${sideLabel(actor)}${rule.label}${nm ? '：「' + nm + '」' : ''}（未联机，仅记录）`, actor);
            return false;
        }

        const needTargets = R.needsTargets(timePoint);

        current = {
            // 唯一实例：id 由「事件内容 + 时间桶」推导（两端一致），并记下主持方
            id: makeWindowId(timePoint, actor, event.card && event.card.instanceId),
            host: actor,
            v: PROTOCOL_VERSION,
            timePoint,
            rev: 0,                                   // 由 bumpRev 赋值（逻辑时钟）
            initiator: actor,
            responder: flip(actor),
            activeSide: actor,                        // 正在选目标的一方
            decideSide: flip(actor),                  // 有决策权（响应/略过）的一方
            phase: needTargets ? 'targeting' : 'deciding',
            status: 'awaiting',                       // awaiting | closed
            resolveSeq: null,                         // 处理阶段：当前正在处理的序列号
            allowBlock: false,
            links: [{
                seq: 1,
                actor,
                kind: 'action',
                timePoint,
                desc: rule.summary,
                // 翻盖（toggle）= 场上翻面：这一次对方也该看到正面 → revealFace ✓
                // 盖伏登场（enter）与其它时点：盖着就只给牌背 ✓
                card: cardSnapshot(event.card, { revealFace: event.reason === 'toggle' }),
                targets: normalizeTargets(event.targets)
            }]
        };
        bumpRev(current);                       // 逻辑时钟：这次开窗拥有"最新"的 rev
        current.allowBlock = computeAllowBlock(current);

        const first = current.links[0];
        // ★盖伏登场的牌不写卡名：这条战报会转发给对方，写了就等于泄露正面信息 ✓
        const nameText = (first.card && !first.card.hideFront && first.card.name)
            ? '：「' + first.card.name + '」' : '';
        log(`${sideLabel(actor)}${rule.label}${nameText}（序列 1）`, actor);
        broadcast();
        notify();
        return true;
    }

    /* ================= 目标选择（仅行动方可用） ================= */

    /**
     * 当前「正在进行的动作」的时点。
     * 注意：响应（发动战术牌/随从效果/阻挡）会追加新的链段，
     * 此后目标选择必须按【该链段】的时点判定，而不是窗口最初的时点
     * （例如：对方"随从登场"我没法选目标，但我响应发动战术牌后就能选了）。
     */
    function activeTimePoint(win) {
        const w = win || current;
        if (!w) return null;
        const links = w.links || [];
        const last = links[links.length - 1];
        return (last && last.timePoint) || w.timePoint;
    }

    /** 序列值最大的链段（= 最后被发动、处理阶段要最先结算的那个） */
    function maxSeq(win) {
        const links = (win && win.links) || [];
        return links.reduce((m, l) => (l && l.seq > m ? l.seq : m), 0);
    }

    function findLink(win, seq) {
        const links = (win && win.links) || [];
        return links.find(l => l && l.seq === seq) || null;
    }

    function toggleTarget(target) {
        if (!current || current.status !== 'awaiting') return false;
        if (current.phase !== 'targeting') return false;

        const t = normalizeTarget(target);
        if (!t) return false;

        const R = rules();
        const tp = activeTimePoint(current);
        if (R && !R.isTargetLegal(tp, current.activeSide, t)) return false;

        const link = current.links[current.links.length - 1];
        const list = link.targets || (link.targets = []);
        const i = list.findIndex(x => x.key === t.key);
        if (i === -1) list.push(t); else list.splice(i, 1);

        bumpRev(current);
        current.allowBlock = computeAllowBlock(current);
        broadcast();
        notify();
        return true;
    }

    /** 行动方确认目标选择 → 交给对方决策 */
    function confirmTargets() {
        if (!current || current.status !== 'awaiting' || current.phase !== 'targeting') return false;
        current.phase = 'deciding';
        bumpRev(current);
        broadcast();
        notify();
        return true;
    }
    /* ================= 响应 / 略过 / 阻挡 ================= */

    /**
     * 我方响应：发动战术牌 或 随从发动效果
     * @param {string} kind 'tactic' | 'minionEffect'
     * @param {object} instance 卡牌实例
     */
    function respondLocal(kind, instance) {
        if (!current || current.status !== 'awaiting') return false;
        if (current.decideSide !== 'self' || current.phase !== 'deciding') return false;
        if (!instance) return false;

        const R = rules();
        const rule = R ? R.get(current.timePoint) : null;
        const allowed = (rule && rule.responses) || ['tactic', 'minionEffect'];
        if (!allowed.includes(kind)) return false;

        const isTactic = kind === 'tactic';
        const newTimePoint = isTactic ? 'TACTIC_ACTIVATE' : 'MINION_EFFECT';
        current.links.push({
            seq: current.links.length + 1,
            actor: 'self',
            kind,
            timePoint: newTimePoint,
            desc: isTactic ? '我方响应并发动了战术牌' : '我方响应并发动了随从效果',
            card: cardSnapshot(instance),
            targets: []
        });
        advanceTurn(current);

        const card = current.links[current.links.length - 1].card;
        const respText = (card && !card.hideFront && card.name) ? '「' + card.name + '」' : '';
        log(`我方响应：${isTactic ? '发动战术牌' : '发动随从效果'}${respText}（序列 ${current.links.length}）`, 'self');
        broadcast();
        notify();
        return true;
    }

    /**
     * 我方略过：不再直接关闭窗口，而是进入【处理阶段】。
     * 之后双方按"序列值最大 → 最小"逐个回滚处理（见 resolveLocal）。
     */
    function passLocal() {
        if (!current || current.status !== 'awaiting') return false;
        if (current.decideSide !== 'self' || current.phase !== 'deciding') return false;
        log(`我方略过响应（共 ${current.links.length} 段），进入处理阶段`, 'self');
        return beginResolving('passed');
    }

    /* ================= 「忽略时点」自动略过（新增） ================= */
    // 需求：玩家可在侧栏「响应」里勾选忽略某些时点 —— 对方发动该时点时我方不再被询问，
    //       直接略过并进入处理阶段（也就是"直接进入对方的处理阶段"✓）。
    // 判定三个条件同时成立才自动略过：
    //   ① 窗口正等我决策（phase === 'deciding' 且 decideSide === 'self'）
    //   ② 当前正在进行的动作（最后一段链）是【对方】发起的 ✓
    //   ③ 该时点在我的忽略清单里（js/core/responsePrefs.js ✓）

    /** 该时点是否被我方勾选忽略 */
    function isTimePointIgnored(key) {
        return !!(global.ResponsePrefs && global.ResponsePrefs.isIgnored
            && global.ResponsePrefs.isIgnored(key));
    }

    /** 现在是否应该"按忽略设置自动略过" */
    function shouldAutoPassIgnored(win) {
        const w = win || current;
        if (!w || w.status !== 'awaiting' || w.phase !== 'deciding') return false;
        if (w.decideSide !== 'self') return false;

        const links = w.links || [];
        const last = links[links.length - 1];
        if (!last || last.actor !== 'opponent') return false;    // 只忽略"对方的时点"✓（自己的动作不可能被忽略 ✓）

        return isTimePointIgnored(activeTimePoint(w));
    }

    /**
     * 按忽略设置自动略过 → 直接进入处理阶段（返回是否真的略过了 ✓）
     * 会照常 broadcast：对方那边同步进入处理阶段 ✓
     */
    function autoPassIgnored(win) {
        if (!shouldAutoPassIgnored(win)) return false;
        const w = win || current;
        const tp = activeTimePoint(w);
        const R = rules();
        const rule = R ? R.get(tp) : null;
        const name = rule ? rule.label : tp;

        log(`已勾选忽略「${name}」时点 → 自动略过，直接进入处理阶段`, 'system');
        if (global.UI && global.UI.showNotification) {
            global.UI.showNotification(`已忽略「${name}」时点，直接进入处理阶段`, 'info');
        }
        return beginResolving('ignored');
    }

    /* ================= 处理阶段（序列逆序结算，后发先至） ================= */

    /**
     * 进入处理阶段：从序列值最大的效果发动者开始逐个处理。
     * 玩家要在棋盘上手动完成该效果，然后点「处理」销毁这一序列。
     */
    function beginResolving(reason) {
        if (!current || current.status !== 'awaiting') return false;
        if (current.phase === 'resolving') return false;
        current.phase = 'resolving';
        current.allowBlock = false;
        current.resolveSeq = maxSeq(current);
        bumpRev(current);

        const link = findLink(current, current.resolveSeq);
        const reasonText = reason === 'passed' ? '略过'
            : (reason === 'ignored' ? '按忽略设置自动略过' : '无人响应');
        log(`响应连锁结束（${reasonText}），进入处理阶段：`
            + `从序列 ${current.resolveSeq}（${link ? sideLabel(link.actor) : '—'}）开始逐个处理`, 'system');
        broadcast();
        notify();
        return true;
    }

    let lastResolveAt = 0;      // 防连点：一次点击只允许销毁一个序列

    /**
     * 我方点「处理」：当前序列结算完毕 → 该序列销毁（其箭头随之消失）
     * → 回到上一个（更小的）序列继续处理 → 全部销毁后双方一起关闭。
     */
    function resolveLocal() {
        if (!current || current.status !== 'awaiting') return false;
        if (current.phase !== 'resolving') return false;

        const link = findLink(current, current.resolveSeq);
        if (!link) return false;
        if (link.actor !== 'self') return false;              // 只能由该序列的发动者处理

        const now = Date.now();
        if (now - lastResolveAt < 400) return false;          // 防连点
        lastResolveAt = now;

        const seq = link.seq;
        current.links.splice(current.links.indexOf(link), 1);  // 序列销毁：箭头由 links 派生 → 同步消失
        log(`序列 ${seq} 处理完毕并销毁（剩余 ${current.links.length} 段）`, 'self');

        if (!current.links.length) {
            log('所有序列处理完毕，响应连锁结束', 'system');
            lastResolveAt = Date.now();
            return closeWindow('resolved');
        }

        current.resolveSeq = maxSeq(current);
        bumpRev(current);
        const next = findLink(current, current.resolveSeq);
        if (next) log(`回滚到序列 ${next.seq}（${sideLabel(next.actor)}），等待其处理`, 'system');
        broadcast();
        notify();
        return true;
    }

    /** 我方（响应方）宣言阻挡：仅当攻击目标是"我方头像"时可用 */
    function declareBlockLocal(minionInstanceId) {
        if (!current || current.status !== 'awaiting') return false;
        if (!current.allowBlock) return false;
        if (current.decideSide !== 'self' || current.phase !== 'deciding') return false;

        const R = rules();
        const t = normalizeTarget({ type: 'card', instanceId: minionInstanceId, side: 'self' });
        if (R && !R.isTargetLegal('BLOCK_DECLARE', 'self', t)) return false;

        // 攻击段：指向我方头像的箭头改为指向我方阻挡随从（颜色 red → yellow）
        const atk = current.links[0];
        if (atk && Array.isArray(atk.targets)) {
            const idx = atk.targets.findIndex(x => x.type === 'avatar' && x.side === 'self');
            if (idx !== -1) {
                atk.targets.splice(idx, 1);
                atk.blockedBy = minionInstanceId;
                atk.blockedBySide = 'self';
                atk.blocked = true;                 // 供 UI 把该段箭头画成黄色
            }
        }

        current.links.push({
            seq: current.links.length + 1,
            actor: 'self',
            kind: 'block',
            timePoint: 'BLOCK_DECLARE',
            desc: '我方宣言阻挡',
            card: cardSnapshot(findInstance(minionInstanceId)),
            targets: [t]
        });
        current.allowBlock = false;
        advanceTurn(current);

        const blk = current.links[current.links.length - 1].card;
        // 盖伏的阻挡者同样不写卡名（战报会转发给对方 ✓）
        const blkText = (blk && !blk.hideFront && blk.name) ? '（' + blk.name + '）' : '';
        log(`我方宣言阻挡${blkText}，对方可继续响应（序列 ${current.links.length}）`, 'self');
        broadcast();
        notify();
        return true;
    }

    /** 推进：响应/阻挡后角色互换（本项目不存在"自己的时点自己响应"） */
    function advanceTurn(win) {
        const R = rules();
        const last = win.links[win.links.length - 1];
        win.activeSide = last.actor;
        win.decideSide = flip(last.actor);
        win.phase = (R && R.needsTargets(last.timePoint)) ? 'targeting' : 'deciding';
        bumpRev(win);
    }

    /** 按 instanceId 找本地实例（显示阻挡者卡面用）—— 统一走 CardActions.findCardInstance */
    function findInstance(instanceId) {
        if (!instanceId) return null;
        const CA = global.CardActions;
        if (CA && CA.findCardInstance) {
            const hit = CA.findCardInstance(instanceId);
            return hit ? hit.card : null;
        }
        return null;
    }

    /* ================= 关闭 ================= */

    /**
     * 关闭窗口。
     * ★规则：只要还有序列没处理完，双方都不能关闭响应界面（自动关闭一律被拒）；
     *   只有"强制理由"（✕ 强关 / 断线 / 重置 / 回合结束 / 调试）才允许提前关闭。
     */
    function closeWindow(reason) {
        if (!current) return false;
        const forced = FORCE_REASONS.indexOf(reason) !== -1;
        const remain = (current.links || []).length;
        if (remain > 0 && !forced) {
            console.log('[ChainManager] 还有 ' + remain + ' 个序列未处理，不关闭响应界面');
            log(`还有 ${remain} 个序列未处理，响应界面保持打开`, 'system');
            return false;
        }
        current.status = 'closed';
        current.closeReason = reason || 'closed';
        bumpRev(current);
        broadcast();                 // 先广播终态，让对方一起收起
        current = null;
        notify();
        return true;
    }

    /** 外部强制关闭（断线 / 结束回合 / 重开） */
    function forceClose(reason) {
        if (!current) return false;
        const txt = reason === 'disconnect' ? '对方已断开，响应连锁结束'
            : reason === 'reset' ? '对局重置，响应连锁结束'
                : reason === 'endTurn' ? '回合结束，响应连锁结束'
                    : '响应连锁已结束';
        log(`${txt}（共 ${current.links.length} 段）`, 'system');
        return closeWindow(reason || 'force');
    }
    /* ================= 联机同步（整窗快照 + rev，天然幂等） ================= */

    /** 本地窗口 → 发送用的镜像窗口（side 全部翻转） */
    function mirrorWindow(win) {
        if (!win) return null;
        return {
            id: win.id,
            v: win.v || PROTOCOL_VERSION,
            timePoint: win.timePoint,
            rev: win.rev,
            host: flip(win.host || win.initiator),                        // 主持方（唯一实例）也要镜像
            initiator: flip(win.initiator),
            responder: flip(win.responder),
            activeSide: flip(win.activeSide),
            decideSide: flip(win.decideSide),
            phase: win.phase,
            status: win.status,
            closeReason: win.closeReason || null,
            resolveSeq: win.resolveSeq != null ? win.resolveSeq : null,   // 序列号不需要翻转
            allowBlock: win.allowBlock,
            links: (win.links || []).map(l => Object.assign({}, l, {
                actor: flip(l.actor),
                card: outboundCard(l.card),        // ★盖伏的牌只发"牌背信息"，对方看不到正面 ✓
                targets: (l.targets || []).map(flipTarget),
                blockedBySide: l.blockedBySide ? flip(l.blockedBySide) : undefined
            }))
        };
    }

    function broadcast() {
        if (!current || !isConnected() || !global.Network) return;
        const payload = mirrorWindow(current);
        try {
            global.Network.sendMessage(JSON.stringify({
                type: 'chain_sync',
                v: PROTOCOL_VERSION,
                rev: payload.rev,
                window: payload
            }));
        } catch (e) {
            console.error('[ChainManager] 发送连锁快照失败（已忽略）', e);
        }
    }

    /**
     * 收到对方的连锁快照。
     * 注意：对方发来前已经镜像过一次（把"他的视角"翻成"我的视角"），
     * 所以这里直接整体采用，绝对不能再镜像一次 —— 否则双方视角会变成一模一样。
     *
     * rev 判定（这是"双方箭头不同步"的关键）：
     *   rev <  本端 → 旧快照，丢弃
     *   rev == 本端 → 撞车（两端各自开窗后几乎同时点击）：
     *                  ① 能合并就合并（targets 取并集，谁的选择都不丢）
     *                  ② 否则按 "id 小者胜" 确定性收敛（两端算出的结果一致）
     *   rev >  本端 → 直接采用
     */
    /**
     * 收到对方的连锁快照（唯一实例：两端共用同一份状态，本端只是其中一份副本）。
     * 关键原则 —— **绝不静默丢弃对方的更新**，否则就会出现"只看到自己的箭头"：
     *   rev 更旧      → 丢弃（确实是过期包）
     *   rev 相同      → 对称合并（并集，谁的选择都不丢；两端结果一致）
     *   rev 更新      → 直接采用
     * 另外：对方想关闭时，若本端还有未处理的序列且不是强制理由 → 拒绝关闭。
     */
    function handleRemote(msg) {
        if (!enabled || !msg || msg.type !== 'chain_sync' || !msg.window) return;
        const incoming = msg.window;
        if (Number(incoming.v || 1) > PROTOCOL_VERSION) return;      // 对方协议更新 → 忽略

        const inRev = Number(incoming.rev) || 0;
        const localRev = current ? (Number(current.rev) || 0) : rev;
        if (inRev < localRev) return;                                // 旧快照 → 丢弃

        // 关闭请求：只有"对方那边确实已经没有序列了"（或强制关闭）才允许一起收起，
        // 否则说明双方进度不一致 → 拒绝关闭，并把对方的序列并过来保持同步。
        if (incoming.status === 'closed') {
            const inLinks = (incoming.links || []).length;
            const myLinks = current ? (current.links || []).length : 0;
            const forced = FORCE_REASONS.indexOf(incoming.closeReason) !== -1;
            if (!forced && inLinks > 0 && myLinks > 0) {
                console.log('[ChainManager] 对方请求关闭，但还有 ' + myLinks + ' 个序列未处理 → 拒绝关闭');
                current = mergeWindows(current, incoming);
                notify();
                return;
            }
            rev = Math.max(rev, inRev);
            current = null;
            log('响应连锁结束', 'system');
            notify();
            return;
        }

        rev = Math.max(rev, inRev);

        if (!current) {                       // 本端还没有窗口 → 直接采用（这就是"跟随对方实例"）
            current = incoming;
            notify();
            autoPassIgnored();                // ★该时点被我勾选忽略 → 直接略过、进入处理阶段 ✓
            return;
        }

        // 两端都有窗口：更新的直接采用；同 rev（几乎同时操作）→ 对称合并
        // ★采用/合并前先保护本端自己那段链的卡面：对方手里那份是"牌背快照"，
        //   不能让它覆盖我本地这份完整数据（否则处理阶段卡面会变空白 ✗）
        current = keepLocalCardData(inRev > localRev ? incoming : mergeWindows(current, incoming), current);
        notify();
        autoPassIgnored();                    // ★对方确认目标 / 继续响应之后，若在忽略清单里就直接略过 ✓
    }

    /* ================= 订阅 ================= */

    function subscribe(fn) {
        if (typeof fn !== 'function') return function() {};
        listeners.push(fn);
        try { fn(current); } catch (e) { console.error(e); }
        return function unsub() {
            const i = listeners.indexOf(fn);
            if (i !== -1) listeners.splice(i, 1);
        };
    }

    /* ================= 开关 / 初始化 / 调试 ================= */

    function setEnabled(v) {
        enabled = !!v;
        if (!enabled && current) forceClose('disabled');
        return enabled;
    }
    function isEnabled() { return enabled; }

    let prefsSubscribed = false;

    function init() {
        if (!global.TimePointBus) {
            console.warn('[ChainManager] TimePointBus 未加载，连锁系统停用');
            return false;
        }
        global.TimePointBus.on(openFromEvent);

        // 忽略清单变化时立刻复查：如果当前窗口正等我决策、而这个时点刚被勾选忽略 → 立即略过 ✓
        if (!prefsSubscribed && global.ResponsePrefs && global.ResponsePrefs.subscribe) {
            prefsSubscribed = true;
            global.ResponsePrefs.subscribe(function onPrefsChanged() {
                autoPassIgnored();
            });
        }
        console.log('[ChainManager] 响应连锁系统已就绪');
        return true;
    }

    /**
     * 单窗口调试入口：本地开一个窗口方便调 UI（不联机也能看效果）
     * @param {string} timePoint MINION_ENTER | TACTIC_ACTIVATE | MINION_EFFECT | ATTACK_DECLARE | FLIP_DECLARE
     * @param {string} actor 'self' | 'opponent'
     */
    function debugOpen(timePoint, actor) {
        const R = rules();
        if (!R || !R.get(timePoint)) return false;
        const a = actor === 'opponent' ? 'opponent' : 'self';   // 默认"我方是行动方"，便于直接试目标选择与箭头
        // 时点 → 总线 type 的反查统一走 ChainRules（新增时点只需改那份表 ✓）
        const busType = (R.toBusType && R.toBusType(timePoint))
            || ['minion:enter', 'tactic:activate', 'minion:effect', 'attack:declare', 'flip:declare']
                .find(k => R.fromBusType(k) === timePoint);
        if (!busType) return false;

        const GS = global.GameState;
        const p = GS && GS.getPlayerState ? GS.getPlayerState(a) : null;
        const pool = p ? [].concat(p.hand || [], p.frontField || [], p.backField || []).filter(Boolean) : [];
        if (current) forceClose('debug');
        return openFromEvent({ type: busType, actor: a, card: pool[0] || null }, { force: true });
    }

    global.ChainManager = {
        init,
        // 查询
        getWindow,
        isOpen,
        isEnabled,
        setEnabled,
        subscribe,
        activeTimePoint,
        maxSeq,
        findLink,
        // 本地操作
        toggleTarget,
        confirmTargets,
        respondLocal,
        passLocal,
        declareBlockLocal,
        resolveLocal,
        forceClose,
        // 忽略时点（侧栏「响应」按钮 → 自动略过）
        isTimePointIgnored,
        shouldAutoPassIgnored,
        autoPassIgnored,
        // 联机
        handleRemote,
        // 调试
        debugOpen
    };
})(window);
