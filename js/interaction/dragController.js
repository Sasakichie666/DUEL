// js/interaction/dragController.js
// 拖拽控制器：卡牌在任意区域间自由拖拽，支持从主牌库 / 费用牌库拖出，禁止移动对方卡牌。
// 框架整理：
//   · 鼠标与触摸原本各写了一套几乎相同的"按下/移动/松开"逻辑（约 130 行重复），
//     现统一为 beginDrag / moveDrag / endDrag 三个核心函数，事件层只负责取坐标
//   · 卡牌查找统一走 CardActions（原先本文件也有一份重复实现）
//   · 费用手牌 / 费用区不参与拖拽（操作统一走「费用牌界面」批量面板）

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

    // 卡牌实例查找：统一走 CardActions（原先这里也有一份几乎相同的重复实现）
    function getCardByInstanceId(instanceId) {
        const CA = global.CardActions;
        if (!CA || typeof CA.getCardInstance !== 'function') return null;
        return CA.getCardInstance(instanceId);
    }

    function isDraggableCard(el) {
        // 费用手牌与费用区不再支持拖拽（操作统一走「费用牌界面 / 费用区界面」批量面板）
        if (el.closest('#self-hand-cost') || el.closest('.cost-zone')) return false;
        return el.classList.contains('card-full') &&
               !el.classList.contains('detail-card');
    }

    function findDropTarget(e) {
        const elements = document.elementsFromPoint(e.clientX, e.clientY)
            .filter(el => !el.classList.contains('dragging-ghost'));
        for (const el of elements) {
            // 费用区不再是拖拽落点（支付统一在「费用牌界面」里批量执行）
            if (el.closest && el.closest('.cost-zone')) continue;
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

    // ========== 拖拽上下文标记 ==========
    // 给 body 打上「卡牌类型」与「来源」标记，供 CSS 精确控制哪些格子该浮现：
    //   随从 → 只亮前场 / 战术 → 只亮后场 / 费用 → 只亮费用区
    //   从牌库拖出的卡看不到类型（牌背），按"可移动到任意区域"处理（前后场 + 费用区都浮现）
    const DRAG_CONTEXT_CLASSES = [
        'drag-type-minion', 'drag-type-tactic', 'drag-type-cost', 'drag-type-other',
        'drag-from-hand', 'drag-from-field', 'drag-from-deck'
    ];

    function clearDragContext() {
        DRAG_CONTEXT_CLASSES.forEach(cls => document.body.classList.remove(cls));
    }

    function markDragContext() {
        clearDragContext();

        // 来源
        if (dragData && dragData.fromDeck) {
            document.body.classList.add('drag-from-deck');
        } else if (dragSourceEl && dragSourceEl.closest && dragSourceEl.closest('#self-hand')) {
            document.body.classList.add('drag-from-hand');
        } else if (dragSourceEl && dragSourceEl.closest && dragSourceEl.closest('.field-slot')) {
            document.body.classList.add('drag-from-field');
        }

        // 卡牌类型
        let card = dragData && dragData.cardData;
        if (!card && dragData && dragData.cardId && global.CardLibrary) {
            card = global.CardLibrary.getCardById(dragData.cardId);
        }
        const type = (card && ['minion', 'tactic', 'cost'].includes(card.type)) ? card.type : 'other';
        document.body.classList.add('drag-type-' + type);
    }

    // ========== 拖拽核心（鼠标 / 触摸共用一套逻辑） ==========

    /** 当前是否由我方控制（转移控制权后，我方不能再操作它 ✓） */
    function controlledByMe(card) {
        return global.ControlManager
            ? global.ControlManager.isMine(card)
            : ((card.controller || card.owner) === 'self');
    }

    function distance(x, y) {
        const dx = x - startX;
        const dy = y - startY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /** 记录拖拽起点 */
    function armDrag(data, sourceEl, x, y) {
        dragData = data;
        dragSourceEl = sourceEl;
        dragCancelled = false;
        startX = x;
        startY = y;
        isDragging = false;
    }

    /**
     * 按下时的命中检测：可拖拽卡牌 / 自己牌库的牌背 → 记录起点
     * @returns {boolean} 是否进入待拖拽状态（true 时调用方 preventDefault）
     */
    function beginDrag(targetEl, x, y) {
        if (!targetEl) return false;
        if (window.__isEquipSelecting) return false;              // 装备选择中禁用拖拽
        if (targetEl.closest('.viewer-card')) return false;        // 查阅面板里的卡不参与
        if (isOpponentPileSlot(targetEl)) return false;            // 对手的墓地/放逐堆不可拖

        const cardEl = targetEl.closest('.card-full');
        if (cardEl && isDraggableCard(cardEl)) {
            const instanceId = getInstanceIdFromElement(cardEl);
            if (!instanceId) return false;
            const card = getCardByInstanceId(instanceId);
            if (!card) return false;
            armDrag(card, cardEl, x, y);
            return true;
        }

        const deckBack = targetEl.closest('.deck-card-back');
        if (deckBack) {
            const deckType = deckBack.getAttribute('data-drag-source');
            const player = deckBack.getAttribute('data-player');
            if (!deckType || player !== 'self') return false;      // 只能拖自己的牌库
            armDrag({ fromDeck: true, deckType, player }, deckBack, x, y);
            return true;
        }
        return false;
    }

    /** 移动：超过阈值才真正开拖；对手的卡牌直接取消 */
    function moveDrag(x, y, e) {
        if (!dragData) return;

        if (!isDragging) {
            if (distance(x, y) < DRAG_THRESHOLD) return;

            if (!controlledByMe(dragData)) {                        // 兜底：非我方控制的卡不可移动 ✓
                dragCancelled = true;
                cleanupDrag();
                return;
            }

            isDragging = true;
            document.body.classList.add('drag-active');
            markDragContext();
            const ghostSource = dragSourceEl
                || document.querySelector(`[data-instance-id="${dragData.instanceId}"]`);
            ghostEl = createGhost(ghostSource);
        }

        e.preventDefault();
        updateGhostPosition({ clientX: x, clientY: y });
        highlightTarget(findDropTarget({ clientX: x, clientY: y }));
    }

    /** 松开：拖过 → 落子；没拖（视作点击）→ 弹右键菜单 */
    function endDrag(x, y) {
        if (window.__isEquipSelecting) { cleanupDrag(); return; }
        if (!dragData) return;

        if (isDragging) {
            const target = findDropTarget({ clientX: x, clientY: y });
            if (target) performDrop(dragData, target);
            cleanupDrag();
            return;
        }

        if (dragCancelled) { cleanupDrag(); return; }
        if (distance(x, y) > CLICK_THRESHOLD) { cleanupDrag(); return; }

        if (dragData.fromDeck) {
            const deckType = dragSourceEl && dragSourceEl.getAttribute('data-drag-source');
            if (global.ContextMenu && dragSourceEl && deckType) {
                global.ContextMenu.handleDeckClick(deckType, dragSourceEl);
            }
        } else if (dragSourceEl) {
            // 注意：这里【不】拦截非我方控制的卡 —— 点对方的卡要能弹出「复制」菜单 ✓
            //（真正的拖动早已在 moveDrag 里被 controlledByMe 拦掉了 ✓）
            global.ContextMenu?.handleCardClick(dragData, dragSourceEl);
        }
        cleanupDrag();
    }

    // ========== 鼠标事件（薄适配层：只负责取坐标） ==========
    function onMouseDown(e) {
        if (beginDrag(e.target, e.clientX, e.clientY)) e.preventDefault();
    }

    function onMouseMove(e) {
        moveDrag(e.clientX, e.clientY, e);
    }

    function onMouseUp(e) {
        endDrag(e.clientX, e.clientY);
    }

    // ========== 触摸事件（薄适配层：只负责取坐标，逻辑全部复用上面的核心） ==========
    function onTouchStart(e) {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        if (beginDrag(targetEl, touch.clientX, touch.clientY)) e.preventDefault();
    }

    function onTouchMove(e) {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        moveDrag(touch.clientX, touch.clientY, e);
    }

    function onTouchEnd(e) {
        const touch = e.changedTouches[0];
        endDrag(touch.clientX, touch.clientY);
    }

    // ========== 放置逻辑 ==========
    /**
     * 执行放置：从牌库拖出的走 moveCardFromDeckToZone，其余走 moveCard。
     * （原来两个分支各自复制了一遍"刷新 + 联机同步"，现合并）
     */
    function performDrop(card, targetEl) {
        const zone = determineZone(targetEl);
        if (!zone) return;
        const index = determineIndex(targetEl);

        const ok = (dragData && dragData.fromDeck)
            ? global.CardActions.moveCardFromDeckToZone(dragData.player, dragData.deckType, zone, index)
            : global.CardActions.moveCard(card.instanceId, zone, index);

        if (!ok) return;
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
        if (global.SyncManager && global.SyncManager.sendPublicState) global.SyncManager.sendPublicState('self');
    }

    function determineZone(el) {
        if (el.closest('.field-row.public') || el.id === 'public-field') return global.GameState.ZONE.PUBLIC_FIELD;
        if (el.id === 'self-hand' || el.classList.contains('hand-zone')) return global.GameState.ZONE.HAND;
        if (el.closest('.field-row.front')) return global.GameState.ZONE.FRONT_FIELD;
        if (el.closest('.field-row.back')) return global.GameState.ZONE.BACK_FIELD;
        // 费用区：findDropTarget 已经过滤掉 .cost-zone（不再支持拖到费用区），
        // 这里保留一条兜底（万一将来恢复拖拽，落点规则仍然是现成的）
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
        document.body.classList.remove('drag-active');
        clearDragContext();
        removeGhost();
        clearHighlight();
    }

    global.DragController = { init };
})(window);