// js/ui/menuUI.js
// 通用菜单 UI：创建 / 定位 / 显示 / 隐藏，并把选中项回调出去
//
// 框架整理：
//   · 菜单项渲染改用【事件委托】—— 一个 click 监听处理所有项（含之后动态渲染的），
//     不再给每个菜单项单独 addEventListener
//   · 定位 + 「点外部 / Esc 关闭」统一交给 UIKit
//     （去掉了原来 once 监听 + setTimeout 防误关 + 每次 show 重挂监听的写法）
//   · 移除调试日志，以及从未被外部读取的状态变量（currentItems / currentAnchor）

(function(global) {
    // 旧版遗留：没写 tone 的动作里，这两个按「危险操作」上色
    const DANGER_VALUES = new Set(['discard', 'exile']);

    let menuEl = null;
    let onSelectCallback = null;
    let selectedCardEl = null;      // 当前因「打开菜单」而高亮的卡牌

    const dismisser = global.UIKit
        ? global.UIKit.createDismisser({
            getElement: () => menuEl,
            onDismiss: () => hide()
        })
        : { arm() {}, disarm() {}, dismiss() {}, isArmed: () => false };

    /** 选中反馈：给被点击的卡牌加 .is-selected（手牌置顶 + 金边，见 CSS） */
    function markSelected(el) {
        clearSelected();
        if (!el || !el.classList || !el.classList.contains('card-full')) return;
        el.classList.add('is-selected');
        selectedCardEl = el;
    }

    /** 清除选中反馈（并兜底清理任何残留节点上的同名类） */
    function clearSelected() {
        if (selectedCardEl) {
            selectedCardEl.classList.remove('is-selected');
            selectedCardEl = null;
        }
        document.querySelectorAll('.card-full.is-selected').forEach(c => c.classList.remove('is-selected'));
    }

    function ensureContainer() {
        if (menuEl && document.body.contains(menuEl)) return menuEl;
        menuEl = document.createElement('div');
        menuEl.className = 'context-menu';
        menuEl.style.display = 'none';
        menuEl.addEventListener('click', onMenuClick);   // ★事件委托：一次绑定，长期有效
        document.body.appendChild(menuEl);
        return menuEl;
    }

    /** 菜单项数据 → DOM（分隔线单独处理） */
    function createItemEl(item) {
        if (item.separator) {
            const sep = document.createElement('div');
            sep.className = 'context-menu-sep';
            return sep;
        }
        const el = document.createElement('div');
        el.className = 'context-menu-item';
        // 分组配色：item.tone（primary / danger / modify / neutral / swap）
        if (item.tone) el.classList.add('tone-' + item.tone);
        else if (item.danger || DANGER_VALUES.has(item.value)) el.classList.add('is-danger');
        el.textContent = item.label;
        el.dataset.value = item.value;
        el.dataset.keepOpen = item.keepOpen ? 'true' : 'false';
        return el;
    }

    /** 委托入口：任何一个菜单项被点，都在这里分发 */
    function onMenuClick(e) {
        const item = e.target && e.target.closest ? e.target.closest('.context-menu-item') : null;
        if (!item || !menuEl || !menuEl.contains(item)) return;
        e.stopPropagation();

        const value = item.dataset.value;
        const keepOpen = item.dataset.keepOpen === 'true';
        const callback = onSelectCallback;      // 先取出：hide() 会把它清空
        if (!keepOpen) hide();
        if (typeof callback === 'function') callback(value);
    }

    function show(options) {
        const { items, anchorEl, onSelect } = options || {};
        if (!items || items.length === 0 || !anchorEl) return;

        const container = ensureContainer();
        onSelectCallback = onSelect || null;
        markSelected(anchorEl);

        container.innerHTML = '';
        items.forEach(item => container.appendChild(createItemEl(item)));
        container.style.display = 'block';

        if (global.UIKit) global.UIKit.positionFloating(container, anchorEl);
        dismisser.arm();
    }

    function hide() {
        clearSelected();
        if (menuEl) {
            menuEl.style.display = 'none';
            menuEl.innerHTML = '';
        }
        onSelectCallback = null;
        dismisser.disarm();
    }

    /** 菜单是否开着（供其它模块判断，例如拖拽） */
    function isOpen() {
        return !!(menuEl && menuEl.style.display !== 'none');
    }

    global.MenuUI = { show, hide, isOpen };
})(window);
