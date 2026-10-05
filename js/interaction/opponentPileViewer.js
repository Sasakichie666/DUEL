// js/interaction/opponentPileViewer.js
// 点击对手墓场/放逐区直接查阅

(function(global) {
    function init() {
        document.addEventListener('click', (e) => {
            const slot = e.target.closest('.deck-slot');
            if (!slot) return;
            const type = slot.getAttribute('data-type');
            if (type !== 'graveyard' && type !== 'exile') return;
            const side = slot.closest('.deck-zone')?.getAttribute('data-side');
            if (side !== 'opponent') return;

            const opponent = global.GameState?.getPlayerState('opponent');
            if (!opponent || !opponent[type] || opponent[type].length === 0) return;

            const cards = opponent[type].slice().reverse(); // 顶部在前
            const title = type === 'graveyard' ? '对方墓场' : '对方放逐区';
            if (global.ViewerUI) {
                global.ViewerUI.show(cards, title);
            }
        });
    }

    global.OpponentPileViewer = { init };
})(window);