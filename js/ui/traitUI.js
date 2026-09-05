// js/ui/traitUI.js
// 词条UI模块：负责在卡牌DOM上渲染词条标签和详情文本

(function(global) {
    const TraitLibrary = global.TraitLibrary;
    const TraitManager = global.TraitManager;

    /**
     * 在卡牌元素上渲染词条标签和自定义文本标记
     * @param {HTMLElement} cardEl - 卡牌DOM元素
     * @param {object} cardInstance - 卡牌实例
     */
    function renderCardTraits(cardEl, cardInstance) {
        if (!cardEl || !cardInstance) return;

        // 清除旧的标签容器
        let tagContainer = cardEl.querySelector('.trait-tags');
        if (tagContainer) tagContainer.remove();

        // 如果没有任何词条或自定义文本，直接返回
        const traits = TraitManager.getCardTraits(cardInstance);
        const customTexts = TraitManager.getCardCustomTexts(cardInstance);
        if (traits.length === 0 && customTexts.length === 0) return;

        tagContainer = document.createElement('div');
        tagContainer.className = 'trait-tags';

        // 添加词条标签
        traits.forEach(traitName => {
            const trait = TraitLibrary.getTrait(traitName);
            if (!trait) return;
            const badge = document.createElement('span');
            badge.className = `trait-badge trait-${trait.type}`;
            badge.textContent = trait.name;
            tagContainer.appendChild(badge);
        });

        // 添加自定义文本标记
        customTexts.forEach(text => {
            const custom = document.createElement('span');
            custom.className = 'custom-text-tag';
            custom.textContent = text;
            tagContainer.appendChild(custom);
        });

        cardEl.appendChild(tagContainer);
    }

    /**
     * 在卡牌详情元素上追加词条详细描述
     * @param {HTMLElement} detailCardEl - 详情卡牌DOM元素
     * @param {object} cardInstance - 卡牌实例
     */
    function appendDetailText(detailCardEl, cardInstance) {
        if (!detailCardEl || !cardInstance) return;

        const texts = TraitManager.getCardAllTexts(cardInstance);
        if (texts.length === 0) return;

        let detailContainer = detailCardEl.querySelector('.trait-detail');
        if (!detailContainer) {
            detailContainer = document.createElement('div');
            detailContainer.className = 'trait-detail';
            detailCardEl.appendChild(detailContainer);
        }

        // 清空并重建
        detailContainer.innerHTML = '';
        texts.forEach(item => {
            if (item.type === 'trait') {
                const line = document.createElement('div');
                line.className = 'trait-detail-line';
                line.innerHTML = `<span class="trait-name">◆ ${item.name}</span>：${item.description}`;
                detailContainer.appendChild(line);
            } else if (item.type === 'custom') {
                const line = document.createElement('div');
                line.className = 'custom-detail-line';
                line.textContent = item.text;
                detailContainer.appendChild(line);
            }
        });
    }

    global.TraitUI = {
        renderCardTraits,
        appendDetailText
    };
})(window);