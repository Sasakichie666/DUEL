// js/ui/cardDetailUI.js
// 卡牌详情浮窗模块：悬停卡牌时显示完整信息（双栏布局）
// 修改：对手个人区卡牌不显示详情（通过 DOM 位置判断），自己的个人区正常显示

(function(global) {
    let detailPanel = null;
    let currentCardId = null;

    function ensurePanel() {
        if (detailPanel) return detailPanel;
        detailPanel = document.createElement('div');
        detailPanel.className = 'card-detail-panel';
        detailPanel.style.display = 'none';
        document.body.appendChild(detailPanel);
        return detailPanel;
    }

    function parseMultilineText(text) {
        if (!text) return '';
        return text.replace(/[？?]/g, '\n');
    }

    function show(cardInstance, anchorEl) {
        if (!cardInstance) return;

        // 谁在控制它（控制权转移后：owner 可能是对方，但牌由我使用 → 该给我看 ✓）
        const controlledByMe = global.ControlManager
            ? global.ControlManager.isMine(cardInstance)
            : ((cardInstance.controller || cardInstance.owner) === 'self');

        // 双重保险：对手个人区卡牌不显示详情（我控制中的牌除外 ✓）
        if (cardInstance.owner === 'opponent' && cardInstance.zone === 'personalZone' && !controlledByMe) {
            return;
        }

        // 对手的盖伏卡牌不显示详情（我控制中的牌除外 ✓：转移来的盖伏牌由我使用）
        if (cardInstance.faceDown && cardInstance.owner === 'opponent' && !controlledByMe) {
            return;
        }

        const cardData = cardInstance.cardData || global.CardLibrary.getCardById(cardInstance.cardId);
        if (!cardData) return;

        if (currentCardId === cardInstance.instanceId) return;

        const panel = ensurePanel();
        panel.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'detail-container';

        // ========== 左侧：卡牌本体 ==========
        const leftArea = document.createElement('div');
        leftArea.className = 'detail-left-area';

        // 卡面本体统一由 createDetailCard 构建（颜色条件 / 系列名 / 世界观 / 当前攻防）
        const cardEl = createDetailCard(cardData, cardInstance)
            || global.CardUI.createCardElement(cardData, false, 'detail-card');

        leftArea.appendChild(cardEl);

        // ========== 右侧：详细介绍区 ==========
        const rightArea = document.createElement('div');
        rightArea.className = 'detail-right-area';

        // 词条介绍
        const traitNames = [];
        if (cardData.nativeTraits && Array.isArray(cardData.nativeTraits)) {
            cardData.nativeTraits.forEach(name => {
                if (name && !traitNames.includes(name)) traitNames.push(name);
            });
        }
        if (cardInstance.traits && Array.isArray(cardInstance.traits)) {
            cardInstance.traits.forEach(name => {
                if (name && !traitNames.includes(name)) traitNames.push(name);
            });
        }

        if (traitNames.length > 0) {
            const traitHeader = document.createElement('div');
            traitHeader.className = 'detail-trait-header';
            traitHeader.textContent = '词条介绍';
            rightArea.appendChild(traitHeader);

            traitNames.forEach(name => {
                const traitDef = global.TraitLibrary ? global.TraitLibrary.getTrait(name) : null;
                const traitItem = document.createElement('div');
                traitItem.className = 'detail-trait-item';

                const traitNameEl = document.createElement('div');
                traitNameEl.className = 'detail-trait-name';
                traitNameEl.textContent = `◆ ${name}`;
                traitItem.appendChild(traitNameEl);

                if (traitDef) {
                    const traitDescEl = document.createElement('div');
                    traitDescEl.className = 'detail-trait-desc';
                    traitDescEl.textContent = parseMultilineText(traitDef.description);
                    traitItem.appendChild(traitDescEl);
                } else {
                    const traitDescEl = document.createElement('div');
                    traitDescEl.className = 'detail-trait-desc unknown';
                    traitDescEl.textContent = '未知词条（未在文本库中定义）';
                    traitItem.appendChild(traitDescEl);
                }
                rightArea.appendChild(traitItem);
            });
        }

        // 自定义文本
        if (cardInstance.customTexts && cardInstance.customTexts.length > 0) {
            const customHeader = document.createElement('div');
            customHeader.className = 'detail-custom-header';
            customHeader.textContent = '自定义文本';
            rightArea.appendChild(customHeader);

            cardInstance.customTexts.forEach(text => {
                const customItem = document.createElement('div');
                customItem.className = 'detail-custom-item';
                customItem.textContent = parseMultilineText(text);
                rightArea.appendChild(customItem);
            });
        }

        // ========== 装备效果 ==========
        const equipHeader = document.createElement('div');
        equipHeader.className = 'detail-equip-header';
        equipHeader.textContent = '装备效果';
        rightArea.appendChild(equipHeader);

        const equippedCards = cardInstance.equippedCards || [];
        if (equippedCards.length > 0) {
            equippedCards.forEach(equipCard => {
                const equipData = equipCard.cardData || global.CardLibrary.getCardById(equipCard.cardId);
                const equipText = equipData ? (equipData.effectText || equipData.description || equipData.name) : '未知装备';
                const equipItem = document.createElement('div');
                equipItem.className = 'detail-equip-item';
                equipItem.textContent = `◆ ${parseMultilineText(equipText)}`;
                rightArea.appendChild(equipItem);
            });
        } else {
            const noEquip = document.createElement('div');
            noEquip.className = 'detail-equip-empty';
            noEquip.textContent = '无装备';
            rightArea.appendChild(noEquip);
        }

        container.appendChild(leftArea);
        container.appendChild(rightArea);
        panel.appendChild(container);

        panel.style.position = 'fixed';
        panel.style.left = '50%';
        panel.style.top = '50%';
        panel.style.transform = 'translate(-50%, -50%)';
        panel.style.display = 'block';

        currentCardId = cardInstance.instanceId;
    }

    function hide() {
        if (detailPanel) {
            detailPanel.style.display = 'none';
        }
        currentCardId = null;
    }

    /**
     * 按某个卡牌 DOM 显示悬浮详情（悬浮事件的公共实现）。
     * 抽出来是为了让「折叠后的遮罩」也能复用同一套判读（用 elementsFromPoint 找回鼠标下方的卡）。
     */
    function hoverOnElement(cardEl) {
        if (!cardEl) return false;
        // 关键判断：对手个人区卡牌不显示详情
        const opponentPersonalSlot = cardEl.closest('.deck-zone[data-side="opponent"] .deck-slot[data-type="personal-zone"]');
        if (opponentPersonalSlot) return false;

        const instanceId = cardEl.getAttribute('data-instance-id');
        let cardInstance = null;
        if (instanceId) cardInstance = findCardInstance(instanceId);
        if (cardInstance) {
            show(cardInstance, cardEl);
            return true;
        }
        const cardId = cardEl.getAttribute('data-card-id');
        if (cardId) {
            const staticCard = global.CardLibrary.getCardById(cardId);
            if (staticCard) {
                show({
                    cardData: staticCard,
                    cardId: staticCard.id,
                    owner: 'self',
                    faceDown: false,
                    instanceId: 'static_' + staticCard.id,
                    traits: [],
                    customTexts: [],
                    equippedCards: [],
                    currentAttack: staticCard.attack ?? null,
                    currentDefense: staticCard.defense ?? null,
                }, cardEl);
                return true;
            }
        }
        return false;
    }

    function initHoverEvents() {
        document.addEventListener('mouseover', (e) => {
            if (window.__isEquipSelecting) return;
            const cardEl = e.target.closest('.card-full:not(.detail-card)');
            if (!cardEl) return;
            hoverOnElement(cardEl);
        });

        document.addEventListener('mouseout', (e) => {
            const cardEl = e.target.closest('.card-full:not(.detail-card)');
            if (cardEl && !e.relatedTarget?.closest('.card-detail-panel')) {
                hide();
            }
        });
    }

    /** 卡牌实例查找（统一走 CardActions，见其注释） */
    function findCardInstance(instanceId) {
        const CA = global.CardActions;
        if (!CA || typeof CA.getCardInstance !== 'function') return null;
        return CA.getCardInstance(instanceId);
    }

    /**
     * 构建一张「详情规格」的卡面（与悬浮详情面板完全一致）：
     * 颜色条件（restriction dots，由 createCardElement 依 detail-card 生成）
     * + 系列名 + 世界观文本（flavorText），并保证攻防值在底部。
     * 抽出来给其它面板复用（如响应连锁面板），规格永远与悬浮详情一致。
     * @param {object} cardData 卡牌数据（建议用卡库按 cardId 取到的完整数据）
     * @param {object} [instance] 卡牌实例（可选，用其 currentAttack/currentDefense）
     * @returns {HTMLElement|null}
     */
    function createDetailCard(cardData, instance) {
        if (!cardData || !global.CardUI) return null;
        const cardEl = global.CardUI.createCardElement(cardData, false, 'detail-card');
        if (!cardEl) return null;

        if (cardData.type === 'minion' && instance
            && instance.currentAttack != null && instance.currentDefense != null) {
            const atkBadge = cardEl.querySelector('.atk-badge');
            const defBadge = cardEl.querySelector('.def-badge');
            if (atkBadge) atkBadge.textContent = instance.currentAttack;
            if (defBadge) defBadge.textContent = instance.currentDefense;
        }

        const typeLabel = cardEl.querySelector('.card-type-label');
        if (typeLabel && cardData.series) {
            const seriesDiv = document.createElement('div');
            seriesDiv.className = 'card-series-detail';
            seriesDiv.textContent = cardData.series;
            typeLabel.insertAdjacentElement('afterend', seriesDiv);
        }

        if (cardData.flavorText) {
            const flavorDiv = document.createElement('div');
            flavorDiv.className = 'card-flavor-detail';
            flavorDiv.textContent = parseMultilineText(cardData.flavorText);
            cardEl.appendChild(flavorDiv);
        }

        const statsEl = cardEl.querySelector('.card-stats');
        const flavorEl = cardEl.querySelector('.card-flavor-detail');
        if (statsEl && flavorEl) cardEl.insertBefore(statsEl, flavorEl);

        return cardEl;
    }

    global.CardDetailUI = {
        show,
        hide,
        initHoverEvents,
        createDetailCard,
        hoverElement: hoverOnElement        // 供折叠遮罩"透传"鼠标悬停时复用同一套判读
    };
})(window);