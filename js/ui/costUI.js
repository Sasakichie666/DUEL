// js/ui/costUI.js
// 费用区UI模块：管理双方费用区（两排各5个格子，正方形）的创建与渲染

(function(global) {
    const CostUI = {
        /**
         * 创建一个费用区容器（包含两排，每排5个格子）
         * @param {string} side - 'self' 或 'opponent'
         * @returns {HTMLElement} 费用区容器
         */
        createCostZone(side) {
            const container = document.createElement('div');
            container.className = 'cost-zone';
            container.setAttribute('data-side', side);

            for (let row = 0; row < 2; row++) {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'field-row cost-row';
                rowDiv.setAttribute('data-cost-row', row);

                for (let i = 0; i < 5; i++) {
                    const slot = global.CardUI.createEmptySlot('cost');
                    slot.setAttribute('data-index', i);
                    rowDiv.appendChild(slot);
                }
                container.appendChild(rowDiv);
            }
            return container;
        },

        /**
         * 渲染费用区（两排共10格）
         * @param {HTMLElement} container - 费用区容器（可能是 .cost-zone 本身或其父容器）
         * @param {Array} costArray - 长度为10的数组，元素为卡牌实例或null
         * @param {boolean} faceDown - 是否背面显示（通常费用卡正面）
         */
        renderCostZone(container, costArray, faceDown = false) {
            const costZone = container.classList.contains('cost-zone') ? container : container.querySelector('.cost-zone');
            if (!costZone) return;

            const rows = costZone.querySelectorAll('.cost-row');
            if (!rows || rows.length !== 2) return;

            const totalSlots = costArray.length; // 应为10
            const slotsPerRow = 5;

            let index = 0;
            for (let r = 0; r < 2; r++) {
                const rowEl = rows[r];
                const slots = rowEl.querySelectorAll('.field-slot');
                // 如果格子数量不对，重新创建
                if (!slots || slots.length !== slotsPerRow) {
                    rowEl.innerHTML = '';
                    for (let i = 0; i < slotsPerRow; i++) {
                        const slot = global.CardUI.createEmptySlot('cost');
                        slot.setAttribute('data-index', i);
                        rowEl.appendChild(slot);
                    }
                }

                const updatedSlots = rowEl.querySelectorAll('.field-slot');
                for (let s = 0; s < slotsPerRow; s++) {
                    const slot = updatedSlots[s];
                    if (index < totalSlots) {
                        const cardInstance = costArray[index];
                        if (cardInstance) {
                            slot.classList.remove('empty');
                            slot.innerHTML = '';
                            const card = cardInstance.cardData || global.Cards.getCardById(cardInstance.cardId);
                            if (card) {
                                const cardEl = global.CardUI.createCardElement(card, faceDown, 'on-field cost-card');
                                cardEl.setAttribute('data-instance-id', cardInstance.instanceId);
                                cardEl.setAttribute('data-card-id', card.id);
                                slot.appendChild(cardEl);
                                slot.setAttribute('data-card-id', card.id);
                                if (global.CardUI.fitCardContent) {
                                    global.CardUI.fitCardContent(cardEl);
                                }
                            }
                        } else {
                            slot.classList.add('empty');
                            slot.innerHTML = '<span class="slot-placeholder">＋</span>';
                            slot.removeAttribute('data-card-id');
                        }
                    }
                    index++;
                }
            }
        },

        /**
         * 在指定排指定格子放置卡牌（供其他模块调用）
         */
        placeCard(costZone, row, index, card, faceDown = false) {
            const rows = costZone.querySelectorAll('.cost-row');
            if (row < 0 || row >= rows.length) return false;
            const slots = rows[row].querySelectorAll('.field-slot');
            if (index < 0 || index >= slots.length) return false;
            const slot = slots[index];
            slot.innerHTML = '';
            slot.classList.remove('empty');
            const cardEl = global.CardUI.createCardElement(card, faceDown, 'on-field cost-card');
            slot.appendChild(cardEl);
            slot.setAttribute('data-card-id', card.id);
            return true;
        },

        /**
         * 移除指定排指定格子上的卡牌
         */
        removeCard(costZone, row, index) {
            const rows = costZone.querySelectorAll('.cost-row');
            if (row < 0 || row >= rows.length) return false;
            const slots = rows[row].querySelectorAll('.field-slot');
            if (index < 0 || index >= slots.length) return false;
            const slot = slots[index];
            slot.innerHTML = '';
            slot.classList.add('empty');
            slot.innerHTML = '<span class="slot-placeholder">＋</span>';
            slot.removeAttribute('data-card-id');
            return true;
        },

        /**
         * 获取指定排指定格子上的卡牌ID
         */
        getCardIdAt(costZone, row, index) {
            const rows = costZone.querySelectorAll('.cost-row');
            if (row < 0 || row >= rows.length) return null;
            const slots = rows[row].querySelectorAll('.field-slot');
            if (index < 0 || index >= slots.length) return null;
            return slots[index].getAttribute('data-card-id') || null;
        }
    };

    global.CostUI = CostUI;
})(window);