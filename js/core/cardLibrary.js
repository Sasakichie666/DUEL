// js/core/cardLibrary.js
// 卡牌库中间层：管理所有卡牌数据，支持从 cardPacks/ 目录自动加载 JSON 卡包

(function(global) {
    const cards = new Map();
    let idCounter = 0;

    /**
     * 生成唯一卡牌ID（内部使用）
     */
    function generateCardId(type) {
        idCounter++;
        return `${type}_${Date.now()}_${idCounter}`;
    }

    /**
     * 校验卡牌数据是否符合模板
     */
    function validateCard(cardData) {
        const errors = [];
        if (!cardData || typeof cardData !== 'object') {
            return { valid: false, errors: ['卡牌数据不能为空'] };
        }

        // 名称必填
        if (!cardData.name || !cardData.name.trim()) {
            errors.push('卡牌名称不能为空');
        }

        // 类型校验
        if (!['minion', 'tactic', 'cost'].includes(cardData.type)) {
            errors.push('卡牌类型无效');
        }

        switch (cardData.type) {
            case 'minion':
                if (cardData.attack === undefined || isNaN(cardData.attack)) {
                    errors.push('随从卡必须设置攻击力');
                } else if (cardData.attack < 0 || cardData.attack > 999) {
                    errors.push('攻击力必须在 0~999 之间');
                }
                if (cardData.defense === undefined || isNaN(cardData.defense)) {
                    errors.push('随从卡必须设置防御力');
                } else if (cardData.defense < 0 || cardData.defense > 999) {
                    errors.push('防御力必须在 0~999 之间');
                }
                if (cardData.cost === undefined || isNaN(cardData.cost)) {
                    errors.push('随从卡必须设置费用');
                } else if (cardData.cost < 0 || cardData.cost > 999) {
                    errors.push('费用必须在 0~999 之间');
                }
                break;
            case 'tactic':
                if (cardData.cost === undefined || isNaN(cardData.cost)) {
                    errors.push('战术卡必须设置费用');
                } else if (cardData.cost < 0 || cardData.cost > 999) {
                    errors.push('费用必须在 0~999 之间');
                }
                if (!cardData.effectText || !cardData.effectText.trim()) {
                    errors.push('战术卡必须填写效果文本');
                }
                break;
            case 'cost':
                if (!['red', 'blue', 'green', 'white', 'purple', 'yellow', 'cyan'].includes(cardData.color)) {
                    errors.push('费用卡必须选择有效颜色（红/蓝/绿/白/紫/黄/青）');
                }
                break;
            default:
                errors.push('未知卡牌类型');
        }

        // 原生词条校验（放宽：允许未定义的词条，仅警告而不阻止注册）
        if (cardData.nativeTraits && Array.isArray(cardData.nativeTraits)) {
            cardData.nativeTraits.forEach(traitName => {
                if (!global.TraitLibrary || !global.TraitLibrary.hasTrait(traitName)) {
                    // 仅记录警告，不阻止卡牌注册
                    console.warn(`[CardLibrary] 卡牌「${cardData.name}」包含未定义词条「${traitName}」，详情中将不会显示描述`);
                }
            });
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * 注册卡牌（可传自定义 ID）
     */
    function registerCard(cardData) {
        if (!cardData.id) {
            cardData.id = generateCardId(cardData.type || 'card');
        }

        if (cards.has(cardData.id)) {
            // 已存在则直接返回成功（幂等）
            return { success: true, id: cardData.id };
        }

        const validation = validateCard(cardData);
        if (!validation.valid) {
            return { success: false, errors: validation.errors };
        }

        cards.set(cardData.id, JSON.parse(JSON.stringify(cardData)));
        return { success: true, id: cardData.id };
    }

    /**
     * 根据ID获取卡牌
     */
    function getCardById(id) {
        return cards.get(id) || null;
    }

    /**
     * 获取指定类型的所有卡牌
     */
    function getCardsByType(type) {
        return Array.from(cards.values()).filter(card => card.type === type);
    }

    /**
     * 获取所有卡牌
     */
    function getAllCards() {
        return Array.from(cards.values());
    }

    /**
     * 更新卡牌
     */
    function updateCard(id, newData) {
        if (!cards.has(id)) {
            return { success: false, errors: ['卡牌不存在'] };
        }
        const merged = { ...cards.get(id), ...newData, id };
        const validation = validateCard(merged);
        if (!validation.valid) {
            return { success: false, errors: validation.errors };
        }
        cards.set(id, merged);
        return { success: true };
    }

    /**
     * 删除卡牌
     */
    function removeCard(id) {
        return cards.delete(id);
    }

    /**
     * 批量导入卡牌（用于卡包加载）
     */
    function importCards(cardsArray) {
        let imported = 0;
        const errors = [];
        cardsArray.forEach(cardData => {
            const result = registerCard(cardData);
            if (result.success) {
                imported++;
            } else {
                errors.push(result.errors);
            }
        });
        return { success: errors.length === 0, imported, errors };
    }

    /**
     * 从 cardPacks/ 目录加载卡包（通过 manifest.json）
     */
    async function loadCardPacks() {
        try {
            const manifestRes = await fetch('cardPacks/manifest.json');
            if (!manifestRes.ok) {
                console.warn('[CardLibrary] 未找到 cardPacks/manifest.json，跳过卡包加载');
                return;
            }
            const manifest = await manifestRes.json();
            if (!manifest.packs || !Array.isArray(manifest.packs)) {
                console.warn('[CardLibrary] manifest.json 格式错误');
                return;
            }

            for (const packFile of manifest.packs) {
                try {
                    const packRes = await fetch(`cardPacks/${packFile}`);
                    if (!packRes.ok) {
                        console.warn(`[CardLibrary] 卡包 ${packFile} 加载失败`);
                        continue;
                    }
                    const cards = await packRes.json();
                    if (Array.isArray(cards)) {
                        cards.forEach(card => {
                            card.isCustom = true;
                            registerCard(card);
                        });
                        console.log(`[CardLibrary] 已加载卡包 ${packFile}，共 ${cards.length} 张卡牌`);
                    }
                } catch (e) {
                    console.warn(`[CardLibrary] 解析卡包 ${packFile} 失败`, e);
                }
            }

            // 加载完成后刷新卡牌库显示
            if (global.UI && global.UI.renderCardLibrary) {
                global.UI.renderCardLibrary();
            }
            // 刷新卡组槽位，避免自定义卡牌因异步加载未显示
            if (global.DeckBuilderUI && global.DeckBuilderUI.renderDeckSlots) {
                global.DeckBuilderUI.renderDeckSlots();
            }

        } catch (e) {
            console.warn('[CardLibrary] 加载卡包清单失败', e);
        }
    }

    // 导出
    global.CardLibrary = {
        registerCard,
        getCardById,
        getCardsByType,
        getAllCards,
        updateCard,
        removeCard,
        importCards,
        validateCard,
        generateCardId,
        loadCardPacks
    };
})(window);