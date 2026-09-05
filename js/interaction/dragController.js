// js/interaction/dragController.js
// 拖拽控制器：实现卡牌在任意区域间的自由拖拽，支持从主牌库/费用牌库拖拽，并禁止移动对方卡牌。
// 修改：仅装备选择状态下禁用拖拽；标记/顺序模式由 SidePanel 独立捕捉，不再影响拖拽

(function(global) {
    let isDragging = false;
    let dragData = null;
    let ghostEl = null;
    let targetZone = null;
    let startX = 0, startY = 0;
    let dragSourceEl = null;
    let dragCancelled = false;
    const DRAG_THRESHOLD = 3;
    const CLICK_THRESHOLD = 4;

    function init() {
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchstart', onTouchStart, { passive: false });
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    }

    function getInstanceIdFromElement(el) {
        return el.getAttribute('data-instance-id');
    }

    function getCardByInstanceId(instanceId) {
        const state = global.GameState.getState();
        if (!state) return null;
        if (state.publicField) {
            const found = state.publicField.find(c => c && c.instanceId === instanceId);
            if (found) return found;
        }
        for (const playerKey of ['self', 'opponent']) {
            const player = state.players[playerKey];
            let found = player.hand.find(c => c && c.instanceId === instanceId);
            if (found) return found;
            found = player.frontField.find(c => c && c.instanceId === instanceId);
            if (found) return found;
            found = player.backField.find(c => c && c.instanceId === instanceId);
            if (found) return found;
            found = player.costZone.find(c => c && c.instanceId === instanceId);
            if (found) return found;
            found = player.graveyard.find(c => c && c.instanceId === instanceId);
            if (found) return found;
            found = player.exile.find(c => c && c.instanceId === instanceId);
            if (found) return found;
            if (player.personalZone) {
                found = player.personalZone.find(c => c && c.instanceId === instanceId);
                if (found) return found;
            }
            found = player.mainDeck.find(c => c && c.instanceId === instanceId);
            if (found) return found;
            found = player.costDeck.find(c => c && c.instanceId === instanceId);
            if (found) return found;
        }
        return null;
    }

    function isDraggableCard(el) {
        return el.classList.contains('card-full') &&
               !el.classList.contains('detail-card');
    }

    function findDropTarget(e) {
        const elements = document.elementsFromPoint(e.clientX, e.clientY)
            .filter(el => !el.classList.contains('dragging-ghost'));
        for (const el of elements) {
            const target = el.closest('.field-slot, .deck-slot, #self-hand, .hand-zone');
            if (target) return target;
        }
        return null;
    }

    function highlightTarget(target) {
        if (targetZone === target) return;
        if (targetZone) targetZone.classList.remove('drop-highlight');
        targetZone = target;
        if (targetZone) targetZone.classList.add('drop-highlight');
    }

    function clearHighlight() {
        if (targetZone) {
            targetZone.classList.remove('drop-highlight');
            targetZone = null;
        }
    }

    function createGhost(sourceEl) {
        if (!sourceEl) return null;
        const ghost = sourceEl.cloneNode(true);
        ghost.style.position = 'fixed';
        ghost.style.width = sourceEl.offsetWidth + 'px';
        ghost.style.height = sourceEl.offsetHeight + 'px';
        ghost.style.pointerEvents = 'none';
        ghost.style.opacity = '0.7';
        ghost.style.zIndex = '9999';
        ghost.classList.add('dragging-ghost');
        document.body.appendChild(ghost);
        return ghost;
    }

    function updateGhostPosition(e) {
        if (ghostEl) {
            ghostEl.style.left = (e.clientX - ghostEl.offsetWidth / 2) + 'px';
            ghostEl.style.top = (e.clientY - ghostEl.offsetHeight / 2) + 'px';
        }
    }

    function removeGhost() {
        if (ghostEl) {
            ghostEl.remove();
            ghostEl = null;
        }
    }

    function isOpponentPileSlot(element) {
        const deckSlot = element.closest('.deck-slot');
        if (!deckSlot) return false;
        const type = deckSlot.getAttribute('data-type');
        if (type !== 'graveyard' && type !== 'exile') return false;
        const side = deckSlot.closest('.deck-zone')?.getAttribute('data-side');
        return side === 'opponent';
    }

    // ========== 鼠标事件 ==========
    function onMouseDown(e) {
        if (window.__isEquipSelecting) return;   // 仅装备选择时禁用
        if (e.target.closest('.viewer-card')) return;
        if (isOpponentPileSlot(e.target)) return;

        const cardEl = e.target.closest('.card-full');
        if (cardEl && isDraggableCard(cardEl)) {
            const instanceId = getInstanceIdFromElement(cardEl);
            if (!instanceId) return;
            dragData = getCardByInstanceId(instanceId);
            if (!dragData) return;
            dragSourceEl = cardEl;
            dragCancelled = false;
            startX = e.clientX;
            startY = e.clientY;
            isDragging = false;
            e.preventDefault();
            return;
        }

        const deckBack = e.target.closest('.deck-card-back');
        if (deckBack) {
            const deckType = deckBack.getAttribute('data-drag-source');
            const player = deckBack.getAttribute('data-player');
            if (deckType && player === 'self') {
                dragData = { fromDeck: true, deckType, player };
                dragSourceEl = deckBack;
                dragCancelled = false;
                startX = e.clientX;
                startY = e.clientY;
                isDragging = false;
                e.preventDefault();
            }
            return;
        }
    }

    function onMouseMove(e) {
        if (!dragData) return;
        if (!isDragging) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.sqrt(dx*dx + dy*dy) < DRAG_THRESHOLD) return;

            if (dragData.owner === 'opponent') {
                dragCancelled = true;
                cleanupDrag();
                return;
            }

            isDragging = true;
            if (dragSourceEl) {
                ghostEl = createGhost(dragSourceEl);
            } else {
                const originalEl = document.querySelector(`[data-instance-id="${dragData.instanceId}"]`);
                if (originalEl) ghostEl = createGhost(originalEl);
            }
        }
        if (isDragging) {
            e.preventDefault();
            updateGhostPosition(e);
            const target = findDropTarget(e);
            highlightTarget(target);
        }
    }

    function onMouseUp(e) {
        if (window.__isEquipSelecting) { cleanupDrag(); return; }
        if (!dragData) return;

        if (isDragging) {
            const target = findDropTarget(e);
            if (target) performDrop(dragData, target);
            cleanupDrag();
            return;
        }

        if (dragCancelled) {
            cleanupDrag();
            return;
        }

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.sqrt(dx*dx + dy*dy) > CLICK_THRESHOLD) {
            cleanupDrag();
            return;
        }

        if (dragData.fromDeck) {
            if (global.ContextMenu && dragSourceEl) {
                const deckType = dragSourceEl.getAttribute('data-drag-source');
                global.ContextMenu.handleDeckClick(deckType, dragSourceEl);
            }
        } else if (dragSourceEl) {
            if (dragData.owner !== 'self') {
                cleanupDrag();
                return;
            }
            global.ContextMenu?.handleCardClick(dragData, dragSourceEl);
        }
        cleanupDrag();
    }

    // ========== 触摸事件 ==========
    function onTouchStart(e) {
        if (window.__isEquipSelecting) return;
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);

        if (targetEl && targetEl.closest('.viewer-card')) return;
        if (isOpponentPileSlot(targetEl)) return;

        const cardEl = targetEl?.closest('.card-full');
        if (cardEl && isDraggableCard(cardEl)) {
            const instanceId = getInstanceIdFromElement(cardEl);
            if (!instanceId) return;
            dragData = getCardByInstanceId(instanceId);
            if (!dragData) return;
            dragSourceEl = cardEl;
            dragCancelled = false;
            startX = touch.clientX;
            startY = touch.clientY;
            isDragging = false;
            e.preventDefault();
            return;
        }
        const deckBack = targetEl?.closest('.deck-card-back');
        if (deckBack) {
            const deckType = deckBack.getAttribute('data-drag-source');
            const player = deckBack.getAttribute('data-player');
            if (deckType && player === 'self') {
                dragData = { fromDeck: true, deckType, player };
                dragSourceEl = deckBack;
                dragCancelled = false;
                startX = touch.clientX;
                startY = touch.clientY;
                isDragging = false;
                e.preventDefault();
            }
            return;
        }
    }

    function onTouchMove(e) {
        if (!dragData || e.touches.length !== 1) return;
        const touch = e.touches[0];
        if (!isDragging) {
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            if (Math.sqrt(dx*dx + dy*dy) < DRAG_THRESHOLD) return;
            if (dragData.owner === 'opponent') {
                dragCancelled = true;
                cleanupDrag();
                return;
            }
            isDragging = true;
            if (dragSourceEl) {
                ghostEl = createGhost(dragSourceEl);
            } else {
                const originalEl = document.querySelector(`[data-instance-id="${dragData.instanceId}"]`);
                if (originalEl) ghostEl = createGhost(originalEl);
            }
        }
        if (isDragging) {
            e.preventDefault();
            updateGhostPosition(touch);
            const target = findDropTarget(touch);
            highlightTarget(target);
        }
    }

    function onTouchEnd(e) {
        if (window.__isEquipSelecting) { cleanupDrag(); return; }
        if (!dragData) return;

        if (isDragging) {
            const touch = e.changedTouches[0];
            const target = findDropTarget(touch);
            if (target) performDrop(dragData, target);
            cleanupDrag();
            return;
        }

        if (dragCancelled) {
            cleanupDrag();
            return;
        }

        const touch = e.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.sqrt(dx*dx + dy*dy) > CLICK_THRESHOLD) {
            cleanupDrag();
            return;
        }

        if (dragData.fromDeck) {
            if (global.ContextMenu && dragSourceEl) {
                const deckType = dragSourceEl.getAttribute('data-drag-source');
                global.ContextMenu.handleDeckClick(deckType, dragSourceEl);
            }
        } else if (dragSourceEl) {
            if (dragData.owner !== 'self') {
                cleanupDrag();
                return;
            }
            global.ContextMenu?.handleCardClick(dragData, dragSourceEl);
        }
        cleanupDrag();
    }

    // ========== 放置逻辑 ==========
    function performDrop(card, targetEl) {
        const zone = determineZone(targetEl);
        if (!zone) return;
        const index = determineIndex(targetEl);

        if (dragSourceEl && dragSourceEl.classList.contains('deck-card-back') && dragData && dragData.fromDeck) {
            const deckType = dragData.deckType;
            const player = dragData.player;
            const success = global.CardActions.moveCardFromDeckToZone(player, deckType, zone, index);
            if (success) {
                if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                if (global.SyncManager && global.SyncManager.sendPublicState) global.SyncManager.sendPublicState('self');
            }
        } else {
            const success = global.CardActions.moveCard(card.instanceId, zone, index);
            if (success) {
                if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                if (global.SyncManager && global.SyncManager.sendPublicState) global.SyncManager.sendPublicState('self');
            }
        }
    }

    function determineZone(el) {
        if (el.closest('.field-row.public') || el.id === 'public-field') return global.GameState.ZONE.PUBLIC_FIELD;
        if (el.id === 'self-hand' || el.classList.contains('hand-zone')) return global.GameState.ZONE.HAND;
        if (el.closest('.field-row.front')) return global.GameState.ZONE.FRONT_FIELD;
        if (el.closest('.field-row.back')) return global.GameState.ZONE.BACK_FIELD;
        if (el.closest('.cost-zone')) return global.GameState.ZONE.COST_ZONE;
        if (el.classList.contains('deck-slot')) {
            const type = el.getAttribute('data-type');
            switch (type) {
                case 'main-deck': return global.GameState.ZONE.MAIN_DECK;
                case 'cost-deck': return global.GameState.ZONE.COST_DECK;
                case 'graveyard': return global.GameState.ZONE.GRAVEYARD;
                case 'exile': return global.GameState.ZONE.EXILE;
                case 'legend-deck': return global.GameState.ZONE.LEGEND_DECK;
                case 'personal-zone': return global.GameState.ZONE.PERSONAL_ZONE;
                default: return null;
            }
        }
        return null;
    }

    function determineIndex(el) {
        if (el.closest('.field-row.public')) return parseInt(el.getAttribute('data-index') || '0', 10);
        if (el.closest('.cost-zone')) {
            const costZone = el.closest('.cost-zone');
            const rowEl = el.closest('.cost-row');
            if (rowEl) {
                const rows = Array.from(costZone.querySelectorAll('.cost-row'));
                const rowIndex = rows.indexOf(rowEl);
                const colIndex = parseInt(el.getAttribute('data-index') || '0', 10);
                return rowIndex * 5 + colIndex;
            }
        }
        if (el.classList.contains('field-slot')) return parseInt(el.getAttribute('data-index') || '0', 10);
        if (el.classList.contains('deck-slot')) return 0;
        if (el.id === 'self-hand' || el.classList.contains('hand-zone')) return -1;
        return 0;
    }

    function cleanupDrag() {
        isDragging = false;
        dragData = null;
        dragSourceEl = null;
        dragCancelled = false;
        removeGhost();
        clearHighlight();
    }

    global.DragController = { init };
})(window);