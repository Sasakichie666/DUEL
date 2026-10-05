// js/ui/contextMenu.js
// 上下文菜单：按卡牌所在区域 / 牌库类型生成菜单项，交给 MenuUI 显示
//
// 框架整理：
//   · 原来「卡牌菜单」和「牌库菜单」各有一个 60 行左右的 switch 分发动作，
//     现合并为一张【动作分发表】ACTIONS —— value → 处理函数，行为逐条对齐原实现
//   · 菜单数据（_getMenuItemsForZone）与分发逻辑分离，纯数据、便于查改
//   · 去掉调试日志（只在收到未登记的动作时 warn 一次）

(function(global) {

    /** 调用 MenuAction 上的动作（模块或方法缺失时静默跳过，与旧代码的可选链行为一致） */
    function callAction(name, ...args) {
        const MA = global.MenuAction;
        if (MA && typeof MA[name] === 'function') return MA[name](...args);
        return undefined;
    }

    /** 抽牌 / 洗切后统一刷新界面 */
    function drawAndRefresh(deckType) {
        const CA = global.CardActions;
        if (CA && CA.drawFromDeck) CA.drawFromDeck('self', deckType, 1);
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
    }

    function shuffleAndRefresh(deckType) {
        const CA = global.CardActions;
        if (CA && CA.shuffleDeck) CA.shuffleDeck('self', deckType);
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
    }

    /** 「添加」：优先走词条集成面板，缺失时退回 prompt（与原实现一致） */
    function addTrait(card, sourceEl) {
        if (global.TraitIntegration && global.TraitIntegration.promptAddTrait) {
            global.TraitIntegration.promptAddTrait(card, sourceEl);
            return;
        }
        const input = window.prompt('请输入要添加的词条或文本：');
        if (!input) return;
        const trimmed = input.trim();
        if (!trimmed) return;

        if (global.TraitLibrary && global.TraitLibrary.hasTrait(trimmed)) {
            global.TraitManager?.addTraitToCard(card, trimmed);
        } else {
            global.TraitManager?.addCustomTextToCard(card, trimmed);
        }
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
    }

    /** 「清除」：清空该卡的词条与自定义文本 */
    function clearTraits(card) {
        if (!card) return;
        if (!card.traits) card.traits = [];
        if (!card.customTexts) card.customTexts = [];
        card.traits.length = 0;
        card.customTexts.length = 0;
        if (global.GameState) global.GameState.notifyListeners();
        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
    }

    /**
     * 动作分发表：菜单项的 value → 处理函数。
     * 统一签名 (card, sourceEl)：卡牌动作用得上，牌库动作忽略这两个参数。
     */
    const ACTIONS = {
        // ===== 卡牌动作（手牌 / 前后场 / 费用区 / 墓场 / 放逐 / 个人区 / 公共区）=====
        playToFront: c => callAction('playToFront', c),
        activateToBack: c => callAction('activateToBack', c),
        payToCost: c => callAction('payToCost', c),
        returnToHand: c => callAction('returnToHand', c),
        discard: c => callAction('discard', c),
        exile: c => callAction('exile', c),
        returnToDeck: c => callAction('returnToDeck', c),
        setFaceDown: c => callAction('setFaceDown', c),
        toggleFaceDown: c => callAction('toggleFaceDown', c),
        returnToMainDeckTop: c => callAction('returnToMainDeckTop', c),
        returnToMainDeckBottom: c => callAction('returnToMainDeckBottom', c),
        toggleActive: c => callAction('toggleActive', c),
        modifyStats: (c, src) => callAction('modifyStats', c, src),
        declareAttack: c => callAction('declareAttack', c),
        activateEffect: c => callAction('activateEffect', c),
        addTrait: (c, src) => addTrait(c, src),
        clearTraits: c => clearTraits(c),
        equipCard: c => global.EquipController && global.EquipController.startEquipSelection(c),

        // ===== 转移控制权 / 复制卡牌（见 js/core/controlManager.js）=====
        //   「转移」：二级菜单（战场 / 手牌）→ 战场由我点选对方前场空格，手牌直接交给对方 ✓
        //   「复制」：二级菜单（战场 / 手牌）→ 都由我点选我方前场空格 / 直接进我方手牌 ✓
        transferCard: (c, src) => openSubmenu(c, src, [
            { label: '战场', value: 'transferToField', tone: 'primary' },
            { label: '手牌', value: 'transferToHand', tone: 'primary' }
        ]),
        copyCard: (c, src) => openSubmenu(c, src, [
            { label: '战场', value: 'copyToField', tone: 'primary' },
            { label: '手牌', value: 'copyToHand', tone: 'primary' }
        ]),
        transferToField: c => startTransferToField(c),
        transferToHand: c => { if (global.ControlManager) global.ControlManager.transferToHand(c); },
        copyToField: c => startCopyToField(c),
        copyToHand: c => { if (global.ControlManager) global.ControlManager.copyToHand(c); },

        // ===== 区域动作（不带卡牌）=====
        viewGraveyard: () => callAction('viewGraveyard'),
        viewExile: () => callAction('viewExile'),

        // ===== 牌库动作 =====
        drawCard: () => drawAndRefresh('mainDeck'),
        drawCostCard: () => drawAndRefresh('costDeck'),
        drawLegendCard: () => drawAndRefresh('legendDeck'),
        shuffleDeck: () => shuffleAndRefresh('mainDeck'),
        shuffleCostDeck: () => shuffleAndRefresh('costDeck'),
        shuffleLegendDeck: () => shuffleAndRefresh('legendDeck'),
        publicReveal: () => callAction('publicReveal'),
        searchMainDeck: () => callAction('searchDeck', 'mainDeck'),
        searchCostDeck: () => callAction('searchDeck', 'costDeck'),
        // 「翻阅」：先输入张数 → 打开的检索界面只含【牌库顶 N 张】（见 menuAction.peekDeck ✓）
        peekMainDeck: (c, src) => callAction('peekDeck', 'mainDeck', src),
        peekCostDeck: (c, src) => callAction('peekDeck', 'costDeck', src),
        searchLegendDeck: () => callAction('searchDeck', 'legendDeck'),
        viewLegendDeck: () => callAction('viewDeck', 'legendDeck')
    };

    /** 二级菜单：以同一张卡为锚点再弹一层 ✓ */
    function openSubmenu(card, sourceEl, items) {
        if (!global.MenuUI) return;
        global.MenuUI.show({
            items: items,
            anchorEl: sourceEl,
            onSelect: (value) => dispatch(value, card, sourceEl)
        });
    }

    /** 战场包含的区域：转移 / 复制时前场与后场的空格都会亮起 ✓ */
    const BATTLE_ZONES = ['frontField', 'backField'];

    /** 「转移 → 战场」：点亮对方【前场 + 后场】的空格，我点哪格就放哪格 ✓ */
    function startTransferToField(card) {
        if (!global.ControlManager || !global.MenuAction) return;
        if (!global.ControlManager.hasEmptySlotIn('opponent', BATTLE_ZONES)) {
            if (global.UI && global.UI.showNotification) {
                global.UI.showNotification('对方战场没有空位，无法转移', 'warning');
            }
            return;
        }
        global.MenuAction.startSelectionOnSide(BATTLE_ZONES, 'opponent', (index, slot, zone) => {
            global.ControlManager.transferToField(card, zone, index);
        });
    }

    /** 「复制 → 战场」：点亮我方【前场 + 后场】的空格，我点哪格就复制到哪格 ✓ */
    function startCopyToField(card) {
        if (!global.ControlManager || !global.MenuAction) return;
        global.MenuAction.startSelectionOnSide(BATTLE_ZONES, 'self', (index, slot, zone) => {
            global.ControlManager.copyToField(card, zone, index);
        });
    }

    /** 菜单项被点 → 查表分发 */
    function dispatch(value, card, sourceEl) {
        const handler = ACTIONS[value];
        if (!handler) {
            console.warn('[ContextMenu] 未处理的菜单动作:', value);
            return;
        }
        handler(card, sourceEl);
    }

    /** 统一的「生成菜单 → 显示」入口 */
    function openMenu(items, sourceEl, card) {
        if (!items || items.length === 0 || !sourceEl) return;
        if (!global.MenuUI) return;
        global.MenuUI.show({
            items,
            anchorEl: sourceEl,
            onSelect: (value) => dispatch(value, card, sourceEl)
        });
    }

    const ContextMenu = {
        /** 点某张卡 → 自己的卡给完整菜单；对方场上的卡只给「复制」✓ */
        handleCardClick(card, sourceEl) {
            if (!card || !sourceEl) return;

            const mine = global.ControlManager
                ? global.ControlManager.isMine(card)
                : ((card.controller || card.owner) === 'self');

            if (mine) {
                openMenu(this._getMenuItemsForZone(card.zone, card), sourceEl, card);
                return;
            }

            // 不是自己控制的卡：只有"对方场上的卡"能复制 ✓（其余一律不给操作 ✓）
            if (card.zone === 'frontField' || card.zone === 'backField') {
                openMenu([
                    { label: '复制', value: 'copyCard', tone: 'modify' }
                ], sourceEl, card);
            }
        },

        /** 点自己某个牌库 / 堆叠 → 弹出牌库菜单 */
        handleDeckClick(deckType, sourceEl) {
            openMenu(this._getMenuItemsForZone(deckType, null), sourceEl, null);
        },

        /** 区域 → 菜单项（纯数据；tone 决定配色，separator 为分组分界线） */
        _getMenuItemsForZone(zone, card) {
            switch (zone) {
                case 'hand':
                    // 主手牌：登场、发动 │ 进墓、放逐、回库 │ 翻盖、装备
                    //（「支付」已移除：费用牌相关操作统一走「费用牌界面」批量面板）
                    return [
                        { label: '登场', value: 'playToFront', tone: 'primary' },
                        { label: '发动', value: 'activateToBack', tone: 'primary' },
                        { separator: true },
                        { label: '进墓', value: 'discard', tone: 'danger' },
                        { label: '放逐', value: 'exile', tone: 'danger' },
                        { label: '回库', value: 'returnToDeck', tone: 'danger' },
                        { separator: true },
                        { label: '翻盖', value: 'setFaceDown', tone: 'modify' },
                        { label: '装备', value: 'equipCard', tone: 'modify' },
                        { label: '转移', value: 'transferCard', tone: 'modify' },
                        { label: '复制', value: 'copyCard', tone: 'modify' },
                    ];
                case 'frontField':
                    // 前场：攻击、发动、切换 │ 回手、进墓、放逐、回库 │ 翻盖、修改、添加、清除、装备
                    return [
                        { label: '攻击', value: 'declareAttack', tone: 'primary' },
                        { label: '发动', value: 'activateEffect', tone: 'primary' },
                        { label: '切换', value: 'toggleActive', tone: 'primary' },
                        { separator: true },
                        { label: '回手', value: 'returnToHand', tone: 'danger' },
                        { label: '进墓', value: 'discard', tone: 'danger' },
                        { label: '放逐', value: 'exile', tone: 'danger' },
                        { label: '回库', value: 'returnToDeck', tone: 'danger' },
                        { separator: true },
                        { label: '翻盖', value: 'toggleFaceDown', tone: 'modify' },
                        { label: '修改', value: 'modifyStats', tone: 'modify' },
                        { label: '添加', value: 'addTrait', tone: 'modify' },
                        { label: '清除', value: 'clearTraits', tone: 'modify' },
                        { label: '装备', value: 'equipCard', tone: 'modify' },
                        { label: '转移', value: 'transferCard', tone: 'modify' },
                        { label: '复制', value: 'copyCard', tone: 'modify' },
                    ];
                case 'backField':
                    // 后场：发动、切换 │ 回手、进墓、放逐、回库 │ 翻盖、添加、清除、装备、转移、复制
                    return [
                        { label: '发动', value: 'activateEffect', tone: 'primary' },
                        { label: '切换', value: 'toggleActive', tone: 'primary' },
                        { label: '回手', value: 'returnToHand', tone: 'danger' },
                        { label: '进墓', value: 'discard', tone: 'danger' },
                        { label: '放逐', value: 'exile', tone: 'danger' },
                        { label: '回库', value: 'returnToDeck', tone: 'danger' },
                        { separator: true },
                        { label: '翻盖', value: 'toggleFaceDown', tone: 'modify' },
                        { label: '添加', value: 'addTrait', tone: 'modify' },
                        { label: '清除', value: 'clearTraits', tone: 'modify' },
                        { label: '装备', value: 'equipCard', tone: 'modify' },
                        { label: '转移', value: 'transferCard', tone: 'modify' },
                        { label: '复制', value: 'copyCard', tone: 'modify' },
                    ];
                case 'costZone':
                    return [
                        { label: '切换', value: 'toggleActive', tone: 'primary' },
                        { label: '回手', value: 'returnToHand', tone: 'danger' },
                        { label: '进墓', value: 'discard', tone: 'danger' },
                        { label: '回库', value: 'returnToDeck', tone: 'danger' },
                        { label: '放逐', value: 'exile', tone: 'danger' },
                        { label: '添加', value: 'addTrait', tone: 'modify' },
                        { label: '清除', value: 'clearTraits', tone: 'modify' },
                        { label: '转移', value: 'transferCard', tone: 'modify' }
                    ];
                case 'mainDeck':
                    // 「查阅」已按要求移除；「公开」暂不提供（公共区 UI 已移除）
                    return [
                        { label: '抽牌', value: 'drawCard', keepOpen: true, tone: 'primary' },
                        { label: '检索', value: 'searchMainDeck', tone: 'modify' },
                        { label: '翻阅', value: 'peekMainDeck', tone: 'modify' },
                        { label: '洗切', value: 'shuffleDeck', tone: 'neutral' }
                    ];
                case 'costDeck':
                    return [
                        { label: '抽牌', value: 'drawCostCard', keepOpen: true, tone: 'primary' },
                        { label: '检索', value: 'searchCostDeck', tone: 'modify' },
                        { label: '翻阅', value: 'peekCostDeck', tone: 'modify' },
                        { label: '洗切', value: 'shuffleCostDeck', tone: 'neutral' }
                    ];
                case 'legendDeck':
                    return [
                        { label: '抽牌', value: 'drawLegendCard', keepOpen: true, tone: 'primary' },
                        { label: '查阅', value: 'viewLegendDeck', tone: 'neutral' },
                        { label: '检索', value: 'searchLegendDeck', tone: 'modify' },
                        { label: '洗切', value: 'shuffleLegendDeck', tone: 'neutral' }
                    ];
                case 'graveyard':
                    return [
                        { label: '查阅', value: 'viewGraveyard', tone: 'neutral' },
                        { label: '回手', value: 'returnToHand', tone: 'danger' },
                        { label: '登场', value: 'playToFront', tone: 'primary' },
                        { label: '发动', value: 'activateToBack', tone: 'primary' },
                        { label: '装备', value: 'equipCard', tone: 'modify' },
                        { label: '回库', value: 'returnToDeck', tone: 'danger' }
                    ];
                case 'exile':
                    return [
                        { label: '查阅', value: 'viewExile', tone: 'neutral' },
                        { label: '回手', value: 'returnToHand', tone: 'danger' },
                        { label: '登场', value: 'playToFront', tone: 'primary' },
                        { label: '发动', value: 'activateToBack', tone: 'primary' },
                        { label: '装备', value: 'equipCard', tone: 'modify' },
                        { label: '回库', value: 'returnToDeck', tone: 'danger' }
                    ];
                case 'personalZone':
                case 'publicField':
                    return [
                        { label: '回手', value: 'returnToHand', tone: 'danger' },
                        { label: '回主牌库顶', value: 'returnToMainDeckTop', tone: 'danger' },
                        { label: '回主牌库底', value: 'returnToMainDeckBottom', tone: 'danger' }
                    ];
                default:
                    return [];
            }
        }
    };

    global.ContextMenu = ContextMenu;
})(window);
