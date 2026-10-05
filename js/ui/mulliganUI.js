// js/ui/mulliganUI.js
// 起始手牌（调度）界面：展示 4 张起手牌 → 点击标记「替换」→ 底部「确认保留」
// 遮罩层本身负责"背景调暗"；双方都确认后由 MulliganManager 调用 hide() 关闭

(function(global) {
    let overlay = null;
    let cardsEl = null;
    let statusEl = null;
    let confirmBtn = null;

    const selected = new Set();     // 标记为「替换」的卡牌 instanceId
    let onConfirmCb = null;
    let confirmed = false;          // 我方是否已点过「确认保留」

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.className = 'mulligan-overlay';
        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * 显示起始手牌界面
     * @param {object}   options
     * @param {Array}    options.cards     起手牌实例数组（4 张）
     * @param {boolean}  options.isFirst   是否先手（决定徽章文案）
     * @param {Function} options.onConfirm (replacedIds[]) => void
     */
    function show(options) {
        const opts = options || {};
        const cards = Array.isArray(opts.cards) ? opts.cards : [];
        onConfirmCb = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;
        selected.clear();
        confirmed = false;

        const el = ensureOverlay();
        el.innerHTML = '';
        el.classList.add('open');

        const panel = document.createElement('div');
        panel.className = 'mulligan-panel';

        // 标题 + 身份徽章
        const head = document.createElement('div');
        head.className = 'mulligan-head';
        const title = document.createElement('div');
        title.className = 'mulligan-title';
        title.textContent = '起始手牌';
        head.appendChild(title);
        const role = document.createElement('span');
        role.className = 'mulligan-role ' + (opts.isFirst ? 'first' : 'second');
        role.textContent = opts.isFirst ? '你先手' : '你后手';
        head.appendChild(role);
        panel.appendChild(head);

        // 提示
        const tip = document.createElement('div');
        tip.className = 'mulligan-tip';
        tip.textContent = '点击卡牌标记为「替换」（可多选），确认后替换的牌回到主牌库底，并从牌库顶补抽到 4 张';
        panel.appendChild(tip);

        // 卡牌行
        cardsEl = document.createElement('div');
        cardsEl.className = 'mulligan-cards';
        cards.forEach(card => cardsEl.appendChild(buildCard(card)));
        panel.appendChild(cardsEl);

        // 底部：状态 + 确认按钮
        const foot = document.createElement('div');
        foot.className = 'mulligan-foot';

        statusEl = document.createElement('div');
        statusEl.className = 'mulligan-status';
        foot.appendChild(statusEl);

        confirmBtn = document.createElement('button');
        confirmBtn.className = 'mulligan-confirm';
        confirmBtn.textContent = '确认保留';
        confirmBtn.addEventListener('click', handleConfirmClick);
        foot.appendChild(confirmBtn);

        panel.appendChild(foot);
        el.appendChild(panel);

        updateStatus();
    }

    function buildCard(instance) {
        // 手牌数组里是「实例」，卡面渲染需要「卡牌数据」（与 CardUI.renderHand 一致）
        const card = (instance && (instance.cardData
            || (global.CardLibrary && global.CardLibrary.getCardById(instance.cardId))))
            || instance;
        const node = global.CardUI
            ? global.CardUI.createCardElement(card, false, 'mulligan-card')
            : document.createElement('div');
        node.classList.add('mulligan-card');
        if (instance && instance.instanceId) node.dataset.instanceId = instance.instanceId;
        node.addEventListener('click', () => toggle(instance && instance.instanceId, node));
        return node;
    }

    /** 点击卡牌：切换「替换」标记 */
    function toggle(instanceId, node) {
        if (confirmed || !instanceId) return;
        if (selected.has(instanceId)) {
            selected.delete(instanceId);
            node.classList.remove('is-replaced');
        } else {
            selected.add(instanceId);
            node.classList.add('is-replaced');
        }
        updateStatus();
    }

    function updateStatus() {
        if (!statusEl) return;
        const total = cardsEl ? cardsEl.children.length : 0;
        statusEl.textContent = selected.size === 0
            ? `尚未标记替换：4 张全部保留（共 ${total} 张）`
            : `已标记替换 ${selected.size} / ${total} 张，确认后将从牌库顶补抽`;
    }

    function handleConfirmClick() {
        if (confirmed) return;
        confirmed = true;
        markWaiting();
        if (statusEl) statusEl.textContent = '等待对手确认保留…';
        const ids = Array.from(selected);
        if (onConfirmCb) onConfirmCb(ids);
    }

    /** 我方已确认（按钮置灰 + 文案变化） */
    function markWaiting() {
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = '已确认，等待对手…';
        }
        if (statusEl) statusEl.textContent = '等待对手确认保留…';
    }

    /** 对手已确认（更新底部提示） */
    function markOpponentReady() {
        if (!statusEl) return;
        statusEl.textContent = confirmed
            ? '双方已确认，正在结算起始手牌…'
            : '对手已确认，等待你确认保留…';
    }

    function hide() {
        if (overlay) {
            overlay.classList.remove('open');
            overlay.innerHTML = '';
        }
        cardsEl = null;
        statusEl = null;
        confirmBtn = null;
        selected.clear();
        confirmed = false;
        onConfirmCb = null;
    }

    function isConfirmed() {
        return confirmed;
    }

    global.MulliganUI = { show, hide, markWaiting, markOpponentReady, isConfirmed };
})(window);
