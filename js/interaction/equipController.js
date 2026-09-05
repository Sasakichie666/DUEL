// js/interaction/equipController.js
// 装备控制器：独立管理装备目标选择，不与现有菜单选择状态冲突
// 修改：正确清理全局监听，避免点击被拦截；额外确保所有高亮类被清除

(function(global) {
    let isSelecting = false;
    let equipCard = null;
    let highlightedSlots = [];

    // 清除所有高亮
    function clearHighlights() {
        highlightedSlots.forEach(slot => {
            slot.classList.remove('equip-selectable');
        });
        highlightedSlots = [];
        // 额外清理可能遗漏的卡槽（比如从 DOM 中重新查询一次）
        document.querySelectorAll('.field-slot.equip-selectable').forEach(slot => {
            slot.classList.remove('equip-selectable');
        });
    }

    // 取消选择
    function cancelSelection() {
        clearHighlights();
        isSelecting = false;
        equipCard = null;
        window.__isEquipSelecting = false;
        if (window.__equipGlobalMouseDown) {
            document.removeEventListener('mousedown', window.__equipGlobalMouseDown, true);
            window.__equipGlobalMouseDown = null;
        }
    }

    // 开始装备选择
    function startEquipSelection(card) {
        if (isSelecting) cancelSelection();

        if (!card) return;

        const state = global.GameState.getState();
        if (!state) return;

        const selfPlayer = state.players.self;
        if (!selfPlayer) return;

        isSelecting = true;
        equipCard = card;
        window.__isEquipSelecting = true;

        // 收集前场和后场的己方卡牌格子
        const frontZone = document.getElementById('self-front-field');
        const backZone = document.getElementById('self-back-field');

        [frontZone, backZone].forEach(zoneEl => {
            if (!zoneEl) return;
            const slots = zoneEl.querySelectorAll('.field-slot');
            slots.forEach(slot => {
                const instanceId = slot.querySelector('[data-instance-id]')?.getAttribute('data-instance-id');
                if (instanceId) {
                    const inst = findCardInstance(instanceId);
                    if (inst && inst.owner === 'self' && inst.instanceId !== card.instanceId) {
                        slot.classList.add('equip-selectable');
                        highlightedSlots.push(slot);
                    }
                }
            });
        });

        if (highlightedSlots.length === 0) {
            if (global.UI && global.UI.showNotification) {
                global.UI.showNotification('没有可装备的目标', 'warning');
            }
            cancelSelection();
            return;
        }

        // 定义全局点击处理函数
        const globalMouseDown = (e) => {
            const slot = e.target.closest('.field-slot.equip-selectable');
            if (slot) {
                e.preventDefault();
                e.stopPropagation();
                const instanceId = slot.querySelector('[data-instance-id]')?.getAttribute('data-instance-id');
                if (instanceId) {
                    const targetCard = findCardInstance(instanceId);
                    if (targetCard) {
                        const success = global.CardActions.equipCardToTarget(equipCard, targetCard);
                        if (success) {
                            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                        } else {
                            if (global.UI && global.UI.showNotification) global.UI.showNotification('装备失败', 'error');
                        }
                    }
                }
                cancelSelection();
            } else {
                cancelSelection();
            }
        };

        // 保存并添加全局监听
        window.__equipGlobalMouseDown = globalMouseDown;
        document.addEventListener('mousedown', globalMouseDown, true);
    }

    // 辅助：根据 instanceId 查找卡牌实例
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

    global.EquipController = {
        startEquipSelection,
        cancelSelection
    };
})(window);