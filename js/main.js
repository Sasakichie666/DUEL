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
        // 对局一开始就隐藏手牌区：起始手牌只在「起始手牌」界面展示，
        // 双方调度结束后才渲染手牌（避免开局瞬间露出 4 张起手牌）
        if (window.MulliganManager && window.MulliganManager.hideHand) {
            window.MulliganManager.hideHand();
        }

        const mainDeckIds = DeckManager.getMainDeck();
        const costDeckIds = DeckManager.getCostDeck();
        const legendDeckIds = DeckManager.getLegendDeck();
        GameState.initGame(mainDeckIds, costDeckIds,legendDeckIds);

        // 起始手牌只抽主牌库 4 张（费用牌不在此阶段抽取：
        // 调度结束后才按先后手抽，先手 4 张 / 后手 5 张，见 MulliganManager）
        CardActions.drawFromDeck('self', 'mainDeck', GameState.INITIAL_HAND_SIZE);
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
                    // 先后手确定后进入「起始手牌」调度阶段
                    if (window.MulliganManager) {
                        window.MulliganManager.start({ isFirst: firstPlayer === 'self' });
                    }
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

        // 开始对战（仅房主可发起；加入方只能等待房主开始）
        els.btnStartGame.addEventListener('click', () => {
            if (!Network.getState().isHost) {
                UI.showNotification('只有房主可以开始对战，请等待房主开始', 'warning');
                return;
            }
            if (Network.startGame()) {
                UI.showNotification('🎯 对战开始！', 'success');
                UI.markGameStarted();   // 开局门禁：从这里开始才允许构建/渲染牌桌
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
                        UI.showNotification('🏠 房间创建成功！房间号: ' + info.roomCode
                            + (String(info.roomCode).length > 4 ? '（较长，请原样复制给朋友）' : ''), 'success');
                        break;
                    case 'joining':
                        els.btnJoinRoom.disabled = true;
                        els.btnJoinRoom.textContent = info.attempt
                            ? ('⏳ 重试中 ' + info.attempt + '/' + info.maxAttempts + '...')
                            : '⏳ 连接中...';
                        break;
                    case 'joined':
                        els.btnJoinRoom.textContent = '✅ 已加入';
                        break;
                    case 'signaling_lost':
                        // 信令掉线：程序会自动重连一次（局域网框架，不再有长循环）
                        UI.showNotification('📡 ' + (info.message || '与信令服务器断开，正在重连…'), 'warning', 6000);
                        break;
                    case 'signaling_failed':
                        UI.showNotification('📡 ' + (info.message || '信令连接没能恢复'), 'error', 8000);
                        break;
                    case 'connection_path':
                        // 连接路径（局域网直连 / IPv6 直连）：大厅显示 + 控制台留档 + 连上时轻提示
                        UI.showConnectionPath(info.path);
                        console.log('[联机] 本次连接路径：' + (info.path && info.path.text));
                        if (info.path && info.path.ok && info.path.reason === '已连上') {
                            UI.showNotification('🔗 连接方式：' + info.path.text, 'success', 5000);
                        }
                        break;
                    case 'signaling_ok':
                        UI.showNotification('📡 ' + (info.message || '已重新连上信令服务器'), 'success', 5000);
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
                    // 响应连锁窗口依赖联机，断线即关闭（不影响其它功能）
                    if (window.ChainManager) window.ChainManager.forceClose('disconnect');
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
                        UI.markGameStarted();   // 收到房主开局消息后才构建/渲染牌桌
                        UI.showBattleView();
                        if (!GameState.getState()) {
                            handleGameStart();
                        }
                    } else if (msg.type === 'battle_log') {
                        // 对手的操作日志：以「对手」身份显示在同一条日志里
                        if (window.BattleLog && window.BattleLog.logRemote) {
                            window.BattleLog.logRemote(msg.text);
                        }
                    } else if (msg.type === 'mulligan_done') {
                        // 对手已完成起始手牌调度（确认保留）
                        if (window.MulliganManager) {
                            window.MulliganManager.handleOpponentDone();
                        }
                    } else if (msg.type === 'card_handover'
                               || msg.type === 'card_give'          // 旧消息名（兼容只刷新了一端的情况）
                               || msg.type === 'card_owner_move') {
                        // 对方把一张牌交给我（或放进我的区域：战场/手牌/墓场/放逐/牌库）✓
                        if (window.CardHandoverChannel) {
                            window.CardHandoverChannel.handle(msg);
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
                    } else if (msg.type === 'chain_sync') {
                        // 响应连锁：整窗快照（按 rev 取新），由 ChainManager 自行镜像成我方视角
                        if (window.ChainManager) window.ChainManager.handleRemote(msg);
                    } else if (msg.type === 'reveal_sync') {
                        // 展示 / 翻阅 / 检索告知：单会话快照（见 js/core/revealChannel.js）
                        if (window.RevealChannel) window.RevealChannel.handle(msg);
                    }
                } catch (e) {
                    console.error('解析P2P消息失败', e);
                }
            }
        });
    }

    // ============ 初始化 ============
    function init() {
        // ===== 首屏渲染策略 =====
        // 卡组数据与「是否可开局」的状态在启动时初始化（很轻：只读 localStorage + 内存数据），
        // 但界面渲染（卡牌库 + 卡组槽位，几百个 DOM 节点）推迟到第一次打开卡组管理器时再做，
        // 这样联机大厅阶段不会去做其它视图的渲染工作。
        if (DeckBuilderUI) {
            if (typeof DeckBuilderUI.loadSavedDeck === 'function') DeckBuilderUI.loadSavedDeck();
            if (typeof DeckBuilderUI.updateDeckStatus === 'function') DeckBuilderUI.updateDeckStatus();
            UI.registerViewHook('deck', () => DeckBuilderUI.init());
        } else {
            // 降级：只渲染卡牌库
            UI.registerViewHook('deck', () => UI.renderCardLibrary());
        }

        UI.updateConnectionUI();
        setupNetworkCallbacks();
        bindEvents();

        // 连接自检按钮（联机排查用；模块缺失时静默跳过）
        if (window.DiagUI && window.DiagUI.init) {
            window.DiagUI.init();
        }

        // 费用牌 / 费用区 批量面板（点「费用牌区域」或「费用区」打开）
        if (window.CostPanelUI && window.CostPanelUI.init) {
            window.CostPanelUI.init();
        }

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

        // ===== 响应连锁系统（新增，完全独立；任一模块缺失都只是静默降级） =====
        if (window.ChainManager && window.ChainManager.init) {
            window.ChainManager.init();          // 订阅时点总线
        }
        if (window.ChainPanelUI && window.ChainPanelUI.init) {
            window.ChainPanelUI.init();          // 订阅窗口状态 → 渲染右侧面板
        }

        // ===== 展示 / 翻阅 / 检索（新增，同样完全独立 ✓）=====
        if (window.RevealPanelUI && window.RevealPanelUI.init) {
            window.RevealPanelUI.init();         // 对方窗口 / 手牌挑选 / 数量弹窗
        }
        if (window.DeckTakeUI && window.DeckTakeUI.init) {
            window.DeckTakeUI.init();            // 检索·翻阅 共用的取牌界面（我方面板由其驱动 ✓）
        }

        // 侧栏工具按钮属于战斗视图内部：等战斗视图真正构建后再注入
        UI.onBattleViewReady(() => {
            if (window.SidePanel && UI.els.sidePanelContainer) {
                SidePanel.init(UI.els.sidePanelContainer);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();