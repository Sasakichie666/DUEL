// js/ui/contextMenu.js
// 上下文菜单：根据卡牌所在区域动态生成菜单项，并调用 MenuUI 显示
// 修改：增加传说牌库（legendDeck）菜单支持

(function(global) {
    const ContextMenu = {
        handleCardClick(card, sourceEl) {
            console.log('[ContextMenu] handleCardClick', card, sourceEl);
            if (!card || !sourceEl) return;

            // 只允许操作自己的卡牌
            if (card.owner !== 'self') return;

            const zone = card.zone;
            const items = this._getMenuItemsForZone(zone, card);
            if (items.length === 0) return;

            global.MenuUI.show({
                items,
                anchorEl: sourceEl,
                onSelect: (value) => {
                    console.log('[ContextMenu] onSelect', value);
                    switch (value) {
                        case 'playToFront':
                            global.MenuAction?.playToFront(card);
                            break;
                        case 'activateToBack':
                            global.MenuAction?.activateToBack(card);
                            break;
                        case 'payToCost':
                            global.MenuAction?.payToCost(card);
                            break;
                        case 'returnToHand':
                            global.MenuAction?.returnToHand(card);
                            break;
                        case 'discard':
                            global.MenuAction?.discard(card);
                            break;
                        case 'exile':
                            global.MenuAction?.exile(card);
                            break;
                        case 'returnToDeck':
                            global.MenuAction?.returnToDeck(card);
                            break;
                        case 'setFaceDown':
                            global.MenuAction?.setFaceDown(card);
                            break;
                        case 'toggleFaceDown':
                            global.MenuAction?.toggleFaceDown(card);
                            break;
                        case 'returnToMainDeckTop':
                            global.MenuAction?.returnToMainDeckTop(card);
                            break;
                        case 'returnToMainDeckBottom':
                            global.MenuAction?.returnToMainDeckBottom(card);
                            break;
                        case 'viewGraveyard':
                            global.MenuAction?.viewGraveyard();
                            break;
                        case 'viewExile':
                            global.MenuAction?.viewExile();
                            break;
                        case 'toggleActive':
                            global.MenuAction?.toggleActive(card);
                            break;
                        case 'modifyStats':
                            global.MenuAction?.modifyStats(card, sourceEl);
                            break;
                        case 'addTrait':
                            if (global.TraitIntegration && global.TraitIntegration.promptAddTrait) {
                                global.TraitIntegration.promptAddTrait(card, sourceEl);
                            } else {
                                const input = window.prompt('请输入要添加的词条或文本：');
                                if (input) {
                                    const trimmed = input.trim();
                                    if (trimmed) {
                                        if (global.TraitLibrary && global.TraitLibrary.hasTrait(trimmed)) {
                                            global.TraitManager?.addTraitToCard(card, trimmed);
                                        } else {
                                            global.TraitManager?.addCustomTextToCard(card, trimmed);
                                        }
                                        if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                                    }
                                }
                            }
                            break;
                        case 'clearTraits':
                            if (!card.traits) card.traits = [];
                            if (!card.customTexts) card.customTexts = [];
                            card.traits.length = 0;
                            card.customTexts.length = 0;
                            global.GameState.notifyListeners();
                            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                            break;
                        case 'equipCard':
                            global.EquipController?.startEquipSelection(card);
                            break;
                        default:
                            console.log('未实现的菜单动作:', value);
                    }
                }
            });
        },

        handleDeckClick(deckType, sourceEl) {
            console.log('[ContextMenu] handleDeckClick', deckType);
            const items = this._getMenuItemsForZone(deckType, null);
            if (items.length === 0) return;
            global.MenuUI.show({
                items,
                anchorEl: sourceEl,
                onSelect: (value) => {
                    console.log('牌库菜单动作:', value);
                    switch (value) {
                        case 'drawCard':
                            global.CardActions.drawFromDeck('self', 'mainDeck', 1);
                            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                            break;
                        case 'drawCostCard':
                            global.CardActions.drawFromDeck('self', 'costDeck', 1);
                            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                            break;
                        case 'drawLegendCard':
                            global.CardActions.drawFromDeck('self', 'legendDeck', 1);
                            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                            break;
                        case 'shuffleDeck':
                            global.CardActions.shuffleDeck('self', 'mainDeck');
                            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                            break;
                        case 'shuffleCostDeck':
                            global.CardActions.shuffleDeck('self', 'costDeck');
                            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                            break;
                        case 'shuffleLegendDeck':
                            global.CardActions.shuffleDeck('self', 'legendDeck');
                            if (global.UI && global.UI.refreshAll) global.UI.refreshAll();
                            break;
                        case 'publicReveal':
                            global.MenuAction?.publicReveal();
                            break;
                        case 'searchMainDeck':
                            global.MenuAction?.searchDeck('mainDeck');
                            break;
                        case 'searchCostDeck':
                            global.MenuAction?.searchDeck('costDeck');
                            break;
                        case 'searchLegendDeck':
                            global.MenuAction?.searchDeck('legendDeck');
                            break;
                        default:
                            console.log('未实现的牌库动作:', value);
                    }
                }
            });
        },

        _getMenuItemsForZone(zone, card) {
            switch (zone) {
                case 'hand':
                    return [
                        { label: '登场', value: 'playToFront' },
                        { label: '发动', value: 'activateToBack' },
                        { label: '支付', value: 'payToCost' },
                        { label: '进墓', value: 'discard' },
                        { label: '翻盖', value: 'setFaceDown' },
                        { label: '回库', value: 'returnToDeck' },
                        { label: '装备', value: 'equipCard' },
                        { label: '放逐', value: 'exile' },
                    ];
                case 'frontField':
                    return [
                        { label: '切换', value: 'toggleActive' },
                        { label: '回手', value: 'returnToHand' },
                        { label: '进墓', value: 'discard' },
                        { label: '回库', value: 'returnToDeck' },
                        { label: '翻盖', value: 'toggleFaceDown' },
                        { label: '修改', value: 'modifyStats' },
                        { label: '添加', value: 'addTrait' },
                        { label: '清除', value: 'clearTraits' },
                        { label: '装备', value: 'equipCard' },
                        { label: '放逐', value: 'exile' }
                    ];
                case 'backField':
                    return [
                        { label: '切换', value: 'toggleActive' },
                        { label: '回手', value: 'returnToHand' },
                        { label: '进墓', value: 'discard' },
                        { label: '回库', value: 'returnToDeck' },
                        { label: '翻盖', value: 'toggleFaceDown' },
                        { label: '修改', value: 'modifyStats' },
                        { label: '添加', value: 'addTrait' },
                        { label: '清除', value: 'clearTraits' },
                        { label: '装备', value: 'equipCard' },
                        { label: '放逐', value: 'exile' }
                    ];
                case 'costZone':
                    return [
                        { label: '切换', value: 'toggleActive' },
                        { label: '回手', value: 'returnToHand' },
                        { label: '进墓', value: 'discard' },
                        { label: '回库', value: 'returnToDeck' },
                        { label: '添加', value: 'addTrait' },
                        { label: '清除', value: 'clearTraits' },
                        { label: '放逐', value: 'exile' }
                    ];
                case 'mainDeck':
                    return [
                        { label: '抽牌', value: 'drawCard', keepOpen: true },
                        { label: '公开', value: 'publicReveal', keepOpen: true },
                        { label: '检索', value: 'searchMainDeck' },
                        { label: '洗切', value: 'shuffleDeck' }
                    ];
                case 'costDeck':
                    return [
                        { label: '抽牌', value: 'drawCostCard', keepOpen: true },
                        { label: '检索', value: 'searchCostDeck' },
                        { label: '洗切', value: 'shuffleCostDeck' }
                    ];
                case 'legendDeck':
                    return [
                        { label: '抽牌', value: 'drawLegendCard', keepOpen: true },
                        { label: '检索', value: 'searchLegendDeck' },
                        { label: '洗切', value: 'shuffleLegendDeck' }
                    ];
                case 'graveyard':
                    return [
                        { label: '查阅', value: 'viewGraveyard' },
                        { label: '回手', value: 'returnToHand' },
                        { label: '检索', value: 'searchCostDeck' },
                        { label: '登场', value: 'playToFront' },
                        { label: '发动', value: 'activateToBack' },
                        { label: '装备', value: 'equipCard' },
                        { label: '回库', value: 'returnToDeck' }
                    ];
                case 'exile':
                    return [
                        { label: '查阅', value: 'viewExile' },
                        { label: '回手', value: 'returnToHand' },
                        { label: '检索', value: 'searchCostDeck' },
                        { label: '登场', value: 'playToFront' },
                        { label: '发动', value: 'activateToBack' },
                        { label: '装备', value: 'equipCard' },
                        { label: '回库', value: 'returnToDeck' }
                    ];
                case 'personalZone':
                    return [
                        { label: '回手', value: 'returnToHand' },
                        { label: '回主牌库顶', value: 'returnToMainDeckTop' },
                        { label: '回主牌库底', value: 'returnToMainDeckBottom' }
                    ];
                case 'publicField':
                    return [
                        { label: '回手', value: 'returnToHand' },
                        { label: '回主牌库顶', value: 'returnToMainDeckTop' },
                        { label: '回主牌库底', value: 'returnToMainDeckBottom' }
                    ];
                default:
                    return [];
            }
        }
    };

    global.ContextMenu = ContextMenu;
})(window);