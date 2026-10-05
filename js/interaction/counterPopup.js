// js/interaction/counterPopup.js
// 数值加减弹窗（血量 / 攻防等）：一排 +/- 按钮，可连续点击，点外部或 Esc 关闭
//
// 框架整理：定位与「点外部关闭」改用 UIKit，去掉自己维护的 document 监听增删。
// 对外接口不变：CounterPopup.show({ anchorEl, values, onSelect }) / hide()

(function(global) {
    let popupEl = null;

    const dismisser = global.UIKit
        ? global.UIKit.createDismisser({
            getElement: () => popupEl,
            onDismiss: () => hide()
        })
        : { arm() {}, disarm() {}, dismiss() {}, isArmed: () => false };

    function ensureContainer() {
        if (popupEl && document.body.contains(popupEl)) return popupEl;
        popupEl = document.createElement('div');
        popupEl.className = 'counter-popup';
        popupEl.style.display = 'none';
        document.body.appendChild(popupEl);
        return popupEl;
    }

    function show(options) {
        const { anchorEl, values = [-5, -1, +1, +5], onSelect } = options || {};
        if (!anchorEl) return;

        const container = ensureContainer();
        container.innerHTML = '';

        values.forEach(val => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'counter-btn';
            btn.textContent = (val > 0 ? '+' : '') + val;
            btn.dataset.sign = val > 0 ? 'plus' : 'minus';   // 增益/扣减分色（见 counter.css）
            btn.addEventListener('click', (e) => {
                e.stopPropagation();                          // 不触发「点外部关闭」
                if (typeof onSelect === 'function') onSelect(val);   // 面板不自动关闭，可连续点击
            });
            container.appendChild(btn);
        });

        container.style.display = 'flex';
        if (global.UIKit) global.UIKit.positionFloating(container, anchorEl, { gap: 5 });
        dismisser.arm();
    }

    function hide() {
        if (popupEl) {
            popupEl.style.display = 'none';
            popupEl.innerHTML = '';
        }
        dismisser.disarm();
    }

    global.CounterPopup = { show, hide };
})(window);
