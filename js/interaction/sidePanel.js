// js/interaction/sidePanel.js
// 战斗侧边栏：规则说明 + 响应时点忽略 + 自动抽牌开关
//
// 「响应」按钮（新增，位于「规则」上方）：
//   点开浮层列出所有响应时点，勾选 = 忽略该时点 —— 对方发动它时我方自动略过、
//   直接进入对方的处理阶段。清单本身存在 js/core/responsePrefs.js，判定在 ChainManager ✓
//
// 框架整理（1.2）：原「标记 / 顺序 / 清除」三个旧模式已移除。
//   原因：那是一套失效功能 —— 侧边栏把标记写进 card.mark / card.order，
//   而卡面渲染读的是 MarkOrderManager（全项目从未写入过），所以标记与顺序
//   在任何界面上都显示不出来；删除它不影响任何可用功能。
//
// 对外接口保持不变：init(container) / getCurrentMode() / exitMode()
//   （后两个为兼容旧调用保留；模式系统移除后 getCurrentMode 恒为 'normal'）

(function(global) {
    let panelEl = null;
    let popEl = null;                 // 「响应」忽略面板（浮层挂在 body 上：细工具栏只有 78px 宽，塞不下 ✗）
    let outsideBound = false;
    let prefsSubscribed = false;

    global.BattleSettings = global.BattleSettings || { autoDraw: true };

    function init(container) {
        if (!container) return;
        panelEl = container;
        panelEl.innerHTML = `
            <div class="side-panel">
                <button class="side-btn" id="btnResponse">响应</button>
                <button class="side-btn" id="btnReveal">展示</button>
                <button class="side-btn" id="btnRules">规则</button>
                <div class="side-toggle">
                    <label>自动抽牌</label>
                    <input type="checkbox" id="toggleAutoDraw">
                </div>
            </div>
        `;

        const rulesBtn = panelEl.querySelector('#btnRules');
        if (rulesBtn) rulesBtn.addEventListener('click', showRules);

        // 「响应」按钮：点开/收起"忽略时点"面板（面板里勾选 = 忽略该时点 ✓）
        const respBtn = panelEl.querySelector('#btnResponse');
        if (respBtn) {
            respBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleResponsePanel();
            });
        }

        // 「展示」按钮：挑选手牌展示给对手（与响应/规则同级 ✓ 不是响应面板里的二级菜单 ✓）
        const revealBtn = panelEl.querySelector('#btnReveal');
        if (revealBtn) {
            revealBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (global.RevealPanelUI && global.RevealPanelUI.openHandPicker) {
                    global.RevealPanelUI.openHandPicker();
                }
            });
        }

        const toggle = panelEl.querySelector('#toggleAutoDraw');
        if (toggle) {
            toggle.checked = global.BattleSettings.autoDraw !== false;
            toggle.addEventListener('change', (e) => {
                global.BattleSettings.autoDraw = e.target.checked;
            });
        }

        // 忽略清单被别处改动（或换局重开）→ 面板开着时跟着刷新 ✓
        if (!prefsSubscribed && global.ResponsePrefs && global.ResponsePrefs.subscribe) {
            prefsSubscribed = true;
            global.ResponsePrefs.subscribe(() => {
                if (popEl && !popEl.hidden) renderResponsePanel();
            });
        }
    }

    function showRules() {
        if (global.ViewerUI && global.ViewerUI.showText) {
            global.ViewerUI.showText('游戏规则', [
                '1. 玩家可以自由拖拽卡牌到任意区域。',
                '2. 第三回合开始自动抽牌（可在侧边栏关闭）。',
                '3. 卡牌效果由玩家手动结算：血量、攻防、词条、翻盖、装备等都在右键菜单里。',
                '4. 费用牌 / 费用区的批量操作走「费用牌界面」面板。'
            ]);
        } else {
            alert('规则：模拟器规则请参考开发文档。');
        }
    }

    /* ================= 「响应」忽略时点面板 ================= */
    // 需求：在「规则」按钮上方增加「响应」按钮；点开后列出所有响应时点，
    //       勾选 = 忽略该时点 → 对方发动该时点时我方不再被询问，
    //       直接略过并进入处理阶段（判定逻辑在 ChainManager.autoPassIgnored ✓）
    //
    // 面板做成浮层（挂 body、position: fixed）而不是塞进工具栏：
    //   · 细工具栏只有 var(--rail-w)=78px 宽，塞不下勾选项与文字 ✗
    //   · 浮层层级抬到 6400，保证连锁面板(5900)/费用面板(6200) 开着也能勾选 ✓

    function ensurePop() {
        if (popEl && document.body.contains(popEl)) return popEl;

        popEl = document.createElement('div');
        popEl.className = 'side-response-popover';
        popEl.id = 'sideResponsePopover';
        popEl.hidden = true;
        document.body.appendChild(popEl);

        // 点面板以外的地方 → 收起（与其它浮层行为一致 ✓）
        if (!outsideBound) {
            outsideBound = true;
            document.addEventListener('click', (e) => {
                if (!popEl || popEl.hidden) return;
                if (popEl.contains(e.target)) return;
                const btn = panelEl && panelEl.querySelector('#btnResponse');
                if (btn && btn.contains(e.target)) return;
                closeResponsePanel();
            }, true);
            window.addEventListener('resize', positionPop);
            window.addEventListener('scroll', positionPop, true);   // 工具栏内部滚动也要跟随 ✓
        }
        return popEl;
    }

    /** 贴在「响应」按钮左侧（工具栏在最右边，所以往左展开 ✓）；超出屏幕就夹住 ✓ */
    function positionPop() {
        if (!popEl || popEl.hidden) return;
        const btn = panelEl && panelEl.querySelector('#btnResponse');
        const rect = btn ? btn.getBoundingClientRect()
            : { left: window.innerWidth - 90, right: window.innerWidth - 10, top: 80 };

        const w = Math.min(258, Math.max(190, Math.round(window.innerWidth * 0.24)));
        popEl.style.width = w + 'px';

        let left = rect.left - w - 12;
        if (left < 8) left = Math.min(window.innerWidth - w - 8, rect.right + 12);
        popEl.style.left = Math.max(8, left) + 'px';

        const h = popEl.offsetHeight || 0;
        let top = rect.top - 6;
        if (h && top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
        popEl.style.top = Math.max(8, top) + 'px';
    }

    function renderResponsePanel() {
        const P = global.ResponsePrefs;
        if (!popEl) return;

        const items = (P && P.all) ? P.all() : [];
        const rows = items.map(it => {
            const disabled = it.ignorable === false;
            const cls = 'sr-item'
                + (it.ignored ? ' ignored' : '')
                + (disabled ? ' disabled' : '');
            return `<label class="${cls}"${disabled ? ' title="该时点由你自己发起，无需忽略"' : ''}>`
                + `<input type="checkbox" data-point="${it.key}"${it.ignored ? ' checked' : ''}${disabled ? ' disabled' : ''}>`
                + `<span class="sr-icon">${it.icon}</span>`
                + `<span class="sr-label">${it.label}</span>`
                + `</label>`;
        }).join('');

        popEl.innerHTML = `
            <div class="sr-head">
                <span class="sr-title">响应时点</span>
                <button type="button" class="sr-close" title="关闭">✕</button>
            </div>
            <div class="sr-hint">勾选 = <b>忽略</b>该时点：对方发动它时我方自动略过，直接进入对方的处理阶段</div>
            <div class="sr-list">${rows || '<div class="sr-empty">响应连锁未加载</div>'}</div>
        `;

        popEl.querySelectorAll('input[data-point]').forEach(input => {
            input.addEventListener('change', () => {
                const P2 = global.ResponsePrefs;
                if (P2 && P2.setIgnored) {
                    P2.setIgnored(input.getAttribute('data-point'), input.checked);
                }
            });
        });

        const closeBtn = popEl.querySelector('.sr-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeResponsePanel(); });
        }
    }

    function openResponsePanel() {
        ensurePop();
        popEl.hidden = false;
        renderResponsePanel();
        positionPop();
        const btn = panelEl && panelEl.querySelector('#btnResponse');
        if (btn) btn.classList.add('active');
    }

    function closeResponsePanel() {
        if (popEl) popEl.hidden = true;
        const btn = panelEl && panelEl.querySelector('#btnResponse');
        if (btn) btn.classList.remove('active');
    }

    function toggleResponsePanel() {
        ensurePop();
        if (popEl.hidden) openResponsePanel(); else closeResponsePanel();
    }

    /** 兼容旧接口：模式系统已移除 */
    function getCurrentMode() { return 'normal'; }

    function exitMode() { /* 无模式可退出 */ }

    global.SidePanel = {
        init,
        getCurrentMode,
        exitMode,
        // 「响应」忽略时点面板（侧栏用；也方便控制台调试 ✓）
        openResponsePanel,
        closeResponsePanel,
        toggleResponsePanel
    };
})(window);
