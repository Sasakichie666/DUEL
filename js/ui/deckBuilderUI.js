// js/ui/deckBuilderUI.js
// 卡组管理器UI模块：负责卡牌库渲染、卡组槽位渲染、添加/移除卡牌、保存/加载/清空卡组
// 修改：使用事件委托，避免重复绑定；卡组数量动态读取配置

(function(global) {
    const DeckBuilderUI = {
        els: {
            cardLibrary: document.getElementById('cardLibrary'),
            mainDeckSlots: document.getElementById('mainDeckSlots'),
            costDeckSlots: document.getElementById('costDeckSlots'),
            legendDeckSlots: document.getElementById('legendDeckSlots'),
            mainDeckCount: document.getElementById('mainDeckCount'),
            deckValidationMsg: document.getElementById('deckValidationMsg'),
            btnSaveDeck: document.getElementById('btnSaveDeck'),
            btnLoadDeck: document.getElementById('btnLoadDeck'),
            btnClearDeck: document.getElementById('btnClearDeck'),
        },

        init() {
            this.loadSavedDeck();
            this.renderCardLibrary();
            this.renderDeckSlots();
            this.bindEvents();
            this.updateDeckStatus();
        },

        loadSavedDeck() {
            const saved = localStorage.getItem('savedDeck');
            if (saved) {
                const result = global.DeckManager.loadDeck();
                if (result.success) {
                    console.log('[DeckBuilderUI] 已加载保存的卡组');
                } else {
                    console.warn('[DeckBuilderUI] 加载卡组失败:', result.error);
                }
            }
        },

        renderCardLibrary() {
            const container = this.els.cardLibrary;
            if (!container) return;
            global.CardUI.renderCardLibrary(container);
            // 使用事件委托绑定点击（只绑定一次）
            if (!container._deckBuilderClickBound) {
                container.addEventListener('click', (e) => {
                    const cardEl = e.target.closest('.card-full');
                    if (!cardEl) return;
                    const cardId = cardEl.getAttribute('data-card-id');
                    const card = global.CardLibrary.getCardById(cardId);
                    if (!card) return;

                    if (global.DeckManager.hasSeries(card, '传说')) {
                        const result = global.DeckManager.addCardToLegendDeck(cardId);
                        if (result.error) this.showNotification(result.error, 'error');
                        else this.showNotification(`已添加「${card.name}」到传说卡组`, 'success', 1500);
                    } else if (card.type === 'cost') {
                        const result = global.DeckManager.addCardToCostDeck(cardId);
                        if (result.error) this.showNotification(result.error, 'error');
                        else this.showNotification(`已添加「${card.name}」到费用卡组`, 'success', 1500);
                    } else {
                        const result = global.DeckManager.addCardToMainDeck(cardId);
                        if (result.error) this.showNotification(result.error, 'error');
                        else this.showNotification(`已添加「${card.name}」到主卡组`, 'success', 1500);
                    }
                    this.renderDeckSlots();
                });
                container._deckBuilderClickBound = true;
            }
        },

        renderDeckSlots() {
            const mainContainer = this.els.mainDeckSlots;
            const costContainer = this.els.costDeckSlots;
            const legendContainer = this.els.legendDeckSlots;
            if (!mainContainer || !costContainer || !legendContainer) return;

            const mainDeck = global.DeckManager.getMainDeck();
            const costDeck = global.DeckManager.getCostDeck();
            const legendDeck = global.DeckManager.getLegendDeck();
            const config = global.DeckManager.DECK_CONFIG;

            // 渲染三个卡组槽位
            mainContainer.innerHTML = this._buildDeckHtml(mainDeck, config.MAIN_DECK_SIZE, 'main');
            costContainer.innerHTML = this._buildCostDeckHtml(costDeck, config.COST_DECK_SIZE);
            legendContainer.innerHTML = this._buildDeckHtml(legendDeck, config.LEGEND_DECK_SIZE, 'legend');

            this.updateDeckStatus();
        },

        _buildDeckHtml(deck, maxSize, deckType) {
            let html = '';
            const cardCounts = {};
            deck.forEach(id => { cardCounts[id] = (cardCounts[id] || 0) + 1; });
            Object.keys(cardCounts).forEach(cardId => {
                const card = global.CardLibrary.getCardById(cardId);
                if (!card) return;
                const count = cardCounts[cardId];
                let detail = '';
                if (deckType === 'main' && card.type === 'minion') detail = `⚔️${card.attack} 🛡️${card.defense}`;
                else if (card.type === 'tactic') detail = '✨ 战术';
                else if (card.type === 'cost') detail = '💎 费用';
                html += `<div class="deck-card-item" data-card-id="${cardId}" data-deck="${deckType}" title="点击移除一张">
                    <span>${card.name} ×${count}</span>
                    ${detail ? `<span style="color:var(--text-secondary);font-size:0.65rem;">(${card.cost}费 ${detail})</span>` : ''}
                    <span class="remove-hint">✕</span>
                </div>`;
            });
            const used = Object.values(cardCounts).reduce((a,b) => a+b, 0);
            for (let i = used; i < maxSize; i++) html += '<div class="empty-slot">空</div>';
            return html;
        },

        _buildCostDeckHtml(deck, maxSize) {
            let html = '';
            const cardCounts = {};
            deck.forEach(id => { cardCounts[id] = (cardCounts[id] || 0) + 1; });
            Object.keys(cardCounts).forEach(cardId => {
                const card = global.CardLibrary.getCardById(cardId);
                if (!card) return;
                const count = cardCounts[cardId];
                const emoji = (global.Cards && global.Cards.COST_COLOR_EMOJIS) ? global.Cards.COST_COLOR_EMOJIS[card.color] || '💎' : '💎';
                html += `<div class="deck-card-item" data-card-id="${cardId}" data-deck="cost" title="点击移除一张">
                    <span>${emoji} ${card.name} ×${count}</span>
                    <span class="remove-hint">✕</span>
                </div>`;
            });
            const used = Object.values(cardCounts).reduce((a,b) => a+b, 0);
            for (let i = used; i < maxSize; i++) html += '<div class="empty-slot">空</div>';
            return html;
        },

        bindEvents() {
            // 卡组槽位移除事件：使用事件委托绑定在三个容器上（只绑定一次）
            const containerMap = {
                main: this.els.mainDeckSlots,
                cost: this.els.costDeckSlots,
                legend: this.els.legendDeckSlots
            };
            Object.entries(containerMap).forEach(([deckType, container]) => {
                if (!container || container._removeBound) return;
                container.addEventListener('click', (e) => {
                    const item = e.target.closest('.deck-card-item');
                    if (!item) return;
                    const cardId = item.getAttribute('data-card-id');
                    if (deckType === 'main') {
                        const mainDeckArr = global.DeckManager.getMainDeck();
                        const index = mainDeckArr.indexOf(cardId);
                        if (index !== -1) {
                            const result = global.DeckManager.removeCardFromMainDeck(index);
                            if (result.success) { this.showNotification(`已移除一张「${result.cardName}」`, 'info', 1200); this.renderDeckSlots(); }
                        }
                    } else if (deckType === 'cost') {
                        const costDeckArr = global.DeckManager.getCostDeck();
                        const index = costDeckArr.indexOf(cardId);
                        if (index !== -1) {
                            const result = global.DeckManager.removeCardFromCostDeck(index);
                            if (result.success) { this.showNotification(`已移除一张「${result.cardName}」`, 'info', 1200); this.renderDeckSlots(); }
                        }
                    } else if (deckType === 'legend') {
                        const legendDeckArr = global.DeckManager.getLegendDeck();
                        const index = legendDeckArr.indexOf(cardId);
                        if (index !== -1) {
                            const result = global.DeckManager.removeCardFromLegendDeck(index);
                            if (result.success) { this.showNotification(`已移除一张「${result.cardName}」`, 'info', 1200); this.renderDeckSlots(); }
                        }
                    }
                });
                container._removeBound = true;
            });

            // 保存/加载/清空按钮
            if (this.els.btnSaveDeck) this.els.btnSaveDeck.addEventListener('click', () => {
                const result = global.DeckManager.saveDeck();
                if (result.error) this.showNotification(result.error, 'error');
                else this.showNotification('💾 卡组保存成功！', 'success');
            });
            if (this.els.btnLoadDeck) this.els.btnLoadDeck.addEventListener('click', () => {
                const result = global.DeckManager.loadDeck();
                if (result.error) this.showNotification(result.error, 'warning');
                else { this.showNotification('📂 卡组加载成功！', 'success'); this.renderDeckSlots(); }
            });
            if (this.els.btnClearDeck) this.els.btnClearDeck.addEventListener('click', () => {
                global.DeckManager.clearDeck();
                this.renderDeckSlots();
                this.showNotification('🗑️ 卡组已清空', 'info');
            });
        },

        updateDeckStatus() {
            const status = global.DeckManager.getDeckStatus();
            const config = global.DeckManager.DECK_CONFIG;
            if (this.els.mainDeckCount) {
                this.els.mainDeckCount.textContent = `主卡组: ${status.mainCount}/${config.MAIN_DECK_SIZE} | 传说: ${status.legendCount}/${config.LEGEND_DECK_SIZE}`;
                this.els.mainDeckCount.className = 'deck-count ' + (status.mainOk && status.legendOk ? 'valid' : 'invalid');
            }
            if (this.els.deckValidationMsg) {
                if (status.isDeckReady) {
                    this.els.deckValidationMsg.textContent = '✅ 卡组合法！可以开始对战。';
                    this.els.deckValidationMsg.style.color = 'var(--success)';
                } else {
                    let msg = '';
                    if (!status.mainOk) msg += `主卡组需要${config.MAIN_DECK_SIZE}张（当前${status.mainCount}张）`;
                    if (!status.costOk) msg += (msg ? '，' : '') + `费用卡组需要${config.COST_DECK_SIZE}张（当前${status.costCount}张）`;
                    if (!status.legendOk) msg += (msg ? '，' : '') + `传说卡组需要${config.LEGEND_DECK_SIZE}张（当前${status.legendCount}张）`;
                    this.els.deckValidationMsg.textContent = '⚠️ ' + msg;
                    this.els.deckValidationMsg.style.color = 'var(--warning)';
                }
            }
            if (global.Network) {
                global.Network.setMyDeckReady(status.isDeckReady);
            }
        },

        showNotification(message, type = 'info', duration = 3000) {
            if (global.UI && global.UI.showNotification) {
                global.UI.showNotification(message, type, duration);
            } else {
                console.log(message);
            }
        }
    };

    global.DeckBuilderUI = DeckBuilderUI;
})(window);