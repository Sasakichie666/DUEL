// js/core/statManager.js
// 数值管理模块：负责血量、攻击力、防御力等数值的修改，以及步长管理

(function(global) {
    const CardActions = global.CardActions;

    // 步长，默认1
    let step = 1;

    /**
     * 修改玩家血量
     * @param {string} player - 'self' 或 'opponent'
     * @param {number} delta - 变化量，正数增加，负数减少
     */
    function changeHealth(player, delta) {
        CardActions.changeHealth(player, delta);
        if (global.BattleLog) {
            const who = player === 'self' ? 'self' : 'opponent';
            global.BattleLog.log(`生命 ${delta > 0 ? '+' : ''}${delta}`, who);
        }
        if (global.UI && global.UI.refreshAll) {
            global.UI.refreshAll();
        }
    }

    /**
     * 修改卡牌攻击力
     * @param {object} cardInstance - 卡牌实例
     * @param {number} delta - 变化量（正负）
     */
    function modifyAttack(cardInstance, delta) {
        if (!cardInstance || cardInstance.currentAttack == null) return;
        let newAttack = cardInstance.currentAttack + delta;
        newAttack = Math.max(0, Math.min(999, newAttack));
        cardInstance.currentAttack = newAttack;
        if (global.BattleLog) {
            const name = (cardInstance.cardData && cardInstance.cardData.name) || '卡牌';
            global.BattleLog.log(`「${name}」攻击力 ${delta > 0 ? '+' : ''}${delta} → ${newAttack}`, 'self');
        }
        global.GameState.notifyListeners();
    }

    /**
     * 修改卡牌防御力
     * @param {object} cardInstance - 卡牌实例
     * @param {number} delta - 变化量（正负）
     */
    function modifyDefense(cardInstance, delta) {
        if (!cardInstance || cardInstance.currentDefense == null) return;
        let newDefense = cardInstance.currentDefense + delta;
        newDefense = Math.max(0, Math.min(999, newDefense));
        cardInstance.currentDefense = newDefense;
        if (global.BattleLog) {
            const name = (cardInstance.cardData && cardInstance.cardData.name) || '卡牌';
            global.BattleLog.log(`「${name}」防御力 ${delta > 0 ? '+' : ''}${delta} → ${newDefense}`, 'self');
        }
        global.GameState.notifyListeners();
    }

    /**
     * 获取当前步长
     */
    function getStep() {
        return step;
    }

    /**
     * 设置步长
     * @param {number} value - 新步长
     */
    function setStep(value) {
        if (typeof value === 'number' && value > 0) {
            step = value;
        }
    }

    global.StatManager = {
        changeHealth,
        modifyAttack,
        modifyDefense,
        getStep,
        setStep
    };
})(window);