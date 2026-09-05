// js/ui/viewerUI.js
// 查阅界面模块：用于查看墓场、放逐区、牌库等卡牌列表（正面显示），并支持点击卡牌回调

(function(global) {
    let overlay = null;
    let clickCallback = null;

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.className = 'viewer-overlay';
        overlay.style.display = 'none';
        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * 显示查阅界面
     * @param {Array} cardInstances - 卡牌实例数组（顶部在前）
     * @param {string} title - 标题
     * @param {Function} onCardClick - 点击卡牌时的回调，参数为卡牌实例
     */
    function show(cardInstances, title = '查阅', onCardClick = null) {
        const overlay = ensureOverlay();
        overlay.innerHTML = '';
        clickCallback = onCardClick;

        const content = document.createElement('div');
        content.className = 'viewer-content';

        const header = document.createElement('div');
        header.className = 'viewer-header';
        header.textContent = title;
        content.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'viewer-grid';

        if (!cardInstances || cardInstances.length === 0) {
            grid.innerHTML = '<div class="viewer-empty">没有卡牌</div>';
        } else {
            cardInstances.forEach(instance => {
                const cardData = instance.cardData || global.Cards.getCardById(instance.cardId);
                if (!cardData) return;
                const cardEl = global.CardUI.createCardElement(cardData, false, 'viewer-card');
                cardEl.dataset.instanceId = instance.instanceId;
                cardEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (typeof clickCallback === 'function') {
                        clickCallback(instance);
                    }
                    hide(); // 点击后关闭查阅界面
                });
                grid.appendChild(cardEl);
            });
        }

        content.appendChild(grid);
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
        // 关闭可能残留的卡牌详情
        if (global.CardDetailUI && global.CardDetailUI.hide) {
            global.CardDetailUI.hide();
        }
    }

    global.ViewerUI = {
        show,
        hide
    };
})(window);