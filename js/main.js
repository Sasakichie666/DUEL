// js/main.js
// 主控制模块：初始化、事件绑定、网络回调

(function() {
    const UI = window.UI;
    const Network = window.Network;
    const DeckManager = window.DeckManager;
    const GameState = window.GameState;
    const CardActions = window.CardActions;
    const DragController = window.DragController;
    const SyncManager = window.SyncManager;
    const els = UI.els;
    const TurnManager = window.TurnManager;
    const TurnUI = window.TurnUI;
    const DeckBuilderUI = window.DeckBuilderUI; // 引用新模块

    // ============ 游戏启动辅助函数 ============
    function handleGameStart() {
        const mainDeckIds = DeckManager.getMainDeck();
        const costDeckIds = DeckManager.getCostDeck();
        const legendDeckIds = DeckManager.getLegendDeck();
        GameState.initGame(mainDeckIds, costDeckIds,legendDeckIds);

        CardActions.drawInitialHand('self');
        UI.refreshAll();

        if (SyncManager) {
            SyncManager.sendFullSync();
        }

        if (TurnManager) {
            TurnManager.init({
                onDone: (firstPlayer) => {
                    console.log('先后手决定完成，先手玩家:', firstPlayer);
                    TurnManager.setFirstPlayer(firstPlayer);
                    UI.updateTurnUI();
                    UI.showNotification(`先手玩家：${firstPlayer === 'self' ? '你' : '对手'}`, 'info');
                }
            });
            TurnManager.start();
        }
    }

    // ============ 事件绑定 ============
    function bindEvents() {
        // 导航切换
        els.btnLobby.addEventListener('click', () => UI.switchView('lobby'));
        els.btnDeck.addEventListener('click', () => UI.switchView('deck'));

        // 创建房间
        els.btnCreateRoom.addEventListener('click', async () => {
            const result = await Network.createRoom();
            if (result.error) UI.showNotification(result.error, 'error');
        });

        // 加入房间
        els.btnJoinRoom.addEventListener('click', async () => {
            const password = els.joinPasswordInput.value.trim();
            const result = await Network.joinRoom(password);
            if (result.error) UI.showNotification(result.error, 'error');
        });

        // 准备按钮
        els.btnReady.addEventListener('click', () => {
            const state = Network.getState();
            if (!state.isJoined || !state.isConnected) {
                UI.showNotification('请先建立P2P连接', 'warning');
                return;
            }
            if (!state.myDeckReady) {
                UI.showNotification('请先在卡组管理器中完成卡组配置', 'warning');
                UI.switchView('deck');
                return;
            }
            const newReady = !state.isReady;
            Network.setReady(newReady);
            els.myReadyStatus.textContent = newReady ? '✅ 已准备' : '未准备';
            els.myReadyStatus.className = 'p-status ' + (newReady ? 'ready' : '');
            els.btnReady.textContent = newReady ? '取消准备' : '✅ 准备';
            UI.updateStartButton();
        });

        // 开始对战
        els.btnStartGame.addEventListener('click', () => {
            if (Network.startGame()) {
                UI.showNotification('🎯 对战开始！', 'success');
                UI.showBattleView();
                handleGameStart();
            } else {
                UI.showNotification('双方都需要准备', 'warning');
            }
        });

        // 卡组管理按钮的事件已移至 DeckBuilderUI，不再在此绑定
    }

    // ============ 网络回调设置 ============
    function setupNetworkCallbacks() {
        Network.setCallbacks({
            onStatusChange: (info) => {
                switch (info.type) {
                    case 'host_created':
                        els.roomCodeDisplay.textContent = info.roomCode;
                        els.roomCodeContainer.style.display = 'block';
                        els.btnCreateRoom.disabled = true;
                        els.btnCreateRoom.textContent = '⏳ 等待对手加入...';
                        UI.showNotification('🏠 房间创建成功！密码: ' + info.roomCode, 'success');
                        break;
                    case 'joining':
                        els.btnJoinRoom.disabled = true;
                        els.btnJoinRoom.textContent = '⏳ 连接中...';
                        break;
                    case 'error':
                        UI.showNotification(info.message || '发生错误', 'error');
                        break;
                    case 'opponent_ready':
                        els.opponentReadyStatus.textContent = info.ready ? '✅ 已准备' : '未准备';
                        els.opponentReadyStatus.className = 'p-status ' + (info.ready ? 'ready' : '');
                        UI.updateStartButton();
                        break;
                    case 'reset':
                        UI.resetUI();
                        break;
                }
                UI.updateConnectionUI();
            },
            onConnectionChange: (info) => {
                if (info.type === 'connected') {
                    if (Network.getState().isHost) {
                        els.hostOpponentInfo.style.display = 'flex';
                        els.hostOpponentStatus.textContent = '已连接，等待准备...';
                    } else {
                        els.joinOpponentInfo.style.display = 'flex';
                        els.joinOpponentStatus.textContent = '已连接到房主，等待准备...';
                    }
                    els.battleWaiting.classList.add('active');
                    UI.showNotification('🔗 P2P连接已建立！', 'success');
                } else if (info.type === 'disconnected') {
                    UI.showNotification('👋 对手离开了房间', 'warning');
                } else if (info.type === 'opponent_joined') {
                    UI.showNotification('👤 对手已加入房间！', 'success');
                }
                UI.updateConnectionUI();
            },
            onMessage: (data) => {
                try {
                    const msg = JSON.parse(data);
                    if (msg.type === 'ready_status') {
                        Network.setOpponentReady(msg.ready);
                    } else if (msg.type === 'game_start') {
                        UI.showNotification('🎯 对战开始！', 'success');
                        UI.showBattleView();
                        if (!GameState.getState()) {
                            handleGameStart();
                        }
                    } else if (msg.type === 'sync_state') {
                        if (SyncManager) {
                            SyncManager.handleSyncMessage(msg);
                        }
                    } else if (msg.type === 'turn_roll') {
                        if (TurnManager) {
                            TurnManager.handleOpponentRoll(msg.roll);
                        }
                    } else if (msg.type === 'turn_choice') {
                        if (TurnManager) {
                            TurnManager.handleOpponentChoice(msg.choice);
                        }
                    } else if (msg.type === 'turn_end') {
                        if (TurnManager) {
                            TurnManager.handleEndTurn();
                            UI.updateTurnUI();
                        }
                    }
                } catch (e) {
                    console.error('解析P2P消息失败', e);
                }
            }
        });
    }

    // ============ 初始化 ============
    function init() {
        // 初始化卡组管理器 UI（包含渲染卡牌库、卡组槽位以及事件绑定）
        if (DeckBuilderUI) {
            DeckBuilderUI.init();
        } else {
            // 降级：如果 DeckBuilderUI 未加载，则调用旧接口
            UI.renderCardLibrary();
            UI.renderDeckSlots();
        }

        UI.updateConnectionUI();
        setupNetworkCallbacks();
        bindEvents();

        if (SyncManager) {
            SyncManager.init();
        }

        

        if (window.CardDetailUI) {
            window.CardDetailUI.initHoverEvents();
        }
        if (DragController) {
            DragController.init();
        }
        if (window.OpponentPileViewer) {
            window.OpponentPileViewer.init();
        }
        if (window.SidePanel && UI.els.sidePanelContainer) {
            SidePanel.init(UI.els.sidePanelContainer);
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();