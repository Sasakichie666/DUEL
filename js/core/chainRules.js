// js/core/chainRules.js
// 响应连锁「时点配置表」+ 目标合法性判定 —— 纯数据 + 纯函数，不持有任何状态。
// 想新增一种时点：在 TIME_POINTS 加一条配置即可，无需改动状态机与 UI。
//
// 目标范围（scope）以「当前选择者（行动方）」为参照：
//   'allField'          双方战场上的卡牌
//   'allFieldAndAvatar' 双方战场卡牌或头像
//   'foeFrontAndAvatar' 对方前场随从或对方头像
//   'ownFront'          我方前场随从（用于阻挡）

(function(global) {
    const TIME_POINTS = {
        // 随从登场：只能响应/略过，没有目标选择
        MINION_ENTER: {
            key: 'MINION_ENTER',
            label: '随从登场',
            icon: '🃏',
            summary: '一名随从进入了战场',
            scope: null,
            scopeHint: '',
            arrowColor: null,
            allowBlock: false,
            responses: ['tactic', 'minionEffect']
        },

        // 战术卡发动：可多选目标 + 蓝色箭头
        TACTIC_ACTIVATE: {
            key: 'TACTIC_ACTIVATE',
            label: '战术卡发动',
            icon: '✨',
            summary: '一张战术牌被发动',
            scope: 'allFieldAndAvatar',
            scopeHint: '点击战场卡牌或头像选择目标（再点一次取消）',
            arrowColor: 'blue',
            allowBlock: false,
            responses: ['tactic', 'minionEffect']
        },

        // 随从发动效果：同战术，箭头同为蓝色
        MINION_EFFECT: {
            key: 'MINION_EFFECT',
            label: '随从效果发动',
            icon: '💥',
            summary: '一名随从发动了效果',
            scope: 'allFieldAndAvatar',
            scopeHint: '点击战场卡牌或头像选择目标（再点一次取消）',
            arrowColor: 'blue',
            allowBlock: false,
            responses: ['tactic', 'minionEffect']
        },

        // 宣言攻击：只能指向对方前场随从或对方头像 + 红色箭头；指向头像时对方可阻挡
        ATTACK_DECLARE: {
            key: 'ATTACK_DECLARE',
            label: '宣言攻击',
            icon: '⚔️',
            summary: '一名随从宣言攻击',
            scope: 'foeFrontAndAvatar',
            scopeHint: '点击对方前场随从或对方头像选择攻击目标',
            arrowColor: 'red',
            allowBlock: true,
            responses: ['tactic', 'minionEffect']
        },

        // 阻挡宣言：由攻击窗口内点「阻挡」进入，只能选我方前场随从，箭头转黄
        BLOCK_DECLARE: {
            key: 'BLOCK_DECLARE',
            label: '阻挡宣言',
            icon: '🛡️',
            summary: '一名随从进行了阻挡',
            scope: 'ownFront',
            scopeHint: '选择我方前场随从进行阻挡',
            arrowColor: 'yellow',
            allowBlock: false,
            // 它不是"等待对方响应的时点"，而是响应方自己点「阻挡」进入的 →
            // 侧栏「响应」忽略面板里不给勾选（勾了也没有意义 ✗）
            ignorable: false,
            responses: ['tactic', 'minionEffect']
        },

        // 翻盖：玩家执行「翻盖」行动后触发的时点（场上翻盖 / 手牌盖伏登场 都算 ✓）
        //   与「随从登场」一样：只能响应 / 略过，不需要选目标 ✓
        FLIP_DECLARE: {
            key: 'FLIP_DECLARE',
            label: '翻盖',
            icon: '🎴',
            summary: '一名卡牌被翻盖',
            scope: null,
            scopeHint: '',
            arrowColor: null,
            allowBlock: false,
            responses: ['tactic', 'minionEffect']
        }
    };

    // 事件总线 type → 时点 key
    const BUS_TO_TIME_POINT = {
        'minion:enter': 'MINION_ENTER',
        'tactic:activate': 'TACTIC_ACTIVATE',
        'minion:effect': 'MINION_EFFECT',
        'attack:declare': 'ATTACK_DECLARE',
        'flip:declare': 'FLIP_DECLARE'
    };

    // 箭头配色（与 css/chain.css 中的 --arrow-* 对应）
    const ARROW_COLORS = {
        blue:   { stroke: '#4d8dff', glow: 'rgba(77, 141, 255, 0.55)' },
        red:    { stroke: '#ff4d6a', glow: 'rgba(255, 77, 106, 0.55)' },
        yellow: { stroke: '#ffd700', glow: 'rgba(255, 215, 0, 0.55)' }
    };

    function get(key) { return TIME_POINTS[key] || null; }

    function fromBusType(busType) { return BUS_TO_TIME_POINT[busType] || null; }

    /** 时点 key → 事件总线 type（反查；调试开窗等地方用 ✓） */
    function toBusType(key) {
        const hit = Object.keys(BUS_TO_TIME_POINT).find(k => BUS_TO_TIME_POINT[k] === key);
        return hit || null;
    }

    /* ================= scope → 高亮用的 CSS 类 ================= */
    // 目标选择时给 <body> 挂的类（CSS 里据此高亮"可点目标"），只在这里维护一份
    const SCOPE_CLASS = {
        allField: 'chain-scope-allField',
        allFieldAndAvatar: 'chain-scope-allFieldAndAvatar',
        foeFrontAndAvatar: 'chain-scope-foeFrontAndAvatar',
        ownFront: 'chain-scope-ownFront'
    };

    function scopeClass(scope) { return SCOPE_CLASS[scope] || null; }

    /** 该时点是否需要在行动时选择目标 */
    function needsTargets(key) {
        const rule = get(key);
        return !!(rule && rule.scope);
    }

    /** 判定某张牌是否在指定方的前场 */
    function isOnFrontField(side, instanceId) {
        const GS = global.GameState;
        if (!GS || !GS.getPlayerState) return false;
        const p = GS.getPlayerState(side);
        if (!p || !Array.isArray(p.frontField)) return false;
        return p.frontField.some(c => c && c.instanceId === instanceId);
    }

    /**
     * 目标是否合法
     * @param {string} timePoint  时点 key
     * @param {string} pickerSide 选择者（行动方）的本地视角 side：'self' | 'opponent'
     * @param {object} target     { type:'card'|'avatar', side, instanceId }
     */
    function isTargetLegal(timePoint, pickerSide, target) {
        const rule = get(timePoint);
        if (!rule || !rule.scope || !target) return false;
        const isMine = target.side === pickerSide;

        switch (rule.scope) {
            case 'allField':
                return target.type === 'card';
            case 'allFieldAndAvatar':
                return target.type === 'card' || target.type === 'avatar';
            case 'foeFrontAndAvatar':
                if (isMine) return false;
                if (target.type === 'avatar') return true;
                return isOnFrontField(target.side, target.instanceId);
            case 'ownFront':
                return isMine && target.type === 'card' && isOnFrontField(target.side, target.instanceId);
            default:
                return false;
        }
    }

    global.ChainRules = {
        TIME_POINTS,
        ARROW_COLORS,
        get,
        fromBusType,
        toBusType,
        needsTargets,
        isTargetLegal,
        isOnFrontField,
        scopeClass
    };
})(window);
