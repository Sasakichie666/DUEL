// js/ui/deckBuilderUI.js
// 卡组管理器UI模块：负责卡牌库渲染、卡组槽位渲染、添加/移除卡牌、保存/加载/清空卡组
// 修改：使用事件委托，避免重复绑定；卡组数量动态读取配置

(function(global) {
    const DeckBuilderUI = {
        els: {
            cardLibrary: document.getElementById('cardLibrary'),
            libraryFilters: document.getElementById('libraryFilters'),
            mainDeckSlots: document.getElementById('mainDeckSlots'),
            costDeckSlots: document.getElementById('costDeckSlots'),
            legendDeckSlots: document.getElementById('legendDeckSlots'),
            mainDeckCount: document.getElementById('mainDeckCount'),
            mainDeckRule: document.getElementById('mainDeckRule'),
            costDeckRule: document.getElementById('costDeckRule'),
            legendDeckRule: document.getElementById('legendDeckRule'),
            deckValidationMsg: document.getElementById('deckValidationMsg'),
            btnSaveDeck: document.getElementById('btnSaveDeck'),
            btnLoadDeck: document.getElementById('btnLoadDeck'),
            btnClearDeck: document.getElementById('btnClearDeck'),
        },

        init() {
            this.loadFilters();          // 恢复上次的筛选条件（卡包 / 费用限定）
            this.loadSavedDeck();
            this.renderFilterBar();      // 卡包下拉 + 颜色圆点
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
            global.CardUI.renderCardLibrary(container, this.filters);   // ★带上筛选条件（卡包 / 费用限定）
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

        // ================= 卡牌库筛选（需求2/3：卡包 + 费用颜色限定） =================
        // 说明：这是一份"显示层筛选"，不影响卡牌数据；条件记在 localStorage，下次打开保持 ✓
        filters: { pack: '', colors: [] },

        FILTER_KEY: 'cardLibraryFilters',
        COLOR_KEYS: [['red', '红'], ['green', '绿'], ['blue', '蓝'], ['white', '白'],
                     ['purple', '紫'], ['yellow', '黄'], ['cyan', '青']],

        loadFilters() {
            try {
                const raw = localStorage.getItem(this.FILTER_KEY);
                if (!raw) return;
                const saved = JSON.parse(raw) || {};
                this.filters = {
                    pack: typeof saved.pack === 'string' ? saved.pack : '',
                    colors: Array.isArray(saved.colors) ? saved.colors : []
                };
            } catch (e) { /* 忽略损坏的存档 */ }
        },

        saveFilters() {
            try { localStorage.setItem(this.FILTER_KEY, JSON.stringify(this.filters)); } catch (e) { }
        },

        /** 卡包列表变了（新导出卡包）或筛选变化后，统一刷新「筛选栏 + 卡牌库」 */
        refreshLibrary() {
            this.renderFilterBar();
            this.renderCardLibrary();
        },

        renderFilterBar() {
            const bar = this.els.libraryFilters;
            if (!bar) return;

            const packs = (global.CardLibrary && global.CardLibrary.getLoadedPacks)
                ? global.CardLibrary.getLoadedPacks() : [];

            let html = '<div class="filter-row"><span class="filter-label">卡包</span>'
                + '<select id="filterPack"><option value="">全部卡包</option>';
            packs.forEach(p => {
                const sel = this.filters.pack === p.file ? ' selected' : '';
                html += `<option value="${p.file}"${sel}>${p.name}（${p.count}）</option>`;
            });
            html += '</select>';

            html += '<span class="filter-label" style="margin-left:10px;">费用限定</span><span class="filter-colors">';
            this.COLOR_KEYS.forEach(([key, cn]) => {
                const on = this.filters.colors.indexOf(key) >= 0 ? ' on' : '';
                html += `<span class="color-pick mini ${key}${on}" data-color="${key}" title="${cn}"></span>`;
            });
            const noneOn = this.filters.colors.indexOf('none') >= 0 ? ' on' : '';
            html += `<span class="color-pick mini none${noneOn}" data-color="none" title="无色（没有费用限定）"></span>`
                 + '<span class="filter-none-label">无色</span></span>';

            html += '<button class="btn mini-btn" id="btnReloadPacks" title="重新扫描 cardPacks/manifest.json">🔄 重新加载卡包</button>';
            html += '<button class="btn mini-btn" id="btnClearLibFilters" style="margin-left:auto;">清除筛选</button></div>';

            bar.innerHTML = html;
            this.bindFilterEvents(bar);
        },

        bindFilterEvents(bar) {
            const packSel = bar.querySelector('#filterPack');
            if (packSel) {
                packSel.addEventListener('change', () => {
                    this.filters.pack = packSel.value;
                    this.saveFilters();
                    this.renderCardLibrary();
                });
            }

            bar.querySelectorAll('.color-pick').forEach(dot => {
                dot.addEventListener('click', () => {
                    const color = dot.dataset.color;
                    const i = this.filters.colors.indexOf(color);
                    if (i >= 0) this.filters.colors.splice(i, 1);
                    else this.filters.colors.push(color);
                    this.saveFilters();
                    dot.classList.toggle('on', i < 0);
                    this.renderCardLibrary();
                });
            });

            const reloadBtn = bar.querySelector('#btnReloadPacks');
            if (reloadBtn) {
                reloadBtn.addEventListener('click', async () => {
                    if (!global.CardLibrary || !global.CardLibrary.loadCardPacks) return;
                    reloadBtn.disabled = true;
                    try {
                        await global.CardLibrary.loadCardPacks();   // 重新扫描 manifest + 卡包（完成后会自动刷新卡牌库与下拉）
                        this.showNotification('🔄 卡包已重新加载', 'success');
                    } finally {
                        reloadBtn.disabled = false;
                    }
                });
            }

            const clearBtn = bar.querySelector('#btnClearLibFilters');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    this.filters = { pack: '', colors: [] };
                    this.saveFilters();
                    this.refreshLibrary();
                });
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

            let validCount = 0;
            let missingCount = 0;
            // ★卡包是异步加载的：加载完成前不能把"还没加载出来"当成"卡牌已不存在" ✗
            const packsReady = (global.CardLibrary && global.CardLibrary.arePacksReady)
                ? global.CardLibrary.arePacksReady() : true;

            Object.keys(cardCounts).forEach(cardId => {
                const card = global.CardLibrary.getCardById(cardId);
                const count = cardCounts[cardId];
                if (!card) {
                    // 卡包中已不存在（或尚未加载完成）的卡牌：单独提示，不占用卡位
                    missingCount += count;
                    return;
                }
                validCount += count;
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

            if (missingCount > 0) {
                // 加载完成前显示"正在加载"，加载完仍缺失才提示"不在卡包中" ✓（避免开局误报 ✗）
                html += packsReady
                    ? `<div class="deck-card-missing">⚠️ 有 ${missingCount} 张卡牌不在当前卡包中（已忽略，不计入卡位）</div>`
                    : `<div class="deck-card-missing">⏳ 正在加载卡包…（${missingCount} 张卡牌待确认）</div>`;
            }

            // 用一行明确的进度提示替代「铺满空框」，避免 3 张卡看起来像已满
            const remain = maxSize - validCount;
            const pending = (missingCount > 0 && !packsReady) ? `（另有 ${missingCount} 张待确认）` : '';
            html += `<div class="deck-slot-summary${remain <= 0 ? ' full' : ''}">已选 ${validCount} / ${maxSize}${remain > 0 ? `，还可加入 ${remain} 张` : '，卡位已满'}${pending}</div>`;
            return html;
        },

        _buildCostDeckHtml(deck, maxSize) {
            let html = '';
            const cardCounts = {};
            deck.forEach(id => { cardCounts[id] = (cardCounts[id] || 0) + 1; });

            let validCount = 0;
            let missingCount = 0;

            Object.keys(cardCounts).forEach(cardId => {
                const card = global.CardLibrary.getCardById(cardId);
                const count = cardCounts[cardId];
                if (!card) {
                    missingCount += count;
                    return;
                }
                validCount += count;
                const emoji = (global.Cards && global.Cards.COST_COLOR_EMOJIS) ? global.Cards.COST_COLOR_EMOJIS[card.color] || '💎' : '💎';
                html += `<div class="deck-card-item" data-card-id="${cardId}" data-deck="cost" title="点击移除一张">
                    <span>${emoji} ${card.name} ×${count}</span>
                    <span class="remove-hint">✕</span>
                </div>`;
            });

            if (missingCount > 0) {
                html += `<div class="deck-card-missing">⚠️ 有 ${missingCount} 张卡牌不在当前卡包中（已忽略，不计入卡位）</div>`;
            }

            const remain = maxSize - validCount;
            html += `<div class="deck-slot-summary${remain <= 0 ? ' full' : ''}">已选 ${validCount} / ${maxSize}${remain > 0 ? `，还可加入 ${remain} 张` : '，卡位已满'}</div>`;
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

            // 规则标题：从 DECK_CONFIG 动态生成，改配置即同步（不再写死在 HTML 里）
            if (this.els.mainDeckRule) {
                this.els.mainDeckRule.textContent = `⚔️ 主卡组（每种最多${config.MAIN_DECK_MAX_COPIES}张，共${config.MAIN_DECK_SIZE}张）`;
            }
            if (this.els.costDeckRule) {
                this.els.costDeckRule.textContent = `💎 费用卡组（共${config.COST_DECK_SIZE}张，无限制）`;
            }
            if (this.els.legendDeckRule) {
                this.els.legendDeckRule.textContent = `📜 传说卡组（每种最多${config.LEGEND_DECK_MAX_COPIES}张，共${config.LEGEND_DECK_SIZE}张）`;
            }

            if (this.els.mainDeckCount) {
                const missing = status.missingTotal > 0 ? `（无效 ${status.missingTotal}）` : '';
                this.els.mainDeckCount.textContent =
                    `主卡组 ${status.mainCount}/${config.MAIN_DECK_SIZE}` +
                    ` | 费用 ${status.costCount}/${config.COST_DECK_SIZE}` +
                    ` | 传说 ${status.legendCount}/${config.LEGEND_DECK_SIZE}${missing}`;
                this.els.mainDeckCount.className = 'deck-count ' + (status.isDeckReady ? 'valid' : 'invalid');
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
                    if (status.missingTotal > 0) msg += (msg ? '；' : '') + `另有${status.missingTotal}张卡牌不在当前卡包中`;
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