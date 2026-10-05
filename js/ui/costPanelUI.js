// js/ui/costPanelUI.js
// 「费用牌界面 / 费用区界面」批量面板（一个面板两种模式）：
//   · 点卡片 → 按点击先后标号 1、2、3…（再点一次取消，后面自动重排）
//   · 底部按钮 → 按标号顺序依次执行
//   · 费用手牌（mode='hand'）：支付 / 进墓 / 放逐 / 回顶 / 回底
//   · 费用区  （mode='zone'）：切换 / 回手 / 进墓 / 放逐 / 回顶 / 回底 / 调换（须恰好选 2 张）
//
// 打开方式：点击「费用牌区域」（#self-hand-cost）或「费用区」（#self-cost-zone）。
// 说明：回顶 / 回底一律回【费用牌库】，不再让玩家挑牌库 ✓（与需求一致）

(function(global) {
    let overlay = null;
    let parts = null;
    let mode = 'hand';          // 'hand' | 'zone'
    let order = [];             // 已选中的 instanceId，按点击先后
    let collapsed = false;      // 折叠状态（整个会话记住，与查阅面板一致）
    let hoverRaf = 0;           // 折叠态"鼠标透传"的合帧句柄
    let lastHoverEl = null;

    const TITLE = { hand: '费用牌', zone: '费用区' };

    const ACTIONS = {
        hand: [
            { value: 'pay', label: '支付', tone: 'primary' },
            { value: 'discard', label: '进墓', tone: 'danger' },
            { value: 'exile', label: '放逐', tone: 'danger' },
            { value: 'top', label: '回顶', tone: 'danger' },
            { value: 'bottom', label: '回底', tone: 'danger' }
        ],
        zone: [
            { value: 'toggle', label: '切换', tone: 'primary' },
            { value: 'return', label: '回手', tone: 'danger' },
            { value: 'discard', label: '进墓', tone: 'danger' },
            { value: 'exile', label: '放逐', tone: 'danger' },
            { value: 'top', label: '回顶', tone: 'danger' },
            { value: 'bottom', label: '回底', tone: 'danger' },
            { value: 'swap', label: '调换（选两张）', tone: 'swap' }
        ]
    };

    function selfPlayer() {
        return global.GameState ? global.GameState.getPlayerState('self') : null;
    }

    /** 面板要展示的卡牌实例（费用手牌 = 手牌里 type==='cost' 的那些） */
    function cardsOf() {
        const p = selfPlayer();
        if (!p) return [];
        if (mode === 'zone') return (p.costZone || []).filter(Boolean);
        return (p.hand || []).filter(c => c && c.cardData && c.cardData.type === 'cost');
    }

    function cardDataOf(inst) {
        if (!inst) return null;
        return inst.cardData || (global.Cards && global.Cards.getCardById
            ? global.Cards.getCardById(inst.cardId) : null);
    }

    function notify(msg, type) {
        if (global.UI && global.UI.showNotification) global.UI.showNotification(msg, type || 'info', 2200);
    }

    /* ================= 骨架 ================= */

    function build() {
        if (overlay && document.body.contains(overlay)) return overlay;

        // ★复用查阅面板的整套外观类（pv-*）：卡片尺寸用同一套 viewer-card 标准 ✓
        //   折叠样式也直接沿用 .pv-overlay.pv-collapsed（折叠后不变暗 + 悬停看牌 ✓）
        overlay = document.createElement('div');
        overlay.className = 'pv-overlay cost-panel';
        overlay.innerHTML =
            '<div class="pv-panel" role="dialog" aria-modal="true">'
            + '  <header class="pv-head">'
            + '    <div class="pv-title">'
            + '      <span class="pv-icon">💰</span>'
            + '      <h3 class="pv-title-text">费用牌界面</h3>'
            + '      <span class="pv-count">0</span>'
            + '    </div>'
            + '    <div class="pv-tools">'
            + '      <button type="button" class="pv-btn cp-picked">已选 0</button>'
            + '      <button type="button" class="pv-btn pv-fold" title="折叠（方便看手牌与战场）">▾</button>'
            + '      <button type="button" class="pv-btn pv-close" title="关闭（Esc）">✕</button>'
            + '    </div>'
            + '  </header>'
            + '  <div class="pv-filters"><span class="cp-tip">点击卡牌按顺序标号 1、2、3…；再点一次取消。下面按钮会按这个顺序执行。</span></div>'
            + '  <div class="pv-body"><div class="pv-grid"></div></div>'
            + '  <footer class="pv-foot"><div class="pv-actions"></div></footer>'
            + '</div>';

        document.body.appendChild(overlay);
        overlay.style.display = 'none';   // ★必须：.pv-overlay 类本身是 display:flex，
                                          //   建完不显式隐藏 → 一进网站就会把面板顶在屏幕上 ✗

        parts = {
            head: overlay.querySelector('.pv-head'),
            title: overlay.querySelector('.pv-title-text'),
            count: overlay.querySelector('.pv-count'),
            picked: overlay.querySelector('.cp-picked'),
            fold: overlay.querySelector('.pv-fold'),
            close: overlay.querySelector('.pv-close'),
            body: overlay.querySelector('.pv-body'),
            grid: overlay.querySelector('.pv-grid'),
            actions: overlay.querySelector('.pv-actions')
        };

        parts.close.addEventListener('click', close);
        parts.fold.addEventListener('click', (e) => {
            e.stopPropagation();
            setCollapsed(!collapsed);
        });
        // 折叠状态下点标题栏即可展开（与查阅面板一致）
        parts.head.addEventListener('click', (e) => {
            if (collapsed) setCollapsed(false);
        });
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) close();          // 点空白处关闭
            e.stopPropagation();                        // 面板打开时不透传到牌桌
        });
        // 折叠态：遮罩挡住鼠标 → 用 elementsFromPoint 找回鼠标下方的卡牌显示详情（同查阅 ✓）
        overlay.addEventListener('mousemove', (e) => {
            if (!collapsed || hoverRaf) return;
            const x = e.clientX, y = e.clientY;
            hoverRaf = requestAnimationFrame(() => {
                hoverRaf = 0;
                forwardHover(x, y);
            });
        });
        overlay.addEventListener('mouseleave', () => {
            lastHoverEl = null;
            if (global.CardDetailUI && global.CardDetailUI.hide) global.CardDetailUI.hide();
        });
        document.addEventListener('keydown', (e) => {
            if (!overlay || overlay.style.display === 'none') return;
            const t = e.target;
            if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
            if ((e.key === 'f' || e.key === 'F')
                && !(t && typeof t.closest === 'function' && t.closest('.pv-tools'))) {
                e.preventDefault();
                setCollapsed(!collapsed);
            }
        }, true);   // 捕获阶段：避免被牌桌上的其它快捷键处理抢走（与查阅面板一致 ✓）

        return overlay;
    }

    /* ================= 折叠（与查阅面板一致：不变暗 + 仍可悬停看牌） ================= */

    function forwardHover(x, y) {
        const detail = global.CardDetailUI;
        if (!detail || typeof detail.hoverElement !== 'function') return;
        let cardEl = null;
        const stack = (document.elementsFromPoint ? document.elementsFromPoint(x, y) : []) || [];
        for (const el of stack) {
            if (!el || !el.classList) continue;
            if (overlay && overlay.contains(el)) continue;
            if (el.classList.contains('card-full') && !el.classList.contains('detail-card')) {
                cardEl = el;
                break;
            }
        }
        if (cardEl === lastHoverEl) return;
        lastHoverEl = cardEl;
        if (cardEl) detail.hoverElement(cardEl);
        else detail.hide();
    }

    function setCollapsed(v) {
        const was = collapsed;
        collapsed = !!v;
        if (overlay) overlay.classList.toggle('pv-collapsed', collapsed);
        if (parts && parts.fold) {
            parts.fold.textContent = collapsed ? '▸' : '▾';
            parts.fold.title = collapsed ? '展开面板' : '折叠（方便看手牌与战场，快捷键 F）';
        }
        if (was !== collapsed) {
            lastHoverEl = null;
            if (global.CardDetailUI && global.CardDetailUI.hide) global.CardDetailUI.hide();
        }
    }


    /* ================= 渲染 ================= */

    function render() {
        const cards = cardsOf();
        parts.title.textContent = TITLE[mode] + '界面';
        parts.count.textContent = String(cards.length);
        parts.picked.textContent = '已选 ' + order.length
            + (mode === 'zone' ? '（调换需 2 张）' : '');

        // 卡牌用查阅同款 viewer-card 标准 → 尺寸/悬停效果与查阅完全一致 ✓
        parts.grid.classList.remove('is-readonly');   // 本面板可点击 → 保留 pointer 光标与金色悬停 ✓
        parts.grid.innerHTML = '';

        if (!cards.length) {
            parts.body.innerHTML = '<div class="pv-empty">'
                + '<span class="pv-empty-icon">🕳</span>'
                + '<span class="pv-empty-text">这里还没有卡牌</span></div>';
            return;
        }
        // 空状态可能把 .pv-body 内容替换过 → 恢复网格容器
        if (!parts.body.contains(parts.grid)) parts.body.appendChild(parts.grid);

        cards.forEach(inst => {
            const data = cardDataOf(inst);
            if (!data) return;

            // 外层格子（用于挂顺序标号），内层卡牌用查阅同款 viewer-card → 尺寸完全一致 ✓
            const cell = document.createElement('div');
            cell.className = 'cp-cell';

            const cardEl = global.CardUI.createCardElement(data, false, 'viewer-card');
            if (cardEl) {
                cardEl.dataset.instanceId = inst.instanceId;
                cardEl.dataset.cardId = data.id;
                if (order.includes(inst.instanceId)) cardEl.classList.add('is-picked');
                if (inst.active === false) cardEl.classList.add('exhausted');
                cardEl.title = '点击按顺序标号 / 再点一次取消';
                if (global.CardUI.fitCardContent) global.CardUI.fitCardContent(cardEl);
                cell.appendChild(cardEl);
            }

            const idx = order.indexOf(inst.instanceId);
            if (idx >= 0) {
                const badge = document.createElement('span');
                badge.className = 'cp-badge';
                badge.textContent = String(idx + 1);
                cell.appendChild(badge);
            }

            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                togglePick(inst.instanceId);
            });

            parts.grid.appendChild(cell);
        });

        renderActions();
    }

    /** 点选 / 取消（取消后自动重排编号） */
    function togglePick(instanceId) {
        const i = order.indexOf(instanceId);
        if (i >= 0) order.splice(i, 1);
        else order.push(instanceId);
        render();
    }

    function renderActions() {
        parts.actions.innerHTML = '';
        ACTIONS[mode].forEach(act => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cp-btn tone-' + act.tone;
            btn.textContent = act.label;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                run(act.value);
            });
            parts.actions.appendChild(btn);
        });
    }


    /* ================= 执行（按标号顺序） ================= */

    function run(value) {
        const ids = order.slice();
        const CA = global.CardActions;
        if (!ids.length) { notify('请先点击要操作的卡牌（会按点击先后标号）', 'warning'); return; }

        // 调换：必须恰好两张 → 交换它们在费用区里的位置
        if (value === 'swap') {
            if (ids.length !== 2) { notify('调换需要恰好选中 2 张牌', 'warning'); return; }
            const ok = CA && CA.swapCostZoneSlots && CA.swapCostZoneSlots('self', ids[0], ids[1]);
            finish(ok, ok ? '已调换这两张牌的位置' : '调换失败（两张牌都要在费用区里）');
            return;
        }

        let okCount = 0;
        ids.forEach(id => {
            const found = CA && CA.findCardInstance ? CA.findCardInstance(id) : null;
            const card = found && found.card;
            if (!card) return;
            switch (value) {
                case 'pay': {
                    const slot = CA.firstEmptyCostSlot('self');
                    if (slot < 0) { notify('费用区已满，剩下的没支付', 'warning'); return; }
                    if (CA.moveCard(id, 'costZone', slot)) okCount++;
                    break;
                }
                case 'discard':
                    if (CA.moveCard(id, 'graveyard', -1)) okCount++;
                    break;
                case 'exile':
                    if (CA.moveCard(id, 'exile', -1)) okCount++;
                    break;
                case 'return':
                    if (CA.moveCard(id, 'hand', -1)) okCount++;
                    break;
                case 'toggle':
                    card.active = card.active === false;
                    okCount++;
                    break;
                case 'top':
                    if (CA.returnCardToDeckTop('self', 'costDeck', card)) okCount++;
                    break;
                case 'bottom':
                    if (CA.returnCardToDeckBottom('self', 'costDeck', card)) okCount++;
                    break;
                default:
                    break;
            }
        });

        if (value === 'toggle' && okCount) global.GameState.notifyListeners();
        finish(okCount > 0, '已处理 ' + okCount + ' 张');
    }

    function finish(ok, msg) {
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
        if (global.SyncManager && global.SyncManager.sendPublicState) global.SyncManager.sendPublicState('self');
        notify(msg, ok ? 'success' : 'warning');
        if (ok) close();            // 执行成功 → 关闭面板（标号清空）
    }

    /* ================= 打开 / 关闭 ================= */

    function open(m) {
        build();
        mode = (m === 'zone') ? 'zone' : 'hand';
        order = [];
        render();
        overlay.style.display = 'flex';
        setCollapsed(collapsed);        // 沿用上次的折叠状态（与查阅面板一致）
    }

    function close() {
        order = [];
        lastHoverEl = null;
        if (global.CardDetailUI && global.CardDetailUI.hide) global.CardDetailUI.hide();
        if (overlay) overlay.style.display = 'none';
    }

    /* ================= 入口：点「费用牌区域」/「费用区」即打开 ================= */

    function init() {
        // ★惰性建 DOM（与查阅面板一致）：这里【不能】先 build()，
        //   否则页面一加载就有一个 .pv-overlay(display:flex) 挂在 body 上 → 一进网站就弹出面板 ✗
        //   面板会在第一次点击「费用牌区域 / 费用区」时才创建（open() → build()）。
        if (overlay) overlay.style.display = 'none';   // 兜底：万一已建过，也别让它显形

        // ★关键：战斗视图是从 <template> 克隆出来的（见 ui.js 的 buildBattleView），
        //   所以不能把监听直接绑在某个具体元素上（那是模板里的静态节点，克隆后失效 ✗）。
        //   这里用【文档级捕获代理】：任何克隆/重渲染出来的费用牌区、费用区都能命中 ✓
        const intercept = (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            if (t.closest('.cost-align-btn')) return;      // 「自动对齐」按钮放行
            if (t.closest('.cost-panel') || t.closest('.pv-overlay')) return;   // 面板自身放行
            // 响应连锁【选目标】时才放行（那会儿点卡牌是在选目标，不该被面板抢走 ✗）
            if (global.TargetSelector && global.TargetSelector.isActive && global.TargetSelector.isActive()) return;
            // 注意：响应连锁面板"只是开着"时【不】拦截 ✓
            //   —— 用户要求费用区 / 费用牌 的操作不应因为连锁界面而失效；
            //      费用面板的层级已高于连锁面板（见 css/costPanel.css），两者互不遮挡 ✓
            const inCostHand = t.closest('#self-hand-cost');
            const inCostZone = t.closest('#self-cost-zone');
            if (!inCostHand && !inCostZone) return;
            if (inCostZone && inCostZone.getAttribute('data-side') === 'opponent') return;   // 对手费用区不管
            e.stopPropagation();
            e.preventDefault();
            open(inCostZone ? 'zone' : 'hand');
        };
        document.addEventListener('mousedown', intercept, true);
        document.addEventListener('contextmenu', intercept, true);
    }

    global.CostPanelUI = { init, open, close };
})(window);

