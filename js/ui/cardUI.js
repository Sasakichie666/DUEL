// js/ui/cardUI.js
// 卡牌UI子模块：负责创建卡牌DOM、手牌渲染、卡牌库纯渲染（不包含卡组管理事件）
// 修改：使用 DeckManager.hasSeries 支持逗号分隔多系列识别；传说卡牌背使用橙色底

(function(global) {
    function fitCardContent(cardEl) {
        // 空函数
    }

    // 从文本中提取颜色标记（'红'、'绿'、'蓝'、'白'、'紫'、'黄'、'青'）
    function parseColorTokens(text) {
        if (!text) return [];
        const colorMap = {
            '红': 'red', '绿': 'green', '蓝': 'blue', '白': 'white',
            '紫': 'purple', '黄': 'yellow', '青': 'cyan'
        };
        const colors = [];
        const regex = /[''""](红|绿|蓝|白|紫|黄|青)[''""]/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const color = colorMap[match[1]];
            if (color) colors.push(color);
        }
        return colors;
    }

    // 解析效果文本：处理 ？ 换行，< 左对齐，'颜色' 转换为颜色圆点，【词条】高亮
    function parseEffectText(text) {
        if (!text) return '';
        const lines = text.split(/[？?]/);
        let html = '';
        lines.forEach(line => {
            let alignStyle = 'text-align:left;';
            let content = line;
            if (content.startsWith('<')) {
                content = content.substring(1);
                alignStyle = 'text-align:left;padding-left:8px;';
            }
            content = content.replace(/'(红|绿|蓝|白|紫|黄|青)'/g, (match, color) => {
                const colorMap = {
                    '红': 'red', '绿': 'green', '蓝': 'blue', '白': 'white',
                    '紫': 'purple', '黄': 'yellow', '青': 'cyan'
                };
                return `<span class="color-dot ${colorMap[color]}"></span>`;
            });
            content = content.replace(/【([^】]+)】/g, '<span class="trait-highlight">$1</span>');
            html += `<div class="effect-line" style="${alignStyle}">${content}</div>`;
        });
        return html;
    }

    // 生成费用限定圆点 HTML（card.costRestriction 为原始文本）
    function createRestrictionDots(card) {
        if (card.costRestriction) {
            const colors = parseColorTokens(card.costRestriction);
            if (colors.length > 0) {
                const dots = colors.map(color => `<span class="color-dot ${color}"></span>`).join('');
                return `<div class="card-restriction">${dots}</div>`;
            }
        }
        return '';
    }

    const CardUI = {
        createCardElement(card, faceDown = false, extraClass = '') {
            const el = document.createElement('div');
            el.className = `card-full ${extraClass}`;
            if (faceDown) {
                el.classList.add('face-down');
                // 根据卡牌类型和系列选择牌背样式
                let backClass;
                if (global.DeckManager && global.DeckManager.hasSeries(card, '传说')) {
                    backClass = 'deck-card-back legendDeck';   // 传说牌背（橙色底）
                } else if (card.type === 'cost') {
                    backClass = 'deck-card-back costDeck';
                } else {
                    backClass = 'deck-card-back mainDeck';
                }
                const symbol = card.type === 'cost' ? '💎' : '🂠';
                el.innerHTML = `<div class="${backClass}">${symbol}</div>`;
                el.setAttribute('data-card-id', card.id);
                return el;
            }

            el.setAttribute('data-card-id', card.id);
            const desc = card.effectText || card.description || '';
            const effectHtml = parseEffectText(desc);

            const showRestriction = extraClass.includes('in-hand') || extraClass.includes('detail-card');
            const restrictionHtml = showRestriction ? createRestrictionDots(card) : '';

            const isStackTop = extraClass.includes('stack-top');
            const isViewer = extraClass.includes('viewer-card');
            const effectSection = (isStackTop || isViewer) ? '' : `<div class="card-effect">${effectHtml}</div>`;

            if (card.type === 'minion') {
                el.classList.add('minion');
                el.innerHTML = `
                    <div class="card-cost">${card.cost}</div>
                    ${restrictionHtml}
                    <div class="card-name">${card.name}</div>
                    <div class="card-type-label">随从</div>
                    <div class="card-stats">
                        <span class="stat-badge atk-badge">${card.attack}</span>
                        <span class="stat-badge def-badge">${card.defense}</span>
                    </div>
                    ${effectSection}
                `;
            } else if (card.type === 'tactic') {
                el.classList.add('tactic');
                el.innerHTML = `
                    <div class="card-cost">${card.cost}</div>
                    ${restrictionHtml}
                    <div class="card-name">${card.name}</div>
                    <div class="card-type-label">战术</div>
                    ${effectSection}
                `;
            } else if (card.type === 'cost') {
                el.classList.add('cost');
                const emoji = (global.Cards && global.Cards.COST_COLOR_EMOJIS) ? global.Cards.COST_COLOR_EMOJIS[card.color] || '💎' : '💎';
                el.innerHTML = `
                    <div class="card-name">${emoji} ${card.name}</div>
                    <div class="card-type-label">费用</div>
                    ${effectSection}
                    ${restrictionHtml}
                `;
                el.classList.add(`color-${card.color}`);
            }
            return el;
        },

        createEmptySlot(slotType = 'front') {
            const el = document.createElement('div');
            el.className = `field-slot empty ${slotType}`;
            el.innerHTML = '<span class="slot-placeholder">＋</span>';
            return el;
        },

        renderHand(handContainer, cardInstances, faceDown = false) {
            if (!handContainer) return;

            let costContainer = handContainer.querySelector('#self-hand-cost');
            let mainContainer = handContainer.querySelector('#self-hand-main');
            let divider = handContainer.querySelector('.hand-divider');

            if (!costContainer) {
                costContainer = document.createElement('div');
                costContainer.className = 'hand-subzone';
                costContainer.id = 'self-hand-cost';
            }
            if (!mainContainer) {
                mainContainer = document.createElement('div');
                mainContainer.className = 'hand-subzone';
                mainContainer.id = 'self-hand-main';
            }
            if (!divider) {
                divider = document.createElement('div');
                divider.className = 'hand-divider';
            }

            costContainer.innerHTML = '';
            mainContainer.innerHTML = '';
            handContainer.innerHTML = '';
            handContainer.appendChild(costContainer);
            handContainer.appendChild(divider);
            handContainer.appendChild(mainContainer);

            if (!cardInstances || cardInstances.length === 0) {
                mainContainer.innerHTML = '<div class="hand-placeholder">主手牌区</div>';
                costContainer.innerHTML = '<div class="hand-placeholder">费用手牌区</div>';
                return;
            }

            cardInstances.forEach(instance => {
                if (!instance) return;
                const card = instance.cardData || global.CardLibrary.getCardById(instance.cardId);
                if (!card) return;
                const cardEl = CardUI.createCardElement(card, faceDown, 'in-hand');
                cardEl.setAttribute('data-instance-id', instance.instanceId);
                cardEl.setAttribute('data-card-id', card.id);

                if (card.type === 'cost') {
                    costContainer.appendChild(cardEl);
                } else {
                    mainContainer.appendChild(cardEl);
                }

                if (CardUI.fitCardContent) CardUI.fitCardContent(cardEl);
            });
        },

        renderCardLibrary(container) {
            const CardLibrary = global.CardLibrary;
            if (!CardLibrary) return;

            let html = '<h3>📚 卡牌库</h3>';

            const allCards = CardLibrary.getAllCards();

            // 传说卡类别（使用 hasSeries 判断，支持多系列）
            const legendCards = allCards.filter(card => global.DeckManager && global.DeckManager.hasSeries(card, '传说'));
            html += `<div class="card-section"><h4>📜 传说卡 (${legendCards.length}种)</h4><div class="card-grid">`;
            legendCards.forEach(card => {
                const desc = card.effectText || card.description || '';
                const effectHtml = parseEffectText(desc);
                const restrictionHtml = createRestrictionDots(card);
                if (card.type === 'minion') {
                    html += `
                        <div class="card-full minion" data-card-id="${card.id}">
                            <div class="card-cost">${card.cost}</div>
                            ${restrictionHtml}
                            <div class="card-name">${card.name}</div>
                            <div class="card-type-label">随从</div>
                            <div class="card-stats">
                                <span class="stat-badge atk-badge">${card.attack}</span>
                                <span class="stat-badge def-badge">${card.defense}</span>
                            </div>
                            <div class="card-effect">${effectHtml}</div>
                        </div>`;
                } else if (card.type === 'tactic') {
                    html += `
                        <div class="card-full tactic" data-card-id="${card.id}">
                            <div class="card-cost">${card.cost}</div>
                            ${restrictionHtml}
                            <div class="card-name">${card.name}</div>
                            <div class="card-type-label">战术</div>
                            <div class="card-effect">${effectHtml}</div>
                        </div>`;
                }
            });
            html += '</div></div>';

            // 随从卡（排除传说）
            const minions = CardLibrary.getCardsByType('minion').filter(card => !(global.DeckManager && global.DeckManager.hasSeries(card, '传说')));
            html += `<div class="card-section"><h4>⚔️ 随从卡 (${minions.length}种)</h4><div class="card-grid">`;
            minions.forEach(card => {
                const desc = card.effectText || card.description || '';
                const effectHtml = parseEffectText(desc);
                const restrictionHtml = createRestrictionDots(card);
                html += `
                    <div class="card-full minion" data-card-id="${card.id}">
                        <div class="card-cost">${card.cost}</div>
                        ${restrictionHtml}
                        <div class="card-name">${card.name}</div>
                        <div class="card-type-label">随从</div>
                        <div class="card-stats">
                            <span class="stat-badge atk-badge">${card.attack}</span>
                            <span class="stat-badge def-badge">${card.defense}</span>
                        </div>
                        <div class="card-effect">${effectHtml}</div>
                    </div>`;
            });
            html += '</div></div>';

            // 战术卡（排除传说）
            const tactics = CardLibrary.getCardsByType('tactic').filter(card => !(global.DeckManager && global.DeckManager.hasSeries(card, '传说')));
            html += `<div class="card-section"><h4>✨ 战术卡 (${tactics.length}种)</h4><div class="card-grid">`;
            tactics.forEach(card => {
                const desc = card.effectText || card.description || '';
                const effectHtml = parseEffectText(desc);
                const restrictionHtml = createRestrictionDots(card);
                html += `
                    <div class="card-full tactic" data-card-id="${card.id}">
                        <div class="card-cost">${card.cost}</div>
                        ${restrictionHtml}
                        <div class="card-name">${card.name}</div>
                        <div class="card-type-label">战术</div>
                        <div class="card-effect">${effectHtml}</div>
                    </div>`;
            });
            html += '</div></div>';

            // 费用卡
            const costCards = CardLibrary.getCardsByType('cost');
            html += `<div class="card-section"><h4>💎 费用卡 (${costCards.length}种颜色)</h4><div class="card-grid">`;
            costCards.forEach(card => {
                const desc = card.effectText || card.description || '';
                const effectHtml = parseEffectText(desc);
                const restrictionHtml = createRestrictionDots(card);
                const emoji = (global.Cards && global.Cards.COST_COLOR_EMOJIS) ? global.Cards.COST_COLOR_EMOJIS[card.color] || '💎' : '💎';
                html += `
                    <div class="card-full cost color-${card.color}" data-card-id="${card.id}">
                        <div class="card-name">${emoji} ${card.name}</div>
                        <div class="card-type-label">费用</div>
                        <div class="card-effect">${effectHtml}</div>
                        ${restrictionHtml}
                    </div>`;
            });
            html += '</div></div>';

            container.innerHTML = html;
        },

        fitCardContent
    };

    global.CardUI = CardUI;
})(window);