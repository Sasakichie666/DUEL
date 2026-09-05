// js/integration/traitIntegration.js
// 词条系统集成模块：提供自定义输入弹窗用于添加词条或自定义文本

(function(global) {
    console.log('[TraitIntegration] 文件已加载');

    const TraitLibrary = global.TraitLibrary;
    const TraitManager = global.TraitManager;

    /**
     * 显示自定义输入弹窗
     * @param {string} title - 弹窗标题
     * @param {string} placeholder - 输入框占位符
     * @param {Function} callback - 用户点击确定后的回调，参数为输入文本（可能为空）
     */
    function showPrompt(title, placeholder, callback) {
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'trait-prompt-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        // 创建对话框容器
        const dialog = document.createElement('div');
        dialog.className = 'trait-prompt-dialog';
        dialog.style.cssText = `
            background: #1e2a3a;
            border: 2px solid #4a6fa5;
            border-radius: 12px;
            padding: 24px 28px;
            width: 360px;
            max-width: 90vw;
            box-shadow: 0 0 30px rgba(0,0,0,0.8);
            font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            color: #e0e0e0;
        `;

        // 标题
        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        titleEl.style.cssText = `
            margin: 0 0 16px 0;
            color: #ffd700;
            text-align: center;
            font-size: 1.2rem;
            letter-spacing: 1px;
        `;
        dialog.appendChild(titleEl);

        // 输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.style.cssText = `
            width: 100%;
            padding: 10px 12px;
            border: 2px solid #4a6fa5;
            border-radius: 6px;
            background: #0f1a2b;
            color: #ffffff;
            font-size: 1rem;
            outline: none;
            transition: border-color 0.3s;
            box-sizing: border-box;
        `;
        input.addEventListener('focus', () => {
            input.style.borderColor = '#ffd700';
        });
        input.addEventListener('blur', () => {
            input.style.borderColor = '#4a6fa5';
        });
        dialog.appendChild(input);

        // 按钮容器
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 20px;
        `;

        // 取消按钮
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.cssText = `
            padding: 8px 20px;
            background: transparent;
            border: 1px solid #4a6fa5;
            border-radius: 6px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.2s;
        `;
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.background = 'rgba(255,255,255,0.1)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.background = 'transparent';
        });
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            if (callback) callback(null);
        });

        // 确定按钮
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '确定';
        confirmBtn.style.cssText = `
            padding: 8px 20px;
            background: #4a6fa5;
            border: none;
            border-radius: 6px;
            color: #ffffff;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 600;
            transition: background 0.2s;
        `;
        confirmBtn.addEventListener('mouseenter', () => {
            confirmBtn.style.background = '#5d82b8';
        });
        confirmBtn.addEventListener('mouseleave', () => {
            confirmBtn.style.background = '#4a6fa5';
        });
        confirmBtn.addEventListener('click', () => {
            const value = input.value.trim();
            document.body.removeChild(overlay);
            if (callback) callback(value);
        });

        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
        dialog.appendChild(btnContainer);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // 自动聚焦
        setTimeout(() => input.focus(), 50);

        // 回车键触发确定
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                confirmBtn.click();
            }
        });
    }

    /**
     * 弹出添加词条/文本的输入框
     */
    function promptAddTrait(card, anchorEl) {
        console.log('[TraitIntegration] promptAddTrait 被调用');
        if (!card) return;

        showPrompt('添加词条或文本', '输入词条名称（如：迅捷）或任意文本', (inputText) => {
            if (!inputText) return;

            if (TraitLibrary && TraitLibrary.hasTrait(inputText)) {
                const success = TraitManager?.addTraitToCard(card, inputText);
                if (success) {
                    if (global.UI && global.UI.showNotification) {
                        global.UI.showNotification(`已添加词条「${inputText}」`, 'success');
                    }
                } else {
                    if (global.UI && global.UI.showNotification) {
                        global.UI.showNotification(`无法添加词条「${inputText}」`, 'warning');
                    }
                }
            } else {
                const success = TraitManager?.addCustomTextToCard(card, inputText);
                if (success) {
                    if (global.UI && global.UI.showNotification) {
                        global.UI.showNotification(`已添加自定义文本：「${inputText}」`, 'success');
                    }
                } else {
                    if (global.UI && global.UI.showNotification) {
                        global.UI.showNotification('添加失败', 'error');
                    }
                }
            }

            if (global.UI && global.UI.refreshAll) {
                global.UI.refreshAll();
            }
        });
    }

    global.TraitIntegration = {
        promptAddTrait
    };
})(window);