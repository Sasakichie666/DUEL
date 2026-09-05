// js/ui/deckUI.js
// 牌库UI模块：管理双方牌库区（传说牌库、主牌库、墓场、个人区、费用牌库、放逐区）的创建与渲染
// 修改：传说牌库正常显示数量，牌背使用橙色底，符号与主牌库不同

(function(global) {
    const DeckUI = {
        /**
         * 创建一个牌库区容器
         * @param {string} side - 'self' 或 'opponent'
         * @returns {HTMLElement} 牌库区容器
         */
        createDeckZone(side) {
            const container = document.createElement('div');
            container.className = 'deck-zone';
            container.setAttribute('data-side', side);

            const zones = [
                { row: 0, col: 0, type: 'legend-deck', label: '传说牌库' },
                { row: 0, col: 1, type: 'main-deck', label: '主牌库' },
                { row: 0, col: 2, type: 'graveyard', label: '墓场' },
                { row: 1, col: 0, type: 'personal-zone', label: '个人区' },
                { row: 1, col: 1, type: 'cost-deck', label: '费用牌库' },
                { row: 1, col: 2, type: 'exile', label: '放逐区' },
            ];

            for (let row = 0; row < 2; row++) {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'deck-row';
                rowDiv.setAttribute('data-row', row);

                for (let col = 0; col < 3; col++) {
                    const zoneInfo = zones.find(z => z.row === row && z.col === col);
                    const slot = document.createElement('div');
                    slot.className = 'deck-slot empty';
                    slot.setAttribute('data-type', zoneInfo.type);
                    slot.setAttribute('data-index', col);
                    slot.setAttribute('title', zoneInfo.label);
                    slot.innerHTML = `<span class="slot-placeholder">${zoneInfo.label}</span>`;
                    rowDiv.appendChild(slot);
                }
                container.appendChild(rowDiv);
            }
            return container;
        },

        /**
         * 渲染牌库区（所有六格）
         * @param {HTMLElement} deckZoneContainer - 牌库区容器（.deck-zone）
         * @param {object} playerState - 玩家状态对象（来自 GameState）
         */
        renderDeckZone(deckZoneContainer, playerState) {
            if (!deckZoneContainer || !playerState) return;

            // 传说牌库（正常渲染数量，不再使用占位）
            this._renderPileSlot(
                deckZoneContainer.querySelector('[data-type="legend-deck"]'),
                playerState.legendDeck,
                'legendDeck'
            );

            // 主牌库
            this._renderPileSlot(
                deckZoneContainer.querySelector('[data-type="main-deck"]'),
                playerState.mainDeck,
                'mainDeck'
            );

            // 墓场（堆叠显示最上面一张）
            this._renderStackSlot(
                deckZoneContainer.querySelector('[data-type="graveyard"]'),
                playerState.graveyard,
                'graveyard'
            );

            // 个人区（堆叠显示最上面一张，自己正面，对手反面）
            const isOpponent = playerState.owner === 'opponent';
            this._renderStackSlot(
                deckZoneContainer.querySelector('[data-type="personal-zone"]'),
                playerState.personalZone,
                'personal-zone',
                isOpponent
            );

            // 费用牌库
            this._renderPileSlot(
                deckZoneContainer.querySelector('[data-type="cost-deck"]'),
                playerState.costDeck,
                'costDeck'
            );

            // 放逐区（堆叠显示最上面一张）
            this._renderStackSlot(
                deckZoneContainer.querySelector('[data-type="exile"]'),
                playerState.exile,
                'exile'
            );
        },

        /**
         * 渲染占位槽位（仅显示文字，无交互数据）
         */
        _renderPlaceholderSlot(slot, label) {
            if (!slot) return;
            slot.classList.add('empty');
            slot.innerHTML = `<span class="slot-placeholder">${label}</span>`;
        },

        /**
         * 渲染牌库类槽位（主牌库、费用牌库、传说牌库）：显示牌背和数量
         */
        _renderPileSlot(slot, pileArray, type) {
            if (!slot) return;
            const count = pileArray ? pileArray.length : 0;

            if (count === 0) {
                slot.classList.add('empty');
                const label = type === 'mainDeck' ? '主牌库' :
                              type === 'costDeck' ? '费用牌库' : '传说牌库';
                slot.innerHTML = `<span class="slot-placeholder">${label}</span>`;
                return;
            }

            slot.classList.remove('empty');
            slot.innerHTML = '';
            const cardBack = document.createElement('div');
            cardBack.className = `card-back deck-card-back ${type}`;
            // 根据牌库类型显示不同符号
            if (type === 'mainDeck') {
                cardBack.textContent = '🂠';
            } else if (type === 'costDeck') {
                cardBack.textContent = '💎';
            } else {
                cardBack.textContent = '🜲'; // 传说牌库专用符号
            }
            cardBack.setAttribute('data-drag-source', type);
            cardBack.setAttribute('data-player', slot.closest('.deck-zone').getAttribute('data-side'));
            slot.appendChild(cardBack);

            const countBadge = document.createElement('span');
            countBadge.className = 'deck-count-badge';
            countBadge.textContent = count;
            slot.appendChild(countBadge);
        },

        /**
         * 渲染堆叠槽位（墓场、放逐区、个人区）：显示最上面卡牌（可选正面/背面）和数量
         * 关键修改：堆叠区卡牌只添加 'stack-top' 类，不添加 'on-field' 类，避免样式冲突
         */
        _renderStackSlot(slot, stackArray, type, faceDown = false) {
            if (!slot) return;
            const count = stackArray ? stackArray.length : 0;

            if (count === 0) {
                slot.classList.add('empty');
                const label = type === 'graveyard' ? '墓场' : (type === 'exile' ? '放逐区' : '个人区');
                slot.innerHTML = `<span class="slot-placeholder">${label}</span>`;
                return;
            }

            slot.classList.remove('empty');
            slot.innerHTML = '';

            const topCard = stackArray[stackArray.length - 1];
            if (topCard) {
                const cardData = topCard.cardData || global.Cards.getCardById(topCard.cardId);
                if (cardData) {
                    // 关键：只使用 'stack-top' 类，避免同时匹配战场样式
                    const cardEl = global.CardUI.createCardElement(cardData, faceDown, 'stack-top');
                    cardEl.setAttribute('data-instance-id', topCard.instanceId);
                    cardEl.setAttribute('data-card-id', topCard.cardId);
                    slot.appendChild(cardEl);
                }
            }

            const countBadge = document.createElement('span');
            countBadge.className = 'deck-count-badge';
            countBadge.textContent = count;
            slot.appendChild(countBadge);
        },

        /**
         * 兼容旧接口：更新牌库数量（实际委托给 renderDeckZone）
         */
        updateDeckCounts(deckZoneContainer, playerState) {
            this.renderDeckZone(deckZoneContainer, playerState);
        },

        /**
         * 在指定格子放置卡牌（供其他模块调用）
         */
        placeCard(deckZone, row, col, card, faceDown = false) {
            const rows = deckZone.querySelectorAll('.deck-row');
            if (row < 0 || row >= rows.length) return false;
            const slots = rows[row].querySelectorAll('.deck-slot');
            if (col < 0 || col >= slots.length) return false;
            const slot = slots[col];
            slot.innerHTML = '';
            slot.classList.remove('empty');
            const cardEl = global.CardUI.createCardElement(card, faceDown, 'stack-top');
            slot.appendChild(cardEl);
            slot.setAttribute('data-card-id', card.id);
            return true;
        },

        /**
         * 移除指定格子上的卡牌
         */
        removeCard(deckZone, row, col) {
            const rows = deckZone.querySelectorAll('.deck-row');
            if (row < 0 || row >= rows.length) return false;
            const slots = rows[row].querySelectorAll('.deck-slot');
            if (col < 0 || col >= slots.length) return false;
            const slot = slots[col];
            slot.innerHTML = '';
            slot.classList.add('empty');
            const label = slot.getAttribute('title') || '';
            slot.innerHTML = `<span class="slot-placeholder">${label}</span>`;
            slot.removeAttribute('data-card-id');
            return true;
        },

        /**
         * 获取指定格子上的卡牌ID
         */
        getCardIdAt(deckZone, row, col) {
            const rows = deckZone.querySelectorAll('.deck-row');
            if (row < 0 || row >= rows.length) return null;
            const slots = rows[row].querySelectorAll('.deck-slot');
            if (col < 0 || col >= slots.length) return null;
            return slots[col].getAttribute('data-card-id') || null;
        }
    };

    global.DeckUI = DeckUI;
})(window);