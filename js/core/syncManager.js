// js/core/syncManager.js
// 同步管理模块：监听游戏状态变化，通过节流方式发送同步消息，并处理接收到的同步数据
// 修改：使用 requestAnimationFrame 节流，自动抽牌期间忽略远程 self 同步

(function(global) {
    let initialized = false;
    let applyingRemote = false;
    let syncScheduled = false;

    function init() {
        if (initialized) return;
        initialized = true;
        if (global.GameState && global.GameState.addListener) {
            global.GameState.addListener(onGameStateChanged);
        }
    }

    function onGameStateChanged() {
        if (applyingRemote) return;
        if (syncScheduled) return; // 已经安排了同步，等待执行

        syncScheduled = true;
        requestAnimationFrame(() => {
            syncScheduled = false;
            sendPublicState('self');
        });
    }

    function sendPublicState(player = 'self') {
        const { GameState, Network } = global;
        if (!GameState || !Network) return;
        if (!Network.getState() || !Network.getState().isConnected) return;

        const publicState = GameState.getPublicState(player);
        if (publicState) {
            Network.sendMessage(JSON.stringify({
                type: 'sync_state',
                player: player,
                data: publicState
            }));
        }
    }

    function handleSyncMessage(msg) {
        const { GameState } = global;
        if (!GameState) return;

        // 自动抽牌期间，忽略针对本地自己的同步更新，防止状态被覆盖
        if (window.__isAutoDrawing && msg.player === 'opponent') {
            return;
        }

        applyingRemote = true;
        if (msg.player === 'self') {
            // 对方发来的是他自己的状态，对应到本地就是对手
            GameState.setPublicState('opponent', msg.data);
        } else if (msg.player === 'opponent') {
            // 对方发来的是他眼中的对手（也就是本地玩家自己）的状态
            GameState.setPublicState('self', msg.data);
        }
        applyingRemote = false;
        if (global.UI && global.UI.refreshAll) {
            global.UI.refreshAll();
        }
    }

    function sendFullSync() {
        sendPublicState('self');
    }

    global.SyncManager = {
        init,
        handleSyncMessage,
        sendFullSync,
        sendPublicState
    };
})(window);