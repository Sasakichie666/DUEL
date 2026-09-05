// js/core/turnManager.js
// 回合管理模块：负责先后手决定流程（投掷点数、比较、选择先后手）及回合切换，并处理第三回合开始的自动抽牌
// 修改：确保回合开始时重置活跃状态后刷新UI，并保持同步

(function(global) {
    let state = {
        phase: 'idle',        // idle | rolling | rolled | choosing | done
        myRoll: null,
        opponentRoll: null,
        winner: null,
        firstPlayer: null,    // 本地视角：'self' 或 'opponent'
        currentPlayer: null,  // 本地视角：'self' 或 'opponent'
        turnCount: 0,         // 当前总回合数（从1开始）
        finished: false,
    };

    let ui = null;
    let network = null;
    let callbacks = {
        onDone: null,
    };

    function init(options) {
        network = global.Network;
        ui = global.TurnUI;
        if (options && options.onDone) callbacks.onDone = options.onDone;
    }

    function start() {
        if (!ui || !network) {
            console.error('TurnManager 依赖未加载');
            return;
        }
        state = {
            phase: 'rolling',
            myRoll: null,
            opponentRoll: null,
            winner: null,
            firstPlayer: null,
            currentPlayer: null,
            turnCount: 0,
            finished: false,
        };
        ui.showRollInterface();
    }

    function roll() {
        if (state.phase !== 'rolling') return;
        const roll = Math.floor(Math.random() * 6) + 1;
        state.myRoll = roll;
        ui.updateMyRoll(roll);
        network.sendMessage(JSON.stringify({ type: 'turn_roll', roll }));
        checkRolls();
    }

    function handleOpponentRoll(roll) {
        console.log('收到对手点数:', roll);
        state.opponentRoll = roll;
        ui.updateOpponentRoll(roll);
        checkRolls();
    }

    function checkRolls() {
        if (state.myRoll === null || state.opponentRoll === null) return;

        if (state.myRoll === state.opponentRoll) {
            state.phase = 'rolling';
            state.myRoll = null;
            state.opponentRoll = null;
            ui.showTieAndRollAgain();
            return;
        }

        state.phase = 'choosing';
        state.winner = state.myRoll > state.opponentRoll ? 'self' : 'opponent';
        if (state.winner === 'self') {
            ui.showChooseFirst();
        } else {
            ui.showWaitOpponentChoose();
        }
    }

    function chooseFirst(choice) {
        if (state.phase !== 'choosing' || state.winner !== 'self') return;
        state.firstPlayer = choice;
        network.sendMessage(JSON.stringify({ type: 'turn_choice', choice }));
        finishTurnSetup();
    }

    function handleOpponentChoice(choice) {
        if (state.phase !== 'choosing' || state.winner !== 'opponent') return;
        state.firstPlayer = choice === 'self' ? 'opponent' : 'self';
        finishTurnSetup();
    }

    function finishTurnSetup() {
        if (state.finished) return;
        state.finished = true;
        state.phase = 'done';
        state.currentPlayer = state.firstPlayer;
        state.turnCount = 1; // 第一回合
        ui.hide();
        if (callbacks.onDone) callbacks.onDone(state.firstPlayer);
    }

    // 设置先手玩家（供外部调用，通常由 main.js 在 onDone 中设置）
    function setFirstPlayer(player) {
        state.firstPlayer = player;
        state.currentPlayer = player;
        state.turnCount = 1;
    }

    function getCurrentPlayer() {
        return state.currentPlayer;
    }

    function getTurnCount() {
        return state.turnCount;
    }

    // 结束回合：当前玩家切换为对手，并通知对方
    function endTurn() {
        if (state.currentPlayer !== 'self') return;
        state.currentPlayer = 'opponent';
        state.turnCount++;
        network.sendMessage(JSON.stringify({ type: 'turn_end' }));
    }

    // 处理对方结束回合：当前切换为自己回合，重置活跃状态，并判断是否自动抽牌
    function handleEndTurn() {
        state.currentPlayer = 'self';
        state.turnCount++;
        resetSelfCardsActive();   // 重置自己所有卡牌为活跃状态（包含同步）
        // 第三回合开始抽牌（turnCount >= 3）
        if (state.turnCount >= 3) {
            autoDraw();
        }
        // 确保无论如何都刷新本地UI
        if (global.UI && global.UI.refreshAll) {
            global.UI.refreshAll();
        }
        // 再次同步一次，防止自动抽牌同步覆盖（如果抽牌已同步，这里重复但无害）
        if (global.SyncManager && global.Network && global.Network.getState().isConnected) {
            global.SyncManager.sendPublicState('self');
        }
    }

    // 重置自己所有卡牌的活跃状态
    function resetSelfCardsActive() {
        const player = global.GameState.getPlayerState('self');
        if (!player) return;
        const zones = [
            player.frontField,
            player.backField,
            player.costZone,
            player.personalZone,
            player.hand,
            player.mainDeck,
            player.costDeck,
            player.graveyard,
            player.exile
        ];
        zones.forEach(zone => {
            if (Array.isArray(zone)) {
                zone.forEach(card => {
                    if (card) card.active = true;
                });
            }
        });
        // 同步给自己的对手
        if (global.SyncManager && global.Network && global.Network.getState().isConnected) {
            global.SyncManager.sendPublicState('self');
        }
    }

    // 自动抽牌：从主牌库和费用牌库各抽指定张数
    function autoDraw() {
        if (!global.BattleSettings || !global.BattleSettings.autoDraw) {
            return; // 自动抽牌关闭，跳过
        }
        const CardActions = global.CardActions;
        const GameState = global.GameState;
        const UI = global.UI;
        if (!CardActions || !GameState || !UI) return;

        // 设置自动抽牌锁，防止同步覆盖本地状态
        window.__isAutoDrawing = true;

        try {
            const mainDeck = GameState.getPlayerState('self').mainDeck;
            const costDeck = GameState.getPlayerState('self').costDeck;
            if (mainDeck.length > 0) {
                CardActions.drawFromDeck('self', 'mainDeck', 1);
            }
            if (costDeck.length > 0) {
                CardActions.drawFromDeck('self', 'costDeck', 2);
            }

            // 刷新界面
            UI.refreshAll();
        } finally {
            window.__isAutoDrawing = false;
        }

        // 抽牌完成后手动同步一次
        if (global.SyncManager && global.SyncManager.sendPublicState) {
            global.SyncManager.sendPublicState('self');
        }
    }

    global.TurnManager = {
        init,
        start,
        roll,
        handleOpponentRoll,
        chooseFirst,
        handleOpponentChoice,
        setFirstPlayer,
        getCurrentPlayer,
        getTurnCount,
        endTurn,
        handleEndTurn,
        getState: () => ({ ...state }),
    };
})(window);