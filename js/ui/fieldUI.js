// js/ui/fieldUI.js
// 战场UI子模块：管理前场后场格子，并负责渲染

(function(global) {
    const FieldUI = {
        /**
         * 创建一个战场区域（前场或后场）
         * @param {string} side - 'self' 或 'opponent'
         * @param {string} zone - 'front' 或 'back'
         * @param {number} slotCount - 格子数量（默认5）
         * @returns {HTMLElement} 战场容器
         */
        createFieldZone(side, zone, slotCount = 5) {
            const container = document.createElement('div');
            container.className = `field-zone ${zone}`;
            container.setAttribute('data-side', side);
            container.setAttribute('data-zone', zone);

            for (let i = 0; i < slotCount; i++) {
                const slot = global.CardUI.createEmptySlot(zone);
                slot.setAttribute('data-index', i);
                container.appendChild(slot);
            }
            return container;
        },

        /**
         * 渲染战场格子（前场/后场）
         * @param {HTMLElement} container - 包含 .field-zone 的容器
         * @param {Array} fieldArray - 长度为5的数组，元素为卡牌实例或null
         * @param {string} side - 'self' 或 'opponent'
         * @param {string} zoneType - 'front' 或 'back'
         * @param {boolean} faceDown - 是否背面显示（默认值，可被实例属性覆盖）
         */
        renderFieldZone(container, fieldArray, side, zoneType, faceDown = false) {
            const zoneEl = container.querySelector('.field-zone');
            if (!zoneEl) return;

            // 确保格子数量匹配
            const slots = zoneEl.querySelectorAll('.field-slot');
            if (!slots || slots.length !== fieldArray.length) {
                zoneEl.innerHTML = '';
                for (let i = 0; i < fieldArray.length; i++) {
                    const slot = global.CardUI.createEmptySlot(zoneType);
                    slot.setAttribute('data-index', i);
                    zoneEl.appendChild(slot);
                }
            }

            const updatedSlots = zoneEl.querySelectorAll('.field-slot');
            fieldArray.forEach((cardInstance, index) => {
                const slot = updatedSlots[index];
                if (!slot) return;
                if (cardInstance) {
                    slot.classList.remove('empty');
                    slot.innerHTML = '';
                    const card = cardInstance.cardData || global.Cards.getCardById(cardInstance.cardId);
                    if (card) {
                        // 确定实际是否背面：优先使用卡牌实例自身的 faceDown 属性
                        const actualFaceDown = cardInstance.faceDown !== undefined ? cardInstance.faceDown : faceDown;
                        const cardEl = global.CardUI.createCardElement(card, actualFaceDown, 'on-field');
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
            });
        },

        /**
         * 将卡牌放置到指定格子上（供其他模块调用）
         */
        placeCard(fieldZone, index, card, faceDown = false) {
            const slots = fieldZone.querySelectorAll('.field-slot');
            if (index < 0 || index >= slots.length) return false;
            const slot = slots[index];
            slot.innerHTML = '';
            slot.classList.remove('empty');
            const cardEl = global.CardUI.createCardElement(card, faceDown, 'on-field');
            slot.appendChild(cardEl);
            slot.setAttribute('data-card-id', card.id);
            return true;
        },

        /**
         * 移除格子上的卡牌
         */
        removeCard(fieldZone, index) {
            const slots = fieldZone.querySelectorAll('.field-slot');
            if (index < 0 || index >= slots.length) return false;
            const slot = slots[index];
            slot.innerHTML = '';
            slot.classList.add('empty');
            slot.innerHTML = '<span class="slot-placeholder">＋</span>';
            slot.removeAttribute('data-card-id');
            return true;
        },

        /**
         * 获取某个格子上的卡牌ID
         */
        getCardIdAt(fieldZone, index) {
            const slots = fieldZone.querySelectorAll('.field-slot');
            if (index < 0 || index >= slots.length) return null;
            return slots[index].getAttribute('data-card-id') || null;
        }
    };

    global.FieldUI = FieldUI;
})(window);