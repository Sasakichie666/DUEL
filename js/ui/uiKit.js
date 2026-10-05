// js/ui/uiKit.js
// 公共 UI 小工具（框架整理新增）
//   1) positionFloating —— 浮层贴着锚点显示（默认贴右侧，放不下自动翻到左侧，并夹在视口内）
//   2) createDismisser —— 「点浮层外部 / 按 Esc → 关闭」控制器
//
// 为什么要有它：原先 menuUI / menuAction(修改攻防面板) / counterPopup 各自写了一份
// 几乎相同的定位代码（三份）；「点外部关闭」也各写了一套（含 once 监听 + setTimeout(0)
// 防误关 + 每次显示都重新增删 document 监听等写法）。统一到这里后，调用方只关心
// "打开" 与 "关闭" 两件事。

(function(global) {

    /**
     * 把浮层放到锚点旁边
     * @param {HTMLElement} el      浮层元素（需已可见，否则量不到尺寸）
     * @param {HTMLElement} anchor  锚点元素
     * @param {Object} [options]    { gap = 8, minEdge = 8 }
     */
    function positionFloating(el, anchor, options) {
        if (!el || !anchor || typeof anchor.getBoundingClientRect !== 'function') return;
        const opt = options || {};
        const gap = opt.gap == null ? 8 : opt.gap;
        const minEdge = opt.minEdge == null ? 8 : opt.minEdge;

        const a = anchor.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // 水平：默认贴右侧；右侧放不下就翻到锚点左边
        let left = a.right + gap;
        if (left + box.width > vw) left = a.left - box.width - gap;
        // 垂直：默认与锚点顶对齐；底部越界就往上收
        let top = a.top;
        if (top + box.height > vh) top = vh - box.height - gap;

        if (left < minEdge) left = minEdge;
        if (top < minEdge) top = minEdge;

        el.style.left = left + 'px';
        el.style.top = top + 'px';
    }

    /**
     * 创建「点外部 / Esc 关闭」控制器（一个浮层一个，可反复启停）
     *
     *   const d = UIKit.createDismisser({ getElement: () => panelEl, onDismiss: hide });
     *   d.arm();     // 打开浮层时
     *   d.disarm();  // 关闭浮层时（幂等）
     *
     * 细节：
     *   · document 监听只在首次 arm 时挂一次，之后不再增删
     *   · arm 后到下一帧才真正生效 —— 打开浮层的那一次点击不会立刻把它关掉
     *     （这正是原来各处用 setTimeout(0) / once 监听想解决的问题）
     *   · 点击浮层内部不关闭；可用 ignoreSelector 额外放行（例如触发打开的锚点）
     */
    function createDismisser(options) {
        const opt = options || {};
        const getEl = typeof opt.getElement === 'function' ? opt.getElement : () => opt.element;
        const closeOnEsc = opt.closeOnEsc !== false;

        let armed = false;
        let ready = false;
        let listenersBound = false;

        function dismiss() {
            disarm();
            if (typeof opt.onDismiss === 'function') opt.onDismiss();
        }

        function onMouseDown(e) {
            if (!armed || !ready) return;
            const el = getEl();
            if (!el) return;
            if (el.contains(e.target)) return;                       // 点在浮层里
            if (opt.ignoreSelector && e.target.closest && e.target.closest(opt.ignoreSelector)) return;
            dismiss();
        }

        function onKeyDown(e) {
            if (!armed || !ready || !closeOnEsc) return;
            if (e.key === 'Escape') dismiss();
        }

        function bind() {
            if (listenersBound) return;
            document.addEventListener('mousedown', onMouseDown);
            if (closeOnEsc) document.addEventListener('keydown', onKeyDown);
            listenersBound = true;
        }

        function nextFrame(fn) {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
            else setTimeout(fn, 0);
        }

        function arm() {
            bind();
            armed = true;
            ready = false;
            nextFrame(() => { if (armed) ready = true; });
        }

        function disarm() {
            armed = false;
            ready = false;
        }

        return { arm, disarm, dismiss, isArmed: () => armed };
    }

    global.UIKit = { positionFloating, createDismisser };
})(window);
