// js/ui/menuUI.js
// 通用菜单UI模块：负责创建、定位、显示/隐藏菜单，并处理菜单项点击回调

(function(global) {
    let menuContainer = null;
    let currentAnchor = null;
    let currentItems = [];
    let onSelectCallback = null;

    function ensureContainer() {
        if (menuContainer) return menuContainer;
        menuContainer = document.createElement('div');
        menuContainer.className = 'context-menu';
        menuContainer.style.display = 'none';
        document.body.appendChild(menuContainer);
        return menuContainer;
    }

    function show(options) {
        console.log('[MenuUI] show', options);
        const container = ensureContainer();
        const { items, anchorEl, onSelect } = options;

        if (!items || items.length === 0 || !anchorEl) return;

        currentItems = items;
        currentAnchor = anchorEl;
        onSelectCallback = onSelect || null;

        container.innerHTML = '';
        items.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            menuItem.textContent = item.label;
            menuItem.dataset.value = item.value;
            // 如果菜单项标记了 keepOpen，点击后不自动关闭菜单
            menuItem.dataset.keepOpen = item.keepOpen ? 'true' : 'false';
            menuItem.addEventListener('click', (e) => {
                console.log('[MenuUI] 菜单项点击', item.value, 'keepOpen:', item.keepOpen);
                e.stopPropagation();
                handleItemClick(item.value, !!item.keepOpen);
            });
            container.appendChild(menuItem);
        });

        container.style.display = 'block';
        positionMenu(container, anchorEl);

        setTimeout(() => {
            document.addEventListener('mousedown', handleOutsideClick, { once: true });
            document.addEventListener('keydown', handleEscKey, { once: true });
        }, 0);
    }

    function positionMenu(menuEl, anchorEl) {
        const anchorRect = anchorEl.getBoundingClientRect();
        const menuRect = menuEl.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = anchorRect.right + 8;
        let top = anchorRect.top;

        if (left + menuRect.width > viewportWidth) {
            left = anchorRect.left - menuRect.width - 8;
        }
        if (top + menuRect.height > viewportHeight) {
            top = viewportHeight - menuRect.height - 8;
        }
        if (left < 8) left = 8;
        if (top < 8) top = 8;

        menuEl.style.left = `${left}px`;
        menuEl.style.top = `${top}px`;
    }

    function handleItemClick(value, keepOpen = false) {
        console.log('[MenuUI] handleItemClick', value, 'keepOpen:', keepOpen);
        const callback = onSelectCallback;
        if (!keepOpen) {
            hide();
        }
        if (typeof callback === 'function') {
            callback(value);
        }
    }

    function handleOutsideClick(e) {
        if (menuContainer && !menuContainer.contains(e.target)) {
            hide();
        } else {
            document.addEventListener('mousedown', handleOutsideClick, { once: true });
        }
    }

    function handleEscKey(e) {
        if (e.key === 'Escape') {
            hide();
        }
    }

    function hide() {
        console.log('[MenuUI] hide');
        if (menuContainer) {
            menuContainer.style.display = 'none';
            menuContainer.innerHTML = '';
        }
        currentAnchor = null;
        currentItems = [];
        onSelectCallback = null;
        document.removeEventListener('mousedown', handleOutsideClick);
        document.removeEventListener('keydown', handleEscKey);
    }

    global.MenuUI = {
        show,
        hide
    };
})(window);