// js/ui/viewerUI.js
// 牌堆「检索 / 查阅」界面：现代玻璃拟态面板
//   功能：实时搜索、类型筛选胶囊、排序切换、数量统计、动作选择（加入手牌/放前场/放后场/送墓/放逐）
//   兼容旧接口：ViewerUI.show(cards, title, onCardClick)  → 只读翻阅模式
//   新接口：    ViewerUI.show(cards, title, onCardClick, { actions, defaultAction, icon, hint })

(function(global) {
    let overlay = null;
    let parts = null;
    let escHandler = null;
    let collapsed = false;        // 折叠状态：整个会话内记住（折叠后只剩标题栏，方便看手牌与战场）
    let hoverRaf = 0;             // 折叠态"鼠标透传"的合帧句柄
    let lastHoverEl = null;       // 上一次悬浮到的卡牌 DOM（避免重复 show）

    const state = {
        cards: [],
        entries: [],        // 预解析缓存：[{ instance, card, type, search }]，避免重复查库
        counts: { all: 0 }, // 各类型数量（打开时算一次）
        title: '查阅',
        icon: '🗂',
        onPick: null,
        actions: [],        // [{ value, label }]
        controls: [],       // [{ type:'checkbox'|'button', … }] 底部额外控件（翻阅用 ✓）
        action: null,       // 当前选中的动作 value
        readonly: true,
        filter: 'all',
        query: '',
        sort: 'default',    // 'default' | 'costAsc' | 'costDesc' | 'name'
        hintText: '',
        chunkToken: 0       // 分帧渲染令牌：重绘时使旧的分帧任务失效
    };

    const SORT_LABEL = {
        'default': '排序：原始',
        'costAsc': '排序：费用 ↑',
        'costDesc': '排序：费用 ↓',
        'name': '排序：名称'
    };

    const TYPE_LABEL = { minion: '随从', tactic: '战术', cost: '费用', legend: '传说' };

    const SKELETON = `
        <div class="pv-panel" role="dialog" aria-modal="true">
            <header class="pv-head">
                <div class="pv-title">
                    <span class="pv-icon">🗂</span>
                    <h3 class="pv-title-text"></h3>
                    <span class="pv-count">0</span>
                </div>
                <div class="pv-tools">
                    <label class="pv-search">
                        <span class="pv-search-icon">🔍</span>
                        <input type="text" class="pv-search-input" placeholder="搜索名称 / 费用 / 类型 / 效果">
                    </label>
                    <button type="button" class="pv-btn pv-sort">排序：原始</button>
                    <button type="button" class="pv-btn pv-fold" title="折叠（方便看手牌与战场）">▾</button>
                    <button type="button" class="pv-btn pv-close" title="关闭（Esc）">✕</button>
                </div>
            </header>
            <div class="pv-filters"></div>
            <div class="pv-body"><div class="pv-grid"></div></div>
            <footer class="pv-foot">
                <div class="pv-extra"></div>
                <div class="pv-actions"></div>
                <div class="pv-hint"></div>
            </footer>
        </div>
    `;

    function ensureOverlay() {
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.className = 'pv-overlay';
        overlay.innerHTML = SKELETON;
        document.body.appendChild(overlay);

        const panel = overlay.querySelector('.pv-panel');
        parts = {
            panel: panel,
            head: panel.querySelector('.pv-head'),
            titleText: panel.querySelector('.pv-title-text'),
            icon: panel.querySelector('.pv-icon'),
            count: panel.querySelector('.pv-count'),
            searchWrap: panel.querySelector('.pv-search'),
            searchInput: panel.querySelector('.pv-search-input'),
            sortBtn: panel.querySelector('.pv-sort'),
            foldBtn: panel.querySelector('.pv-fold'),
            closeBtn: panel.querySelector('.pv-close'),
            filters: panel.querySelector('.pv-filters'),
            body: panel.querySelector('.pv-body'),
            grid: panel.querySelector('.pv-grid'),
            extra: panel.querySelector('.pv-extra'),
            actions: panel.querySelector('.pv-actions'),
            hint: panel.querySelector('.pv-hint')
        };

        // 折叠 / 展开：只保留标题栏 → 手牌与战场立刻可见 ✓
        parts.foldBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setCollapsed(!collapsed);
        });
        // 折叠状态下点标题栏即可展开
        parts.head.addEventListener('click', (e) => {
            if (collapsed && e.target !== parts.searchInput) setCollapsed(false);
        });
        // 快捷键 F 折叠/展开（正在搜索框里打字时不打扰）
        document.addEventListener('keydown', (e) => {
            if (!overlay || overlay.style.display === 'none') return;
            if ((e.key === 'f' || e.key === 'F') && e.target !== parts.searchInput) {
                e.preventDefault();
                setCollapsed(!collapsed);
            }
        });

        // 折叠态：遮罩会挡住鼠标 ✗ → 用 elementsFromPoint 把"鼠标下方的卡牌"找回来，
        // 复用 CardDetailUI 的悬浮详情 ✓（所以折叠后仍然可以悬停看牌 ✓）
        overlay.addEventListener('mousemove', (e) => {
            if (!collapsed) return;
            if (hoverRaf) return;
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

        // 关闭：右上角按钮 / 点击遮罩
        parts.closeBtn.addEventListener('click', hide);
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) hide();
        });

        // 搜索：去抖 + 只重绘网格与统计（筛选胶囊数量与搜索词无关，不重建）
        let searchTimer = null;
        parts.searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.query = parts.searchInput.value.trim().toLowerCase();
                renderGrid();
                renderFoot();
            }, 140);
        });

        // 排序循环
        parts.sortBtn.addEventListener('click', () => {
            const order = ['default', 'costAsc', 'costDesc', 'name'];
            const idx = order.indexOf(state.sort);
            state.sort = order[(idx + 1) % order.length];
            parts.sortBtn.textContent = SORT_LABEL[state.sort];
            renderGrid();
        });

        return overlay;
    }

    /** 折叠态下把"鼠标下方的卡牌"交给 CardDetailUI 显示详情（同一套判读 ✓） */
    function forwardHover(x, y) {
        const detail = global.CardDetailUI;
        if (!detail || typeof detail.hoverElement !== 'function') return;
        let cardEl = null;
        const stack = (document.elementsFromPoint ? document.elementsFromPoint(x, y) : []) || [];
        for (const el of stack) {
            if (!el || !el.classList) continue;
            if (overlay && overlay.contains(el)) continue;      // 面板自己盖住的区域不算
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

    /** 折叠 / 展开查阅·检索面板（只保留标题栏） */
    function setCollapsed(v) {
        const wasCollapsed = collapsed;
        collapsed = !!v;
        if (overlay) overlay.classList.toggle('pv-collapsed', collapsed);
        if (parts && parts.foldBtn) {
            parts.foldBtn.textContent = collapsed ? '▸' : '▾';
            parts.foldBtn.title = collapsed
                ? '展开（搜索 / 筛选 / 取牌）'
                : '折叠（方便看手牌与战场，快捷键 F）';
        }
        // 展开 / 收起时清掉透传的悬浮详情，避免残留
        if (wasCollapsed !== collapsed) {
            lastHoverEl = null;
            if (global.CardDetailUI && global.CardDetailUI.hide) global.CardDetailUI.hide();
        }
    }

    function getCardData(instance) {
        if (!instance) return null;
        if (instance.cardData) return instance.cardData;
        if (global.CardLibrary && global.CardLibrary.getCardById) {
            return global.CardLibrary.getCardById(instance.cardId);
        }
        return (global.Cards && global.Cards.getCardById) ? global.Cards.getCardById(instance.cardId) : null;
    }

    function getType(card) {
        if (global.DeckManager && global.DeckManager.hasSeries && global.DeckManager.hasSeries(card, '传说')) {
            return 'legend';
        }
        return card.type || 'other';
    }

    function typeLabel(type) {
        return TYPE_LABEL[type] || '其他';
    }

    // 打开面板时一次性预解析：卡面数据、类型、可搜索文本（避免每次筛选/重绘都重复查库）
    function buildEntries(instances) {
        const entries = [];
        const counts = { all: 0 };
        (instances || []).forEach(inst => {
            const card = getCardData(inst);
            if (!card) return;
            const type = getType(card);
            const search = [
                card.name,
                typeLabel(type),
                card.cost,
                card.color,
                card.effectText || card.description || '',
                Array.isArray(card.traits) ? card.traits.join(' ') : ''
            ].join(' ').toLowerCase();

            entries.push({
                instance: inst,
                card: card,
                type: type,
                cost: Number(card.cost) || 0,
                name: String(card.name || ''),
                search: search
            });

            counts.all++;
            counts[type] = (counts[type] || 0) + 1;
        });
        state.entries = entries;
        state.counts = counts;
    }

    // 过滤 + 排序（全部基于预解析缓存，不再重复查库）
    function getFiltered() {
        const q = state.query;
        let list = state.entries;

        if (state.filter !== 'all' || q) {
            list = list.filter(en => {
                if (state.filter !== 'all' && en.type !== state.filter) return false;
                return !q || en.search.includes(q);
            });
        }

        if (state.sort === 'costAsc' || state.sort === 'costDesc') {
            const dir = state.sort === 'costAsc' ? 1 : -1;
            list = list.slice().sort((a, b) => (a.cost - b.cost) * dir);
        } else if (state.sort === 'name') {
            list = list.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
        }
        return list;
    }

    function renderAll() {
        parts.count.textContent = getFiltered().length;
        renderFilters();
        renderGrid();
        renderFoot();
    }

    // 类型筛选胶囊（数量取打开时的缓存，与搜索词无关，无需重建）
    function renderFilters() {
        const counts = state.counts || { all: 0 };
        parts.filters.innerHTML = '';

        // 在有搜索词时，胶囊计数仍显示卡池整体数量（便于判断该类型有多少张）
        const makeChip = (value, label, count) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pv-chip' + (state.filter === value ? ' is-active' : '');
            btn.innerHTML = `${label}<b>${count}</b>`;
            btn.addEventListener('click', () => {
                state.filter = value;
                renderAll();
            });
            return btn;
        };

        parts.filters.appendChild(makeChip('all', '全部', counts.all));
        ['minion', 'tactic', 'cost', 'legend'].forEach(type => {
            if (counts[type]) {
                parts.filters.appendChild(makeChip(type, typeLabel(type), counts[type]));
            }
        });
    }

    // 分帧渲染的每帧张数：面板先画前一批，剩下的在后续帧补齐，避免"打开瞬间白屏卡住"
    const CHUNK_SIZE = 28;

    // 卡牌网格
    function renderGrid() {
        const list = getFiltered();
        state.lastFiltered = list.length;
        parts.count.textContent = list.length;
        parts.grid.classList.toggle('is-readonly', state.readonly);

        // 让上一次未完成的分帧任务失效
        state.chunkToken++;
        const token = state.chunkToken;

        if (list.length === 0) {
            parts.body.innerHTML = `
                <div class="pv-empty">
                    <span class="pv-empty-icon">🕳</span>
                    <span class="pv-empty-text">${state.cards.length === 0 ? '这里没有卡牌' : '没有符合条件的卡牌'}</span>
                </div>`;
            parts.grid = document.createElement('div');
            parts.grid.className = 'pv-grid';
            return;
        }

        // 恢复 grid 容器（可能被空状态替换过）
        ensureGridContainer();
        parts.grid.innerHTML = '';

        const readonly = state.readonly;
        const actionLabel = currentActionLabel();
        const onPick = state.onPick;

        const buildCard = (entry) => {
            const cardEl = global.CardUI.createCardElement(entry.card, false, 'viewer-card');
            cardEl.dataset.instanceId = entry.instance.instanceId;
            cardEl.dataset.cardId = entry.card.id;
            cardEl.title = readonly ? entry.name : `点击 → ${actionLabel}`;
            cardEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!onPick) return;   // 只读模式：不关闭，方便自由翻阅
                onPick(entry.instance, state.action);
                hide();
            });
            return cardEl;
        };

        const appendRange = (from, to) => {
            const frag = document.createDocumentFragment();
            for (let i = from; i < to; i++) frag.appendChild(buildCard(list[i]));
            parts.grid.appendChild(frag);
        };

        const firstEnd = Math.min(CHUNK_SIZE, list.length);
        appendRange(0, firstEnd);
        renderFoot();

        if (firstEnd < list.length) {
            let cursor = firstEnd;
            const step = () => {
                if (token !== state.chunkToken) return;   // 已被新的渲染取代，放弃旧任务
                const next = Math.min(cursor + CHUNK_SIZE, list.length);
                appendRange(cursor, next);
                cursor = next;
                if (cursor < list.length) {
                    requestAnimationFrame(step);
                } else {
                    renderFoot();
                }
            };
            requestAnimationFrame(step);
        }
    }

    function currentActionLabel() {
        const found = state.actions.find(a => a.value === state.action);
        return found ? found.label : '选择';
    }

    // 底部：动作分段控件 + 统计提示
    function renderFoot() {
        // 动作
        parts.actions.innerHTML = '';
        if (state.actions.length > 0 && !state.readonly) {
            const label = document.createElement('span');
            label.className = 'pv-actions-label';
            label.textContent = '选取后：';
            parts.actions.appendChild(label);

            state.actions.forEach(act => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'pv-act' + (state.action === act.value ? ' is-active' : '');
                btn.textContent = act.label;
                btn.addEventListener('click', () => {
                    state.action = act.value;
                    renderFoot();
                    renderGrid();
                });
                parts.actions.appendChild(btn);
            });
        }

        // 提示
        const shown = state.lastFiltered != null ? state.lastFiltered : 0;
        const total = state.cards.length;
        const parts2 = [];
        parts2.push(`显示 ${shown} / ${total} 张`);
        if (!state.readonly) {
            parts2.push(`点击卡牌执行「${currentActionLabel()}」`);
        } else if (state.hintText) {
            parts2.push(state.hintText);
        }
        parts2.push('<kbd>Esc</kbd> 关闭');
        parts.hint.innerHTML = parts2.join(' · ');
    }

    // 保证网格容器存在（空状态时它会被替换掉）
    function ensureGridContainer() {
        if (parts.grid && parts.body.contains(parts.grid)) return;
        parts.body.innerHTML = '';
        parts.grid = document.createElement('div');
        parts.grid.className = 'pv-grid';
        parts.body.appendChild(parts.grid);
    }

    /**
     * 显示检索 / 查阅面板
     * @param {Array}    cardInstances 卡牌实例数组（顶部在前）
     * @param {string}   title         标题
     * @param {Function} onCardClick   (instance, actionValue) => void，传 null 则为只读浏览
     * @param {object}   opts          { actions:[{value,label}], defaultAction, icon, hint }
     */
    function show(cardInstances, title = '查阅', onCardClick = null, opts = {}) {
        ensureOverlay();

        state.cards = Array.isArray(cardInstances) ? cardInstances.filter(Boolean) : [];
        state.title = title || '查阅';
        state.onPick = typeof onCardClick === 'function' ? onCardClick : null;
        state.readonly = !state.onPick;
        state.actions = Array.isArray(opts.actions) ? opts.actions.slice() : [];
        state.controls = Array.isArray(opts.controls) ? opts.controls.slice() : [];
        // 关闭回调：翻阅时用来"收起会话"（含 ✕ / Esc / 遮罩点击 ✓），保证状态不会残留 ✓
        state.onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
        state.action = opts.defaultAction || (state.actions[0] ? state.actions[0].value : null);
        state.icon = opts.icon || (state.readonly ? '🗂' : '🔎');
        state.hintText = opts.hint || '';
        state.filter = 'all';
        state.query = '';
        state.sort = 'default';
        state.lastFiltered = 0;

        // 预解析一次：类型、数量、搜索文本全部缓存，后续筛选/重绘不再查卡库
        buildEntries(state.cards);

        // 从文本模式切回来时恢复工具栏
        parts.count.style.display = '';
        parts.searchWrap.style.display = '';
        parts.sortBtn.style.display = '';
        parts.filters.style.display = '';

        parts.icon.textContent = state.icon;
        parts.titleText.textContent = state.title;
        parts.searchInput.value = '';
        parts.sortBtn.textContent = SORT_LABEL[state.sort];

        ensureGridContainer();
        overlay.style.display = 'flex';
        setCollapsed(collapsed);      // 沿用上次的折叠状态
        renderAll();
        renderExtra();          // 底部额外控件（翻阅：公开 / +1 / 收起 ✓）

        bindEsc();
        setTimeout(() => {
            if (parts && overlay && overlay.style.display !== 'none' && !collapsed) {
                parts.searchInput.focus();
            }
        }, 30);
    }

    /**
     * 底部「额外控件」（翻阅用：公开勾选 / +1 张 / 收起 ✓）
     * 不传 opts.controls 时这里直接返回 → 现有面板外观与行为完全不变 ✓
     */
    function renderExtra() {
        if (!parts || !parts.extra) return;
        parts.extra.innerHTML = '';
        const list = Array.isArray(state.controls) ? state.controls : [];
        if (!list.length) return;

        list.forEach(ctl => {
            if (!ctl) return;
            if (ctl.type === 'checkbox') {
                const label = document.createElement('label');
                label.className = 'pv-ctl pv-ctl-check';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = !!ctl.checked;
                input.addEventListener('change', () => {
                    if (typeof ctl.onChange === 'function') ctl.onChange(input.checked);
                });
                const span = document.createElement('span');
                span.textContent = ctl.label || '';
                label.appendChild(input);
                label.appendChild(span);
                parts.extra.appendChild(label);
            } else {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'pv-ctl pv-ctl-btn';
                btn.textContent = ctl.label || '';
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (typeof ctl.onClick === 'function') ctl.onClick();
                });
                parts.extra.appendChild(btn);
            }
        });
    }

    /**
     * 原地刷新（不重开面板、不重置搜索词与筛选 ✓）—— 翻阅「+1 张」后用它 ✓
     * @param {Array}  cardInstances 新的卡牌实例数组
     * @param {string} title         新标题（可选）
     * @param {object} meta          { revealed } 用于同步勾选状态 ✓
     */
    function update(cardInstances, title, meta) {
        if (!overlay || overlay.style.display === 'none') return false;
        if (Array.isArray(cardInstances)) {
            state.cards = cardInstances.filter(Boolean);
            buildEntries(state.cards);
        }
        if (title) {
            state.title = title;
            if (parts.titleText) parts.titleText.textContent = title;
        }
        if (meta && typeof meta.revealed === 'boolean') {
            state.controls.forEach(c => { if (c && c.type === 'checkbox') c.checked = meta.revealed; });
        }
        renderFilters();
        renderGrid();
        renderFoot();
        renderExtra();
        return true;
    }

    /** 面板当前是否可见（供调用方判断，例如翻阅刷新前先确认面板还在 ✓） */
    function isOpen() {
        return !!(overlay && overlay.style.display !== 'none');
    }

    // 键盘：Esc 关闭、/ 聚焦搜索框
    function bindEsc() {
        if (escHandler) document.removeEventListener('keydown', escHandler, true);
        escHandler = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                hide();
            } else if (e.key === '/' && document.activeElement !== parts.searchInput) {
                e.preventDefault();
                parts.searchInput.focus();
            }
        };
        document.addEventListener('keydown', escHandler, true);
    }

    // 纯文本信息面板（侧栏「规则」等复用同一套外观）
    function showText(title, lines) {
        ensureOverlay();

        state.cards = [];
        state.entries = [];
        state.counts = { all: 0 };
        state.onPick = null;
        state.readonly = true;
        state.actions = [];

        parts.icon.textContent = '📖';
        parts.titleText.textContent = title || '说明';
        parts.count.style.display = 'none';
        parts.searchWrap.style.display = 'none';
        parts.sortBtn.style.display = 'none';
        parts.filters.style.display = 'none';
        parts.actions.innerHTML = '';
        parts.extra.innerHTML = '';
        parts.hint.innerHTML = '<kbd>Esc</kbd> 关闭';

        const items = (Array.isArray(lines) ? lines : [lines])
            .filter(l => l != null && l !== '')
            .map(l => `<li>${escapeHtml(String(l))}</li>`)
            .join('');
        parts.body.innerHTML = `<ul class="pv-text-list">${items}</ul>`;

        overlay.style.display = 'flex';
        bindEsc();
    }

    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }

    function hide() {
        if (overlay) {
            overlay.style.display = 'none';
            state.chunkToken++;   // 取消未完成的分帧渲染
            if (parts) {
                parts.grid.innerHTML = '';
                parts.filters.innerHTML = '';
                parts.actions.innerHTML = '';
                parts.extra.innerHTML = '';
                parts.hint.innerHTML = '';
            }
        }
        if (escHandler) {
            document.removeEventListener('keydown', escHandler, true);
            escHandler = null;
        }
        state.onPick = null;
        lastHoverEl = null;
        // 关闭回调（翻阅：收起展示会话 ✓）——先取出并清空，避免回调里再触发 hide 造成重入 ✓
        const onCloseCb = state.onClose;
        state.onClose = null;
        if (typeof onCloseCb === 'function') {
            try { onCloseCb(); } catch (e) { console.error('[ViewerUI] onClose 异常（已忽略）', e); }
        }
        if (global.CardDetailUI && global.CardDetailUI.hide) {
            global.CardDetailUI.hide();
        }
    }

    global.ViewerUI = { show, showText, update, isOpen, hide };
})(window);
