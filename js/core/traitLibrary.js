// js/core/traitLibrary.js
// 文本库模块：仅存储预定义词条及其描述、类型

(function(global) {
    const traits = new Map();

    /**
     * 定义或覆盖一个词条
     * @param {string} name - 词条名称
     * @param {string} description - 详细描述
     * @param {string} type - 类型：'effect'（效果）或 'status'（状态）
     */
    function defineTrait(name, description, type = 'status') {
        if (!name || !description) return false;
        traits.set(name, { name, description, type });
        return true;
    }

    /**
     * 获取词条定义
     */
    function getTrait(name) {
        return traits.get(name) || null;
    }

    /**
     * 判断词条是否存在
     */
    function hasTrait(name) {
        return traits.has(name);
    }

    /**
     * 获取所有词条（数组）
     */
    function getAllTraits() {
        return Array.from(traits.values());
    }

    // 内置词条
    defineTrait('迅捷', '这个效果在对方回合也能发动', 'effect');
    defineTrait('冻结', '这张卡直到下下个回合结束，无法进行攻击，格挡以及发动效果', 'status');
    defineTrait('连击', '攻击时可以额外攻击一次', 'effect');
    defineTrait('守护', '对手必须优先攻击此随从', 'effect');
    defineTrait('嗜血', '造成伤害时恢复等量生命值', 'effect');
    defineTrait('圣盾', '免疫下一次受到的伤害', 'status');
    defineTrait('禁锢', '这张卡直到下下个回合结束，无法进行攻击，格挡', 'status');
    defineTrait('入阵曲', '进入战场时自动触发效果', 'effect');
    defineTrait('决斗', '选择对方一名随从可以发动，攻击力等于或小于这张卡时破坏', 'effect');
    defineTrait('占卜', '公开你牌库顶的三张牌，将其中一张加入手牌，其余两张放回牌库底', 'effect');
    defineTrait('预知', '从牌库顶查看两张牌，将其中一张加入手牌，其余一张放回牌库底', 'effect');
    defineTrait('启示', '启示X，选择将X张手牌放回牌库底，抽X张牌', 'effect');
    defineTrait('洞察', '查看你牌顶两张牌，以喜欢的顺序将其放回牌库顶或者牌库底', 'effect');
    defineTrait('盖伏', '盖伏后翻开时可以发动效果', 'effect');
    defineTrait('吟唱', '吟唱X，X为触发此效果的倒计数，每回合结束计数-1', 'effect');
    defineTrait('打断', '在我方回合才能发动效果', 'effect');
    defineTrait('反击', '在对方回合才能发动效果', 'effect');
    defineTrait('瞬发', '在双方回合可以发动效果', 'effect');
    defineTrait('触发', '满足条件即可触发效果，无需发动', 'effect');
    defineTrait('共鸣', '回响区满足条件可以发动效果', 'effect');
    defineTrait('回响', '让对应的斌能回到斌能牌库底才能发动效果', 'effect');
    defineTrait('导流', '导流X，将X张斌能牌以活跃状态放置于回响区', 'effect');
    defineTrait('灵敏', '下一次被选择为效果对象的效果无效', 'effect');
    defineTrait('扰魔', '扰魔X，对方必须额外花费X才能选择这张卡为效果对象发动效果', 'effect');
    defineTrait('破甲', '对方持有守护效果的随从和这张卡交战后，失去守护', 'effect');
    defineTrait('枯萎', '这张卡的攻击力和防御力变为0', 'status');
    defineTrait('沉默', '这张卡持有的所有效果无效化', 'statust');
    defineTrait('灵风', '这张卡不会成为对方效果的选择对象', 'effect');
    defineTrait('流转', '在墓场也可以发动效果，那之后放逐', 'effect');
    defineTrait('遗言', '进入墓场时触发效果', 'effect');
    defineTrait('强袭', '进入战场即可对对方主战者和随从发动攻击', 'effect');
    defineTrait('突进', '进入战场即可对对方随从发动攻击', 'effect');
    defineTrait('穿透', '交战后破坏对方随从时给予对方主战者这张卡攻击力数值的伤害', 'effect');
    defineTrait('威慑', '这张卡不会成为发动攻击的对象', 'effect');
    // 可按需扩展

    global.TraitLibrary = {
        defineTrait,
        getTrait,
        hasTrait,
        getAllTraits
    };
})(window);