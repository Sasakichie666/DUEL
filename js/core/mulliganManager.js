// js/core/mulliganManager.js
// 起始手牌调度（Mulligan）流程管理：
//   1) 先后手决定完成 → 弹出「起始手牌」界面（4 张），并提示你是先手/后手
//      （此时手牌区不渲染牌，牌只在该界面展示；容器占位保留，界面不位移）
//   2) 玩家点击卡牌标记「替换」→ 点「确认保留」
//   3) 被标记的牌放回主牌库底，再从牌库顶补抽，直到保留的手牌数为 4 张
//   4) 双方都点过「确认保留」后调度结束 → 恢复手牌区渲染，并开始抽开局牌：
//      费用牌（先手 4 张 / 后手 5 张）；后手额外多抽 1 张手牌

(function(global) {
    let state = {
        active: false,        // 调度阶段进行中
        isFirst: false,       // 本地玩家是否先手
        myConfirmed: false,   // 我方已确认保留
        oppConfirmed: false   // 对手已确认保留
    };
    let oppConfirmedEarly = false;   // 对手的确认比我方界面更早到达时先记下来

    function isActive() { return state.active; }
    function amFirst() { return state.isFirst; }

    /** 手牌区容器（战斗视图为懒构建，取不到时回退到 id 查询） */
    function handEl() {
        if (global.UI && global.UI.els && global.UI.els.selfHand) return global.UI.els.selfHand;
        return document.getElementById('self-hand');
    }

    /** 调度期间：隐藏手牌区内容（容器仍占位，界面不位移） */
    function setHandHidden(hidden) {
        const el = handEl();
        if (el) el.classList.toggle('mulligan-hidden', !!hidden);
    }

    /** 对局开始即隐藏手牌区（起始手牌只在「起始手牌」界面展示，调度结束后才渲染） */
    function hideHand() { setHandHidden(true); }
    function showHand() { setHandHidden(false); }

    /**
     * 进入调度阶段（由 main.js 在先后手决定完成后调用）
     * @param {object}  options
     * @param {boolean} options.isFirst 本地玩家是否先手
     */
    function start(options) {
        const opts = options || {};
        const GameState = global.GameState;
        if (!GameState || !GameState.getState()) return;
        const player = GameState.getPlayerState('self');
        if (!player) return;

        // 未联机时直接视为对手已确认，方便本地走完整流程
        const Network = global.Network;
        const connected = !!(Network && Network.getState && Network.getState().isConnected);

        state = {
            active: true,
            isFirst: !!opts.isFirst,
            myConfirmed: false,
            oppConfirmed: !connected || oppConfirmedEarly
        };
        oppConfirmedEarly = false;

        // 起始手牌 = 手牌中的主牌（费用牌尚未抽取，不会混入）
        const hand = (player.hand || []).filter(Boolean);

        // 调度期间手牌区不渲染牌（牌只在「起始手牌」界面里出现）
        setHandHidden(true);
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();

        if (global.BattleLog) {
            global.BattleLog.log(
                `起始手牌调度开始：${state.isFirst ? '你先手' : '你后手'}，起手 ${hand.length} 张`,
                'turn'
            );
        }

        if (global.MulliganUI) {
            global.MulliganUI.show({ cards: hand, isFirst: state.isFirst, onConfirm: confirm });
        } else {
            confirm([]);   // 兜底：没有界面则默认全部保留
        }
    }

    /**
     * 我方确认保留
     * @param {string[]} replacedIds 标记为「替换」的卡牌 instanceId 列表
     */
    function confirm(replacedIds) {
        if (!state.active || state.myConfirmed) return;
        state.myConfirmed = true;

        const GameState = global.GameState;
        const CardActions = global.CardActions;
        const player = GameState.getPlayerState('self');
        const ids = Array.isArray(replacedIds) ? replacedIds : [];

        const replaced = ids
            .map(id => (player.hand || []).find(c => c && c.instanceId === id))
            .filter(Boolean);

        let drawn = 0;
        // 复用手动同步锁：避免替换/补抽期间被对手发来的旧状态覆盖
        const prevLock = window.__isAutoDrawing;
        window.__isAutoDrawing = true;
        try {
            replaced.forEach(card => {
                CardActions.returnCardToDeckBottom('self', 'mainDeck', card);   // 替换牌 → 主牌库底
            });
            const keepCount = (player.hand || []).filter(Boolean).length;
            const need = Math.max(0, GameState.INITIAL_HAND_SIZE - keepCount);
            if (need > 0) {
                drawn = CardActions.drawFromDeck('self', 'mainDeck', need).length;   // 牌库顶补足
            }
        } finally {
            window.__isAutoDrawing = !!prevLock;
        }

        if (global.BattleLog) {
            global.BattleLog.log(
                replaced.length > 0
                    ? `调度：替换 ${replaced.length} 张放回主牌库底，从牌库顶补抽 ${drawn} 张`
                    : '调度：4 张起始手牌全部保留',
                'self'
            );
        }

        if (global.SyncManager && global.SyncManager.sendPublicState) {
            global.SyncManager.sendPublicState('self');
        }
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
        if (global.MulliganUI) global.MulliganUI.markWaiting();

        // 告知对手：我方已确认保留
        const Network = global.Network;
        if (connectedNow()) {
            Network.sendMessage(JSON.stringify({ type: 'mulligan_done' }));
        }
        maybeFinish();
    }

    /** 收到对手的「已确认保留」 */
    function handleOpponentDone() {
        oppConfirmedEarly = true;          // 防止对手确认早于我方界面弹出而丢失
        if (!state.active) return;
        state.oppConfirmed = true;
        if (global.MulliganUI) global.MulliganUI.markOpponentReady();
        maybeFinish();
    }

    function connectedNow() {
        const Network = global.Network;
        return !!(Network && Network.getState && Network.getState().isConnected);
    }

    /** 双方都确认 → 结束调度，恢复手牌区渲染，进入开局抽牌 */
    function maybeFinish() {
        if (!state.active || !state.myConfirmed || !state.oppConfirmed) return;
        state.active = false;
        if (global.MulliganUI) global.MulliganUI.hide();
        setHandHidden(false);        // 调度结束才渲染手牌区
        drawOpeningCards();
    }

    /** 开局抽牌：费用牌（先手 4 / 后手 5）；后手额外多抽 1 张手牌 */
    function drawOpeningCards() {
        const CardActions = global.CardActions;
        const costCount = state.isFirst ? 4 : 5;

        const prevLock = window.__isAutoDrawing;
        window.__isAutoDrawing = true;
        try {
            CardActions.drawFromDeck('self', 'costDeck', costCount);
            if (!state.isFirst) {
                CardActions.drawFromDeck('self', 'mainDeck', 1);   // 后手补偿：多抽一张手牌
            }
        } finally {
            window.__isAutoDrawing = !!prevLock;
        }

        if (global.BattleLog) {
            global.BattleLog.log(
                state.isFirst
                    ? `调度结束（先手）：抽费用牌 ${costCount} 张`
                    : `调度结束（后手）：抽费用牌 ${costCount} 张 + 手牌 1 张`,
                'self'
            );
        }
        if (global.SyncManager && global.SyncManager.sendPublicState) {
            global.SyncManager.sendPublicState('self');
        }
        if (global.UI) {
            if (global.UI.refreshAll) global.UI.refreshAll();
            if (global.UI.updateTurnUI) global.UI.updateTurnUI();
            if (global.UI.showNotification) {
                global.UI.showNotification(
                    state.isFirst
                        ? `起始手牌确定：费用牌 ${costCount} 张`
                        : `起始手牌确定：费用牌 ${costCount} 张 + 1 张手牌`,
                    'success'
                );
            }
        }
    }

    global.MulliganManager = {
        start,
        confirm,
        handleOpponentDone,
        hideHand,
        showHand,
        isActive,
        amFirst
    };
})(window);
