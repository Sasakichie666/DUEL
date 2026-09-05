// js/interaction/counterPopup.js
// 计数器弹出面板：显示 +/- 按钮，点击外部关闭，选项可重复点击

(function(global) {
    let popupContainer = null;
    let outsideHandler = null;

    function ensureContainer() {
        if (popupContainer) return popupContainer;
        popupContainer = document.createElement('div');
        popupContainer.className = 'counter-popup';
        popupContainer.style.display = 'none';
        document.body.appendChild(popupContainer);
        return popupContainer;
    }

    function show(options) {
        const container = ensureContainer();
        const { anchorEl, values = [-5, -1, +1, +5], onSelect } = options;
        if (!anchorEl) return;

        container.innerHTML = '';
        values.forEach(val => {
            const btn = document.createElement('button');
            btn.className = 'counter-btn';
            btn.textContent = (val > 0 ? '+' : '') + val;
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止触发外部关闭
                if (typeof onSelect === 'function') onSelect(val);
                // 不关闭面板，允许连续点击
            });
            container.appendChild(btn);
        });

        container.style.display = 'flex';
        positionPopup(container, anchorEl);

        // 移除旧的外部监听，绑定新监听
        if (outsideHandler) {
            document.removeEventListener('mousedown', outsideHandler);
        }
        outsideHandler = handleOutsideClick;
        document.addEventListener('mousedown', outsideHandler);
    }

    function positionPopup(menuEl, anchorEl) {
        const anchorRect = anchorEl.getBoundingClientRect();
        const menuRect = menuEl.getBoundingClientRect();
        let left = anchorRect.right + 5;
        let top = anchorRect.top;
        if (left + menuRect.width > window.innerWidth) left = anchorRect.left - menuRect.width - 5;
        if (top + menuRect.height > window.innerHeight) top = window.innerHeight - menuRect.height - 5;
        menuEl.style.left = `${left}px`;
        menuEl.style.top = `${top}px`;
    }

    function handleOutsideClick(e) {
        if (popupContainer && !popupContainer.contains(e.target)) {
            hide();
        }
    }

    function hide() {
        if (popupContainer) {
            popupContainer.style.display = 'none';
        }
        if (outsideHandler) {
            document.removeEventListener('mousedown', outsideHandler);
            outsideHandler = null;
        }
    }

    global.CounterPopup = { show, hide };
})(window);