// js/core/traitManager.js
// 词条管理模块：负责卡牌实例上词条和自定义文本的增删查，并触发状态通知

(function(global) {
    const TraitLibrary = global.TraitLibrary;
    const GameState = global.GameState;

    /**
     * 为卡牌添加库词条
     */
    function addTraitToCard(card, traitName) {
        if (!card || !traitName) return false;
        if (!TraitLibrary.hasTrait(traitName)) return false;
        if (!card.traits) card.traits = [];
        if (card.traits.includes(traitName)) return false; // 避免重复
        card.traits.push(traitName);
        GameState.notifyListeners();
        return true;
    }

    /**
     * 为卡牌添加自定义文本（可任意内容）
     */
    function addCustomTextToCard(card, text) {
        if (!card || !text) return false;
        if (!card.customTexts) card.customTexts = [];
        if (card.customTexts.includes(text)) return false;
        card.customTexts.push(text);
        GameState.notifyListeners();
        return true;
    }

    /**
     * 从卡牌移除词条
     */
    function removeTraitFromCard(card, traitName) {
        if (!card || !card.traits) return false;
        const index = card.traits.indexOf(traitName);
        if (index === -1) return false;
        card.traits.splice(index, 1);
        GameState.notifyListeners();
        return true;
    }

    /**
     * 从卡牌移除自定义文本
     */
    function removeCustomTextFromCard(card, text) {
        if (!card || !card.customTexts) return false;
        const index = card.customTexts.indexOf(text);
        if (index === -1) return false;
        card.customTexts.splice(index, 1);
        GameState.notifyListeners();
        return true;
    }

    /**
     * 获取卡牌所有词条名
     */
    function getCardTraits(card) {
        return card && card.traits ? [...card.traits] : [];
    }

    /**
     * 获取卡牌所有自定义文本
     */
    function getCardCustomTexts(card) {
        return card && card.customTexts ? [...card.customTexts] : [];
    }

    /**
     * 判断卡牌是否拥有某词条
     */
    function hasTraitOnCard(card, traitName) {
        return card && card.traits && card.traits.includes(traitName);
    }

    /**
     * 获取卡牌所有文本（词条 + 自定义），用于详情展示
     */
    function getCardAllTexts(card) {
        const result = [];
        if (card.traits) {
            card.traits.forEach(traitName => {
                const trait = TraitLibrary.getTrait(traitName);
                if (trait) {
                    result.push({ type: 'trait', name: trait.name, description: trait.description, traitType: trait.type });
                }
            });
        }
        if (card.customTexts) {
            card.customTexts.forEach(text => {
                result.push({ type: 'custom', text: text });
            });
        }
        return result;
    }

    global.TraitManager = {
        addTraitToCard,
        addCustomTextToCard,
        removeTraitFromCard,
        removeCustomTextFromCard,
        getCardTraits,
        getCardCustomTexts,
        hasTraitOnCard,
        getCardAllTexts
    };
})(window);