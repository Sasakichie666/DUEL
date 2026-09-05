// js/ui.js
// UI管理器：只负责调度子模块，不包含具体渲染实现
// 修改：标记/顺序从 MarkOrderManager 独立获取，不再依赖卡牌实例

(function(global) {
    const CardUI = global.CardUI;
    const FieldUI = global.FieldUI;
    const CostUI = global.CostUI;
    const DeckUI = global.DeckUI;
    const CardDetailUI = global.CardDetailUI;
    const HealthUI = global.HealthUI;

    const els = {
        btnLobby: document.getElementById('btnLobby'),
        btnDeck: document.getElementById('btnDeck'),
        viewLobby: document.getElementById('view-lobby'),
        viewDeck: document.getElementById('view-deck'),
        viewBattle: document.getElementById('view-battle'),
        btnCreateRoom: document.getElementById('btnCreateRoom'),
        btnJoinRoom: document.getElementById('btnJoinRoom'),
        joinPasswordInput: document.getElementById('joinPasswordInput'),
        roomCodeContainer: document.getElementById('roomCodeContainer'),
        roomCodeDisplay: document.getElementById('roomCodeDisplay'),
        hostStatusDot: document.getElementById('hostStatusDot'),
        hostStatusText: document.getElementById('hostStatusText'),
        joinStatusDot: document.getElementById('joinStatusDot'),
        joinStatusText: document.getElementById('joinStatusText'),
        hostOpponentInfo: document.getElementById('hostOpponentInfo'),
        hostOpponentStatus: document.getElementById('hostOpponentStatus'),
        joinOpponentInfo: document.getElementById('joinOpponentInfo'),
        joinOpponentStatus: document.getElementById('joinOpponentStatus'),
        battleWaiting: document.getElementById('battleWaiting'),
        myReadyStatus: document.getElementById('myReadyStatus'),
        opponentReadyStatus: document.getElementById('opponentReadyStatus'),
        btnReady: document.getElementById('btnReady'),
        btnStartGame: document.getElementById('btnStartGame'),
        cardLibrary: document.getElementById('cardLibrary'),
        mainDeckSlots: document.getElementById('mainDeckSlots'),
        costDeckSlots: document.getElementById('costDeckSlots'),
        mainDeckCount: document.getElementById('mainDeckCount'),
        deckValidationMsg: document.getElementById('deckValidationMsg'),
        btnSaveDeck: document.getElementById('btnSaveDeck'),
        btnLoadDeck: document.getElementById('btnLoadDeck'),
        btnClearDeck: document.getElementById('btnClearDeck'),
        selfFrontField: document.getElementById('self-front-field'),
        selfBackField: document.getElementById('self-back-field'),
        opponentFrontField: document.getElementById('opponent-front-field'),
        opponentBackField: document.getElementById('opponent-back-field'),
        publicField: document.getElementById('public-field'),
        selfHand: document.getElementById('self-hand'),
        selfCostZone: document.getElementById('self-cost-zone'),
        opponentCostZone: document.getElementById('opponent-cost-zone'),
        selfDeckZone: document.getElementById('self-deck-zone'),
        opponentDeckZone: document.getElementById('opponent-deck-zone'),
        opponentHandMainCount: document.getElementById('opponent-hand-main-count'),
        opponentHandCostCount: document.getElementById('opponent-hand-cost-count'),
        selfHandMainCount: document.getElementById('self-hand-main-count'),
        selfHandCostCount: document.getElementById('self-hand-cost-count'),
        selfHealth: document.getElementById('self-health'),
        opponentHealth: document.getElementById('opponent-health'),
        btnEndTurn: document.getElementById('btnEndTurn'),
        navTurnCountDisplay: document.getElementById('navTurnCountDisplay'),
        sidePanelContainer: document.getElementById('sidePanelContainer')
    };

    let battlefieldInitialized = false;

    function showNotification(message, type = 'info', duration = 3000) {
        const existing = document.querySelectorAll('.notification');
        existing.forEach(n => n.remove());
        const notif = document.createElement('div');
        notif.className = `notification ${type}`;
        notif.textContent = message;
        document.body.appendChild(notif);
        setTimeout(() => {
            notif.style.opacity = '0';
            notif.style.transition = 'opacity 0.3s';
            setTimeout(() => notif.remove(), 300);
        }, duration);
    }

    function switchView(view) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-' + view)?.classList.add('active');
        document.querySelectorAll('.nav-buttons .btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn' + view.charAt(0).toUpperCase() + view.slice(1))?.classList.add('active');

        if (view === 'battle') {
            els.btnLobby.disabled = true;
            els.btnDeck.disabled = true;
        } else {
            els.btnLobby.disabled = false;
            els.btnDeck.disabled = false;
        }
    }

    function updateConnectionUI() {
        const { Network } = global;
        if (!Network) return;
        const state = Network.getState();
        if (state.isHost && state.isJoined) {
            els.hostStatusDot.className = 'dot ' + (state.isConnected ? 'connected' : 'connecting');
            els.hostStatusText.textContent = state.isConnected ? 'P2P已连接' : '等待对手连接...';
        } else {
            els.hostStatusDot.className = 'dot disconnected';
            els.hostStatusText.textContent = '未创建房间';
        }
        if (!state.isHost && state.isJoined) {
            els.joinStatusDot.className = 'dot ' + (state.isConnected ? 'connected' : 'connecting');
            els.joinStatusText.textContent = state.isConnected ? 'P2P已连接' : '等待连接...';
        } else if (!state.isHost) {
            els.joinStatusDot.className = 'dot disconnected';
            els.joinStatusText.textContent = '未加入房间';
        }
    }

    function updateStartButton() {
        const { Network } = global;
        if (!Network) return;
        const state = Network.getState();
        els.btnStartGame.disabled = !(state.isReady && state.opponentReady);
        if (!els.btnStartGame.disabled) {
            els.btnStartGame.style.background = 'var(--accent)';
            els.btnStartGame.style.borderColor = 'var(--accent)';
        } else {
            els.btnStartGame.style.background = '';
            els.btnStartGame.style.borderColor = '';
        }
    }

    function resetUI() {
        els.btnCreateRoom.disabled = false;
        els.btnCreateRoom.textContent = '🚀 创建房间';
        els.btnJoinRoom.disabled = false;
        els.btnJoinRoom.textContent = '加入';
        els.roomCodeContainer.style.display = 'none';
        els.hostOpponentInfo.style.display = 'none';
        els.joinOpponentInfo.style.display = 'none';
        els.battleWaiting.classList.remove('active');
        els.myReadyStatus.textContent = '未准备';
        els.opponentReadyStatus.textContent = '未准备';
        els.btnReady.textContent = '✅ 准备';
        els.btnStartGame.disabled = true;
        els.btnLobby.disabled = false;
        els.btnDeck.disabled = false;
        updateConnectionUI();
    }

    function initBattlefield() {
        if (battlefieldInitialized) return;
        battlefieldInitialized = true;

        [
            els.selfFrontField, els.selfBackField,
            els.opponentFrontField, els.opponentBackField,
            els.publicField,
            els.selfCostZone, els.opponentCostZone,
            els.selfDeckZone, els.opponentDeckZone
        ].forEach(el => { if (el) el.innerHTML = ''; });

        els.selfFrontField.appendChild(FieldUI.createFieldZone('self', 'front'));
        els.selfBackField.appendChild(FieldUI.createFieldZone('self', 'back'));
        els.opponentFrontField.appendChild(FieldUI.createFieldZone('opponent', 'front'));
        els.opponentBackField.appendChild(FieldUI.createFieldZone('opponent', 'back'));
        els.publicField.appendChild(FieldUI.createFieldZone('public', 'public'));
        els.selfCostZone.appendChild(CostUI.createCostZone('self'));
        els.opponentCostZone.appendChild(CostUI.createCostZone('opponent'));
        els.selfDeckZone.appendChild(DeckUI.createDeckZone('self'));
        els.opponentDeckZone.appendChild(DeckUI.createDeckZone('opponent'));
        els.selfHand.innerHTML = '<div class="hand-placeholder">手牌区</div>';

        CardDetailUI.initHoverEvents();

        if (HealthUI) {
            HealthUI.init(els);
        }

        if (els.btnEndTurn) {
            els.btnEndTurn.addEventListener('click', () => {
                if (global.TurnManager) {
                    global.TurnManager.endTurn();
                    updateTurnUI();
                }
            });
        }
    }

    function renderBattlefield() {
        const { GameState } = global;
        if (!GameState || !GameState.getState()) return;

        const selfHand = GameState.getHand('self');
        CardUI.renderHand(els.selfHand, selfHand);

        const selfPlayer = GameState.getPlayerState('self');
        if (selfPlayer) {
            FieldUI.renderFieldZone(els.selfFrontField, selfPlayer.frontField, 'self', 'front');
            FieldUI.renderFieldZone(els.selfBackField, selfPlayer.backField, 'self', 'back');
            CostUI.renderCostZone(els.selfCostZone, selfPlayer.costZone);
            DeckUI.updateDeckCounts(els.selfDeckZone, selfPlayer);
        }

        const opponentPlayer = GameState.getPlayerState('opponent');
        if (opponentPlayer) {
            FieldUI.renderFieldZone(els.opponentFrontField, opponentPlayer.frontField, 'opponent', 'front', false);
            FieldUI.renderFieldZone(els.opponentBackField, opponentPlayer.backField, 'opponent', 'back', false);
            CostUI.renderCostZone(els.opponentCostZone, opponentPlayer.costZone, false);
            DeckUI.updateDeckCounts(els.opponentDeckZone, opponentPlayer);
        }

        const publicFieldData = GameState.getState().publicField || new Array(5).fill(null);
        FieldUI.renderFieldZone(els.publicField, publicFieldData, 'public', 'public', false);

        updateHandCounts();
        if (HealthUI) {
            HealthUI.updateDisplay();
        }
        updateTurnUI();
        applyCardMarkers();
    }

    function updateHandCounts() {
        const { GameState } = global;
        if (!GameState || !GameState.getState()) return;

        const selfPlayer = GameState.getPlayerState('self');
        if (selfPlayer) {
            let main = 0, cost = 0;
            selfPlayer.hand.forEach(instance => {
                if (!instance) return;
                const card = instance.cardData || global.CardLibrary.getCardById(instance.cardId);
                if (card && card.type === 'cost') cost++;
                else main++;
            });
            if (els.selfHandMainCount) els.selfHandMainCount.textContent = main;
            if (els.selfHandCostCount) els.selfHandCostCount.textContent = cost;
        }

        const oppPlayer = GameState.getPlayerState('opponent');
        if (oppPlayer) {
            if (els.opponentHandMainCount) els.opponentHandMainCount.textContent = oppPlayer.handMainCount || 0;
            if (els.opponentHandCostCount) els.opponentHandCostCount.textContent = oppPlayer.handCostCount || 0;
        }
    }

    function updateTurnUI() {
        if (!els.btnEndTurn) return;
        const { TurnManager } = global;
        if (!TurnManager) return;
        const currentPlayer = TurnManager.getCurrentPlayer();
        const turnCount = TurnManager.getTurnCount();

        if (els.navTurnCountDisplay) {
            els.navTurnCountDisplay.textContent = `第${turnCount}回合`;
        }

        if (currentPlayer === 'self') {
            els.btnEndTurn.textContent = '结束回合';
            els.btnEndTurn.disabled = false;
        } else {
            els.btnEndTurn.textContent = '对方回合';
            els.btnEndTurn.disabled = true;
        }
    }

    function applyCardMarkers() {
        const { GameState } = global;
        if (!GameState || !GameState.getState()) return;

        document.querySelectorAll('[data-instance-id]').forEach(cardEl => {
            const instanceId = cardEl.getAttribute('data-instance-id');
            if (!instanceId) return;

            const cardInstance = findCardInstance(instanceId);
            if (!cardInstance) return;

            cardEl.classList.remove('mark-self', 'mark-opponent', 'order-mark', 'exhausted');
            cardEl.removeAttribute('data-order');
            const oldBadge = cardEl.querySelector('.order-badge');
            if (oldBadge) oldBadge.remove();

            // 从 MarkOrderManager 获取标记和顺序
            const mark = global.MarkOrderManager ? global.MarkOrderManager.getMark(instanceId) : null;
            const order = global.MarkOrderManager ? global.MarkOrderManager.getOrder(instanceId) : 0;

            if (mark === 'self') {
                cardEl.classList.add('mark-self');
            } else if (mark === 'opponent') {
                cardEl.classList.add('mark-opponent');
            }

            if (order > 0) {
                cardEl.classList.add('order-mark');
                cardEl.setAttribute('data-order', order);
                const badge = document.createElement('span');
                badge.className = 'order-badge';
                badge.textContent = order;
                cardEl.appendChild(badge);
            }

            if (cardInstance.active === false) {
                cardEl.classList.add('exhausted');
            } else {
                cardEl.classList.remove('exhausted');
            }

            if (cardInstance.cardData && cardInstance.cardData.type === 'minion') {
                const atkBadge = cardEl.querySelector('.atk-badge');
                const defBadge = cardEl.querySelector('.def-badge');
                if (atkBadge && cardInstance.currentAttack != null) {
                    atkBadge.textContent = cardInstance.currentAttack;
                }
                if (defBadge && cardInstance.currentDefense != null) {
                    defBadge.textContent = cardInstance.currentDefense;
                }
            }

            if (global.TraitUI && global.TraitUI.renderCardTraits) {
                global.TraitUI.renderCardTraits(cardEl, cardInstance);
            }
        });
    }

    function findCardInstance(instanceId) {
        const state = global.GameState.getState();
        if (!state) return null;

        if (state.publicField) {
            const found = state.publicField.find(c => c && c.instanceId === instanceId);
            if (found) return found;
        }

        for (const playerKey of ['self', 'opponent']) {
            const player = state.players[playerKey];
            const zones = [
                player.hand,
                player.frontField,
                player.backField,
                player.costZone,
                player.graveyard,
                player.exile,
                player.personalZone,
                player.mainDeck,
                player.costDeck
            ];
            for (const zoneArray of zones) {
                if (!Array.isArray(zoneArray)) continue;
                const found = zoneArray.find(c => c && c.instanceId === instanceId);
                if (found) return found;
            }
        }
        return null;
    }

    function refreshAll() {
        if (!battlefieldInitialized) initBattlefield();
        renderBattlefield();
    }

    function showBattleView() {
        switchView('battle');
        if (!battlefieldInitialized) initBattlefield();
        renderBattlefield();
    }

    function renderCardLibrary() {
        CardUI.renderCardLibrary(els.cardLibrary);
    }

    global.UI = {
        els,
        showNotification,
        switchView,
        renderCardLibrary,
        updateConnectionUI,
        updateStartButton,
        resetUI,
        initBattlefield,
        renderBattlefield,
        updateHandCounts,
        updateTurnUI,
        refreshAll,
        showBattleView,
        applyCardMarkers,
        CardUI,
        FieldUI,
        CostUI,
        DeckUI,
        CardDetailUI,
        HealthUI
    };
})(window);