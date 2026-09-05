// js/interaction/sidePanel.js
// 战斗侧边栏：标记、顺序、清除、规则、自动抽牌开关
// 修改：恢复直接修改卡牌实例的 mark/order 属性；修正退出模式恢复拖拽

(function(global) {
    let currentMode = 'normal';       // 'normal' | 'mark' | 'order'
    let panelEl = null;
    let clickHandler = null;

    global.BattleSettings = global.BattleSettings || { autoDraw: true };

    function init(container) {
        if (!container) {
            console.warn('侧边栏容器不存在');
            return;
        }
        panelEl = container;
        panelEl.innerHTML = `
            <div class="side-panel">
                <button class="side-btn" id="btnMark">标记</button>
                <button class="side-btn" id="btnOrder">顺序</button>
                <button class="side-btn" id="btnClear">清除</button>
                <button class="side-btn" id="btnRules">规则</button>
                <div class="side-toggle">
                    <label>自动抽牌</label>
                    <input type="checkbox" id="toggleAutoDraw" checked>
                </div>
            </div>
        `;

        panelEl.querySelector('#btnMark').addEventListener('click', () => setMode('mark'));
        panelEl.querySelector('#btnOrder').addEventListener('click', () => setMode('order'));
        panelEl.querySelector('#btnClear').addEventListener('click', clearAllMarks);
        panelEl.querySelector('#btnRules').addEventListener('click', showRules);
        panelEl.querySelector('#toggleAutoDraw').addEventListener('change', (e) => {
            global.BattleSettings.autoDraw = e.target.checked;
        });
    }

    function setMode(mode) {
        if (currentMode === mode) {
            exitMode();
            return;
        }
        currentMode = mode;
        updateButtonStates();
        window.__isMarkOrderMode = true;
        if (clickHandler) {
            document.removeEventListener('mousedown', clickHandler, true);
        }
        clickHandler = onGlobalMouseDown;
        document.addEventListener('mousedown', clickHandler, true);
        if (global.UI && global.UI.showNotification) {
            const text = mode === 'mark' ? '标记模式：点击卡牌进行标记' : '顺序模式：依次点击卡牌标记顺序';
            global.UI.showNotification(text, 'info');
        }
    }

    function exitMode() {
        currentMode = 'normal';
        updateButtonStates();
        window.__isMarkOrderMode = false;
        if (clickHandler) {
            document.removeEventListener('mousedown', clickHandler, true);
            clickHandler = null;
        }
    }

    function updateButtonStates() {
        if (!panelEl) return;
        const markBtn = panelEl.querySelector('#btnMark');
        const orderBtn = panelEl.querySelector('#btnOrder');
        if (markBtn) markBtn.classList.toggle('active', currentMode === 'mark');
        if (orderBtn) orderBtn.classList.toggle('active', currentMode === 'order');
    }

    // 全局点击处理：只在卡牌上触发
    function onGlobalMouseDown(e) {
        const cardEl = e.target.closest('.card-full:not(.detail-card)');
        if (!cardEl) return;

        const instanceId = cardEl.getAttribute('data-instance-id');
        if (!instanceId) return;

        const card = findCardInstance(instanceId);
        if (!card) return;

        if (currentMode === 'mark') {
            applyMark(card);
        } else if (currentMode === 'order') {
            applyOrder(card);
        }
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
                player.hand, player.frontField, player.backField,
                player.costZone, player.graveyard, player.exile,
                player.personalZone, player.mainDeck, player.costDeck
            ];
            for (const zoneArray of zones) {
                if (!Array.isArray(zoneArray)) continue;
                const found = zoneArray.find(c => c && c.instanceId === instanceId);
                if (found) return found;
            }
        }
        return null;
    }

    function applyMark(card) {
        if (!card) return;
        if (card.mark !== null) return;   // 已有标记不重复
        card.mark = card.owner;            // 'self' 或 'opponent'
        if (global.UI && global.UI.applyCardMarkers) {
            global.UI.applyCardMarkers();
        }
        sendSyncForCard(card);
    }

    function applyOrder(card) {
        if (!card) return;
        if (card.order > 0) return;
        const maxOrder = getMaxOrder();
        card.order = maxOrder + 1;
        if (global.UI && global.UI.applyCardMarkers) {
            global.UI.applyCardMarkers();
        }
        sendSyncForCard(card);
    }

    function getMaxOrder() {
        const state = global.GameState.getState();
        if (!state) return 0;
        let max = 0;

        // 检查公共区
        if (state.publicField) {
            state.publicField.forEach(c => {
                if (c && c.order > max) max = c.order;
            });
        }

        // 检查双方所有区域
        for (const playerKey of ['self', 'opponent']) {
            const p = state.players[playerKey];
            const zones = [
                p.hand, p.frontField, p.backField, p.costZone,
                p.graveyard, p.exile, p.personalZone,
                p.mainDeck, p.costDeck
            ];
            zones.forEach(arr => {
                if (Array.isArray(arr)) {
                    arr.forEach(c => {
                        if (c && c.order > max) max = c.order;
                    });
                }
            });
        }
        return max;
    }

    function sendSyncForCard(card) {
        if (!global.SyncManager || !global.Network || !global.Network.getState().isConnected) return;
        if (card.owner === 'self') {
            global.SyncManager.sendPublicState('self');
        } else if (card.owner === 'opponent') {
            global.SyncManager.sendPublicState('opponent');
        }
    }

    function clearAllMarks() {
        const state = global.GameState.getState();
        if (state) {
            if (state.publicField) {
                state.publicField.forEach(c => { if (c) { c.mark = null; c.order = 0; } });
            }
            for (const playerKey of ['self', 'opponent']) {
                const p = state.players[playerKey];
                const zones = [
                    p.hand, p.frontField, p.backField, p.costZone,
                    p.graveyard, p.exile, p.personalZone,
                    p.mainDeck, p.costDeck
                ];
                zones.forEach(arr => {
                    if (Array.isArray(arr)) {
                        arr.forEach(c => { if (c) { c.mark = null; c.order = 0; } });
                    }
                });
            }
        }

        if (global.UI && global.UI.applyCardMarkers) {
            global.UI.applyCardMarkers();
        }
        if (global.SyncManager && global.Network && global.Network.getState().isConnected) {
            global.SyncManager.sendPublicState('self');
            global.SyncManager.sendPublicState('opponent');
        }
        if (global.UI && global.UI.showNotification) {
            global.UI.showNotification('已清除所有标记和顺序', 'info');
        }
    }

    function showRules() {
        if (global.ViewerUI) {
            global.ViewerUI.showText('游戏规则', [
                '1. 玩家可以自由拖拽卡牌到任意区域。',
                '2. 第三回合开始自动抽牌。',
                '3. 标记功能用于向对手指示操作目标。',
                '4. 顺序功能用于记录连锁发动的先后顺序。',
                '5. 部分效果需玩家手动结算。',
            ]);
        } else {
            alert('规则：模拟器规则请参考开发文档。');
        }
    }

    function getCurrentMode() {
        return currentMode;
    }

    global.SidePanel = {
        init,
        getCurrentMode,
        exitMode
    };
})(window);