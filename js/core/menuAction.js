// js/core/menuAction.js
// 菜单动作模块：处理需要选择目标格子的卡牌操作（登场、发动、支付、盖伏）及无需选择格子的操作
// 注意：装备目标选择已移至独立模块 equipController.js
// 修改：新增墓场/放逐区检索功能

(function(global) {
    let selectionState = null;
    let boundSlots = [];
    let globalCancelHandler = null;

    const PUBLIC_REVEAL_ORDER = [2, 1, 3, 0, 4];

    function highlightEmptySlots(zone) {
        let containerId = '';
        if (zone === 'frontField') containerId = 'self-front-field';
        else if (zone === 'backField') containerId = 'self-back-field';
        else if (zone === 'costZone') containerId = 'self-cost-zone';

        const container = document.getElementById(containerId);
        if (!container) return [];
        const emptySlots = container.querySelectorAll('.field-slot.empty');
        emptySlots.forEach(slot => slot.classList.add('selectable'));
        return Array.from(emptySlots);
    }

    function highlightEmptySlotsMulti(zones) {
        let allSlots = [];
        zones.forEach(zone => {
            allSlots = allSlots.concat(highlightEmptySlots(zone));
        });
        return allSlots;
    }

    function clearHighlights() {
        boundSlots.forEach(slot => {
            slot.classList.remove('selectable');
            if (slot._menuActionHandler) {
                slot.removeEventListener('click', slot._menuActionHandler);
                delete slot._menuActionHandler;
            }
        });
        boundSlots = [];
    }

    function bindGlobalCancel() {
        if (globalCancelHandler) return;
        globalCancelHandler = (e) => {
            if (!e.target.closest('.field-slot.selectable')) {
                cancelSelection();
            }
        };
        document.addEventListener('mousedown', globalCancelHandler, true);
    }

    function cancelSelection() {
        if (selectionState) {
            clearHighlights();
            selectionState = null;
        }
        if (globalCancelHandler) {
            document.removeEventListener('mousedown', globalCancelHandler, true);
            globalCancelHandler = null;
        }
    }

    function startSelection(card, targetZone) {
        if (selectionState) cancelSelection();

        const slots = highlightEmptySlots(targetZone);
        if (slots.length === 0) {
            if (global.UI && global.UI.showNotification) global.UI.showNotification('没有可用的空位', 'warning');
            return false;
        }

        slots.forEach(slot => {
            const handler = (e) => {
                e.stopPropagation();
                handleSlotClick(slot, card, targetZone, false);
            };
            slot.addEventListener('click', handler);
            slot._menuActionHandler = handler;
            boundSlots.push(slot);
        });

        selectionState = { card, targetZone, faceDown: false };
        bindGlobalCancel();
        return true;
    }

    function startSelectionMultiZone(card, zones, faceDown) {
        if (selectionState) cancelSelection();

        const slots = highlightEmptySlotsMulti(zones);
        if (slots.length === 0) {
            if (global.UI && global.UI.showNotification) global.UI.showNotification('没有可用的空位', 'warning');
            return false;
        }

        slots.forEach(slot => {
            const handler = (e) => {
                e.stopPropagation();
                handleSlotClickMultiZone(slot, card, zones, faceDown);
            };
            slot.addEventListener('click', handler);
            slot._menuActionHandler = handler;
            boundSlots.push(slot);
        });

        selectionState = { card, targetZones: zones, faceDown: faceDown };
        bindGlobalCancel();
        return true;
    }

    function handleSlotClick(slot, card, targetZone, faceDown) {
        const index = getIndexFromSlot(slot, targetZone);
        const zone = mapZone(targetZone);
        card.faceDown = faceDown;
        const success = global.CardActions.moveCard(card.instanceId, zone, index);
        if (success) {
            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
        } else {
            if (global.UI && global.UI.showNotification) global.UI.showNotification('放置失败', 'error');
        }
        cancelSelection();
    }

    function handleSlotClickMultiZone(slot, card, zones, faceDown) {
        const zoneStr = determineZoneFromSlot(slot, zones);
        if (!zoneStr) return;
        const index = getIndexFromSlot(slot, zoneStr);
        const zone = mapZone(zoneStr);
        card.faceDown = faceDown;
        const success = global.CardActions.moveCard(card.instanceId, zone, index);
        if (success) {
            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
        } else {
            if (global.UI && global.UI.showNotification) global.UI.showNotification('放置失败', 'error');
        }
        cancelSelection();
    }

    function determineZoneFromSlot(slot, zones) {
        if (zones.includes('frontField') && slot.closest('#self-front-field')) return 'frontField';
        if (zones.includes('backField') && slot.closest('#self-back-field')) return 'backField';
        return null;
    }

    function getIndexFromSlot(slot, zone) {
        if (zone === 'costZone') {
            const costZone = slot.closest('.cost-zone');
            const rowEl = slot.closest('.cost-row');
            if (costZone && rowEl) {
                const rows = Array.from(costZone.querySelectorAll('.cost-row'));
                const rowIndex = rows.indexOf(rowEl);
                const colIndex = parseInt(slot.getAttribute('data-index') || '0', 10);
                return rowIndex * 5 + colIndex;
            }
            return 0;
        }
        return parseInt(slot.getAttribute('data-index') || '0', 10);
    }

    function mapZone(zone) {
        if (zone === 'frontField') return global.GameState.ZONE.FRONT_FIELD;
        if (zone === 'backField') return global.GameState.ZONE.BACK_FIELD;
        if (zone === 'costZone') return global.GameState.ZONE.COST_ZONE;
        return null;
    }

    // ========== 直接动作 ==========

    function returnToHand(card) { cancelSelection(); card.faceDown = false; const s = global.CardActions.moveCard(card.instanceId, global.GameState.ZONE.HAND, -1); if (s) { if (global.UI && global.UI.refreshAll) global.UI.refreshAll(); } else { if (global.UI && global.UI.showNotification) global.UI.showNotification('回手失败', 'error'); } }
    function discard(card) { cancelSelection(); const s = global.CardActions.moveCard(card.instanceId, global.GameState.ZONE.GRAVEYARD, -1); if (s) { if (global.UI && global.UI.refreshAll) global.UI.refreshAll(); } else { if (global.UI && global.UI.showNotification) global.UI.showNotification('进墓失败', 'error'); } }
    function exile(card) { cancelSelection(); const s = global.CardActions.moveCard(card.instanceId, global.GameState.ZONE.EXILE, -1); if (s) { if (global.UI && global.UI.refreshAll) global.UI.refreshAll(); } else { if (global.UI && global.UI.showNotification) global.UI.showNotification('放逐失败', 'error'); } }
    function toggleFaceDown(card) { cancelSelection(); const s = global.CardActions.toggleCardFaceDown(card); if (s) { if (global.UI && global.UI.refreshAll) global.UI.refreshAll(); } else { if (global.UI && global.UI.showNotification) global.UI.showNotification('翻盖失败', 'error'); } }

    function returnToDeck(card) { cancelSelection(); const anchorEl = document.querySelector(`[data-instance-id="${card.instanceId}"]`); if (!anchorEl) return; global.MenuUI.show({ items: [ { label: '回主牌库顶', value: 'returnToMainDeckTop' }, { label: '回主牌库底', value: 'returnToMainDeckBottom' }, { label: '回费牌库顶', value: 'returnToCostDeckTop' }, { label: '回费牌库底', value: 'returnToCostDeckBottom' }, ], anchorEl: anchorEl, onSelect: (value) => { cancelSelection(); const player = card.owner; switch (value) { case 'returnToMainDeckTop': global.CardActions.returnCardToDeckTop(player, 'mainDeck', card); break; case 'returnToMainDeckBottom': global.CardActions.returnCardToDeckBottom(player, 'mainDeck', card); break; case 'returnToCostDeckTop': global.CardActions.returnCardToDeckTop(player, 'costDeck', card); break; case 'returnToCostDeckBottom': global.CardActions.returnCardToDeckBottom(player, 'costDeck', card); break; } if (global.UI && global.UI.refreshAll) global.UI.refreshAll(); } }); }
    function returnToMainDeckTop(card) { cancelSelection(); const s = global.CardActions.returnCardToDeckTop(card.owner, 'mainDeck', card); if (s) { if (global.UI && global.UI.refreshAll) global.UI.refreshAll(); } else { if (global.UI && global.UI.showNotification) global.UI.showNotification('回主牌库顶失败', 'error'); } }
    function returnToMainDeckBottom(card) { cancelSelection(); const s = global.CardActions.returnCardToDeckBottom(card.owner, 'mainDeck', card); if (s) { if (global.UI && global.UI.refreshAll) global.UI.refreshAll(); } else { if (global.UI && global.UI.showNotification) global.UI.showNotification('回主牌库底失败', 'error'); } }

    function publicReveal() { cancelSelection(); const state = global.GameState.getState(); if (!state) return; let targetIndex = -1; for (const idx of PUBLIC_REVEAL_ORDER) { if (state.publicField[idx] === null) { targetIndex = idx; break; } } if (targetIndex === -1) { if (global.UI && global.UI.showNotification) global.UI.showNotification('公共区已满', 'warning'); return; } const s = global.CardActions.moveCardFromDeckToZone('self', 'mainDeck', global.GameState.ZONE.PUBLIC_FIELD, targetIndex); if (s) { if (global.UI && global.UI.refreshAll) global.UI.refreshAll(); } else { if (global.UI && global.UI.showNotification) global.UI.showNotification('公开失败', 'error'); } }

    function viewGraveyard() { cancelSelection(); const state = global.GameState.getState(); if (!state) return; const cards = state.players.self.graveyard.slice().reverse(); if (global.ViewerUI) global.ViewerUI.show(cards, '墓场'); }
    function viewExile() { cancelSelection(); const state = global.GameState.getState(); if (!state) return; const cards = state.players.self.exile.slice().reverse(); if (global.ViewerUI) global.ViewerUI.show(cards, '放逐区'); }

    function searchDeck(deckType) {
        cancelSelection();
        const state = global.GameState.getState();
        if (!state) return;
        const deck = state.players.self[deckType];
        const cards = deck.slice();
        const title = deckType === 'mainDeck' ? '主牌库检索' : '费用牌库检索';
        if (global.ViewerUI) {
            global.ViewerUI.show(cards, title, (cardInstance) => {
                let targetIndex = -1;
                for (const idx of PUBLIC_REVEAL_ORDER) {
                    if (state.publicField[idx] === null) {
                        targetIndex = idx;
                        break;
                    }
                }
                if (targetIndex === -1) {
                    if (global.UI && global.UI.showNotification) global.UI.showNotification('公共区已满', 'warning');
                    return;
                }
                const s = global.CardActions.moveSpecificCardFromDeckToZone('self', deckType, cardInstance.instanceId, global.GameState.ZONE.PUBLIC_FIELD, targetIndex);
                if (s) {
                    global.CardActions.shuffleDeck('self', deckType);
                    if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                }
            });
        }
    }

    // === 新增：墓场检索 ===
    function searchGraveyard() {
        cancelSelection();
        const state = global.GameState.getState();
        if (!state) return;
        const cards = state.players.self.graveyard.slice().reverse();
        if (global.ViewerUI) {
            global.ViewerUI.show(cards, '墓场检索', (cardInstance) => {
                let targetIndex = -1;
                for (const idx of PUBLIC_REVEAL_ORDER) {
                    if (state.publicField[idx] === null) {
                        targetIndex = idx;
                        break;
                    }
                }
                if (targetIndex === -1) {
                    if (global.UI && global.UI.showNotification) global.UI.showNotification('公共区已满', 'warning');
                    return;
                }
                const s = global.CardActions.moveCard(cardInstance.instanceId, global.GameState.ZONE.PUBLIC_FIELD, targetIndex);
                if (s) {
                    if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                } else {
                    if (global.UI && global.UI.showNotification) global.UI.showNotification('检索失败', 'error');
                }
            });
        }
    }

    // === 新增：放逐区检索 ===
    function searchExile() {
        cancelSelection();
        const state = global.GameState.getState();
        if (!state) return;
        const cards = state.players.self.exile.slice().reverse();
        if (global.ViewerUI) {
            global.ViewerUI.show(cards, '放逐区检索', (cardInstance) => {
                let targetIndex = -1;
                for (const idx of PUBLIC_REVEAL_ORDER) {
                    if (state.publicField[idx] === null) {
                        targetIndex = idx;
                        break;
                    }
                }
                if (targetIndex === -1) {
                    if (global.UI && global.UI.showNotification) global.UI.showNotification('公共区已满', 'warning');
                    return;
                }
                const s = global.CardActions.moveCard(cardInstance.instanceId, global.GameState.ZONE.PUBLIC_FIELD, targetIndex);
                if (s) {
                    if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                } else {
                    if (global.UI && global.UI.showNotification) global.UI.showNotification('检索失败', 'error');
                }
            });
        }
    }

    function toggleActive(card) {
        cancelSelection();
        if (!card) return;
        card.active = !card.active;
        if (global.UI && global.UI.applyCardMarkers) global.UI.applyCardMarkers();
        if (card.owner === 'self' && global.SyncManager && global.Network && global.Network.getState().isConnected) {
            global.SyncManager.sendPublicState('self');
        }
    }

    function modifyStats(card, anchorEl) {
        // ... 保持原有实现 ...
    }

    function positionMenu(menuEl, anchorEl) {
        // ... 保持原有实现 ...
    }

    // ========== 菜单入口 ==========
    function playToFront(card) { card.faceDown = false; startSelection(card, 'frontField'); }
    function activateToBack(card) { card.faceDown = false; startSelection(card, 'backField'); }
    function payToCost(card) { card.faceDown = false; startSelection(card, 'costZone'); }
    function setFaceDown(card) { startSelectionMultiZone(card, ['frontField', 'backField'], true); }

    global.MenuAction = {
        playToFront,
        activateToBack,
        payToCost,
        returnToHand,
        discard,
        exile,
        returnToDeck,
        setFaceDown,
        toggleFaceDown,
        returnToMainDeckTop,
        returnToMainDeckBottom,
        publicReveal,
        viewGraveyard,
        viewExile,
        searchDeck,
        searchGraveyard,   // 新增
        searchExile,       // 新增
        cancelSelection,
        toggleActive,
        modifyStats
    };
})(window);