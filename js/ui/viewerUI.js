// js/ui/viewerUI.js
// 查阅界面模块：用于查看墓场、放逐区、牌库等卡牌列表（正面显示），并支持搜索过滤和点击回调
// 修改：增加搜索框，优化文本显示界面

(function(global) {
    let overlay = null;
    let clickCallback = null;
    let cardElements = [];

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.className = 'viewer-overlay';
        overlay.style.display = 'none';
        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * 显示卡牌列表界面
     * @param {Array} cardInstances - 卡牌实例数组（顶部在前）
     * @param {string} title - 标题
     * @param {Function} onCardClick - 点击卡牌时的回调，参数为卡牌实例
     */
    function show(cardInstances, title = '查阅', onCardClick = null) {
        const overlay = ensureOverlay();
        overlay.innerHTML = '';
        clickCallback = onCardClick;
        cardElements = [];

        const content = document.createElement('div');
        content.className = 'viewer-content';

        // 头部
        const header = document.createElement('div');
        header.className = 'viewer-header';
        header.textContent = title;

        // 搜索框
        const searchBox = document.createElement('div');
        searchBox.className = 'viewer-search';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '🔍 搜索卡牌名称...';
        searchInput.addEventListener('input', () => {
            filterCards(searchInput.value.trim().toLowerCase());
        });
        searchBox.appendChild(searchInput);

        // 卡牌网格
        const grid = document.createElement('div');
        grid.className = 'viewer-grid';
        grid.id = 'viewerCardGrid';

        content.appendChild(header);
        content.appendChild(searchBox);
        content.appendChild(grid);
        overlay.appendChild(content);

        // 渲染卡牌
        renderCards(cardInstances, grid);

        overlay.style.display = 'flex';

        // 点击遮罩关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                hide();
            }
        });
    }

    function renderCards(cardInstances, grid) {
        grid.innerHTML = '';
        cardElements = [];

        if (!cardInstances || cardInstances.length === 0) {
            grid.innerHTML = '<div class="viewer-empty">没有卡牌</div>';
            return;
        }

        cardInstances.forEach(instance => {
            const cardData = instance.cardData || global.CardLibrary.getCardById(instance.cardId);
            if (!cardData) return;

            const cardEl = global.CardUI.createCardElement(cardData, false, 'viewer-card');
            cardEl.dataset.instanceId = instance.instanceId;
            cardEl.dataset.cardId = instance.cardId;
            cardEl.dataset.name = cardData.name.toLowerCase(); // 用于搜索过滤

            cardEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof clickCallback === 'function') {
                    clickCallback(instance);
                }
                hide(); // 点击后关闭查阅界面
            });

            grid.appendChild(cardEl);
            cardElements.push(cardEl);
        });
    }

    function filterCards(keyword) {
        if (!cardElements.length) return;
        cardElements.forEach(cardEl => {
            const name = cardEl.dataset.name || '';
            if (name.includes(keyword)) {
                cardEl.style.display = '';
            } else {
                cardEl.style.display = 'none';
            }
        });
    }

    /**
     * 显示纯文本界面（用于规则说明等）
     * @param {string} title - 标题
     * @param {Array<string>} lines - 文本行数组，每行单独显示
     */
    function showText(title, lines) {
        const overlay = ensureOverlay();
        overlay.innerHTML = '';

        const content = document.createElement('div');
        content.className = 'viewer-content viewer-text-content';

        const header = document.createElement('div');
        header.className = 'viewer-header';
        header.textContent = title;
        content.appendChild(header);

        const textArea = document.createElement('div');
        textArea.className = 'viewer-text-lines';
        lines.forEach(line => {
            const p = document.createElement('p');
            p.textContent = line;
            textArea.appendChild(p);
        });
        content.appendChild(textArea);

        overlay.appendChild(content);
        overlay.style.display = 'flex';

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                hide();
            }
        });
    }

    function hide() {
        if (overlay) {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
        }
        clickCallback = null;
        cardElements = [];
        if (global.CardDetailUI && global.CardDetailUI.hide) {
            global.CardDetailUI.hide();
        }
    }

    global.ViewerUI = {
        show,
        showText,
        hide
    };
})(window);