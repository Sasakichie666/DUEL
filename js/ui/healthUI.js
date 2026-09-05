// js/ui/healthUI.js
// 血量UI模块：负责血量显示更新和点击修改交互（仅允许修改自己的血量）

(function(global) {
    const HealthUI = {
        /**
         * 初始化血量显示和点击事件
         * @param {object} els - UI元素集合
         */
        init(els) {
            this.els = els;
            this.bindClickEvents();
        },

        /**
         * 绑定血量点击事件（只绑定自己血量，对手血量不可点击）
         */
        bindClickEvents() {
            const { selfHealth, opponentHealth } = this.els;
            if (!selfHealth || !opponentHealth) return;

            // 仅允许点击自己的血量进行修改
            selfHealth.addEventListener('click', () => {
                global.CounterPopup.show({
                    anchorEl: selfHealth,
                    values: [-5, -1, +1, +5],
                    onSelect: (delta) => {
                        global.StatManager.changeHealth('self', delta);
                    }
                });
            });

            // 对手血量不绑定点击事件，但可以增加提示样式表示不可修改
            opponentHealth.style.cursor = 'default';
            opponentHealth.title = '对手血量由对方修改';
        },

        /**
         * 更新血量显示
         */
        updateDisplay() {
            const { GameState } = global;
            if (!GameState || !GameState.getState()) return;
            const selfPlayer = GameState.getPlayerState('self');
            const opponentPlayer = GameState.getPlayerState('opponent');
            const { selfHealth, opponentHealth } = this.els;
            if (selfPlayer && selfHealth) {
                selfHealth.textContent = `❤️ ${selfPlayer.health}`;
            }
            if (opponentPlayer && opponentHealth) {
                opponentHealth.textContent = `❤️ ${opponentPlayer.health}`;
            }
        }
    };

    global.HealthUI = HealthUI;
})(window);