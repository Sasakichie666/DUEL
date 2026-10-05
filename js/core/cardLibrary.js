// js/core/cardLibrary.js
// 卡牌库中间层：管理所有卡牌数据，支持从 cardPacks/ 目录自动加载 JSON 卡包

(function(global) {
    const cards = new Map();
    const loadedPacks = new Map();   // 已加载卡包：file → { file, name, count }（卡组管理器按卡包筛选用）
    let packsState = 'idle';         // 'idle' | 'loading' | 'ready' —— 卡包是否【加载完】
                                     // （★★ UI 靠它区分"还没加载出来"与"真的已不存在"，避免开局误报 ✓）
    let idCounter = 0;

    /**
     * 规范化 manifest 里的卡包条目 —— 同时兼容两种写法：
     *   "custom_cards.json"                               旧格式 → { file, name: 'custom_cards' }（名字回退文件名）
     *   { file: 'custom_cards004.json', name: '黎明启示' }  新格式 → 原样（name 缺失时同样回退文件名）
     */
    function normalizePackEntry(entry) {
        if (!entry) return null;
        if (typeof entry === 'string') {
            return { file: entry, name: entry.replace(/\.json$/i, '') };
        }
        if (typeof entry === 'object' && entry.file) {
            const name = String(entry.name == null ? '' : entry.name).trim();
            return { file: entry.file, name: name || String(entry.file).replace(/\.json$/i, '') };
        }
        return null;
    }

    /** 已加载的卡包列表（卡组管理器的「按卡包筛选」用它） */
    function getLoadedPacks() {
        return Array.from(loadedPacks.values());
    }

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
    /**
     * 收集卡包清单（三种来源合并去重）—— 目标：把 JSON 丢进 cardPacks/ 就能被识别 ✓
     *   ① 本地服务 API：GET api/packs（用 tools/serve.js 启动时可用）→ 免 manifest，任意文件名都能发现 ✓
     *   ② manifest.json：显式登记的卡包（兼容旧数据；普通静态服务器靠它）✓
     *   ③ 命名约定探测：custom_cards.json / custom_cards001.json …（静态服务器下的兜底）✓
     * 三种都拿不到就返回空数组，不报错 ✓
     */
    async function collectPackList() {
        const merged = [];
        const seen = new Set();
        const push = (file, name) => {
            if (!file || seen.has(file)) return;
            seen.add(file);
            merged.push({ file: file, name: name || '' });
        };

        // ① 本地服务 API（有它就不需要 manifest，也不做无意义的探测）
        const apiList = await fetchPackListFromApi();
        if (apiList) {
            apiList.forEach(item => { if (item && item.file) push(item.file, item.name); });
            console.log(`[CardLibrary] 本地服务提供了 ${apiList.length} 个卡包（无需 manifest）`);
        }

        // ② manifest.json（读不到就跳过）
        try {
            const res = await fetch('cardPacks/manifest.json', { cache: 'no-store' });
            if (res.ok) {
                const manifest = await res.json();
                const list = (manifest && Array.isArray(manifest.packs)) ? manifest.packs : [];
                list.forEach(raw => {
                    const entry = normalizePackEntry(raw);
                    if (entry) push(entry.file, entry.name);
                    else console.warn('[CardLibrary] 无法识别的卡包条目，已跳过:', raw);
                });
            }
        } catch (e) { /* 没有 manifest 也照样能用 */ }

        // ③ 命名约定探测（没有 API 时的兜底：能发现"没写进 manifest"的常规命名卡包）
        if (!apiList) {
            const probed = await probeConventionalPacks();
            probed.forEach(file => push(file));
        }

        return merged;
    }

    /** 向本地服务要卡包清单（tools/serve.js）；不可用返回 null */
    async function fetchPackListFromApi() {
        for (const url of ['api/packs', '/api/packs']) {
            try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) continue;
                const data = await res.json();
                if (data && Array.isArray(data.packs)) return data.packs;
            } catch (e) { /* 换下一个地址试 */ }
        }
        return null;
    }

    /** 静态服务器兜底：按命名约定探测已存在的卡包文件 */
    async function probeConventionalPacks() {
        const candidates = ['custom_cards.json'];
        for (let i = 1; i <= 40; i++) candidates.push('custom_cards' + String(i).padStart(3, '0') + '.json');

        const found = [];
        for (const file of candidates) {
            try {
                const res = await fetch(`cardPacks/${file}`, { method: 'HEAD', cache: 'no-store' });
                if (res.ok) found.push(file);
            } catch (e) { /* 不存在就跳过 */ }
        }
        if (found.length) console.log(`[CardLibrary] 按命名约定探测到 ${found.length} 个卡包`);
        return found;
    }

    /** 卡包是否已经加载完（UI 用来区分"加载中"与"真的缺失" ✓） */
    function arePacksReady() { return packsState === 'ready'; }

    async function loadCardPacks() {
        packsState = 'loading';
        try {
            const packList = await collectPackList();
            if (packList.length === 0) {
                console.warn('[CardLibrary] 没有发现任何卡包（cardPacks/ 为空，或清单读取失败）');
                return;
            }

            // 重新加载前先移除「上次从卡包加载进来的卡」（内置卡不动）——这样改过卡包内容也能生效 ✓
            const staleIds = [];
            cards.forEach((card, id) => { if (card && card._pack) staleIds.push(id); });
            staleIds.forEach(id => cards.delete(id));
            loadedPacks.clear();

            for (const pack of packList) {
                try {
                    const packRes = await fetch(`cardPacks/${pack.file}`);
                    if (!packRes.ok) {
                        console.warn(`[CardLibrary] 卡包 ${pack.file} 加载失败`);
                        continue;
                    }
                    const parsed = await packRes.json();

                    // 兼容两种卡包格式：["卡1","卡2"]  或  { name: '黎明启示', cards: [...] }
                    const packCards = Array.isArray(parsed) ? parsed
                        : (parsed && Array.isArray(parsed.cards) ? parsed.cards : []);
                    const innerName = (parsed && !Array.isArray(parsed) && typeof parsed.name === 'string')
                        ? parsed.name.trim() : '';
                    // 名字优先级：卡包文件自带的 name > manifest 里写的 name > 文件名
                    const packName = innerName || pack.name || pack.file.replace(/\.json$/i, '');

                    if (packCards.length === 0) {
                        console.warn(`[CardLibrary] 卡包 ${pack.file} 里没有卡牌，已跳过`);
                        continue;
                    }

                    packCards.forEach(card => {
                        card.isCustom = true;
                        // ★记录来源卡包：卡组管理器要按「黎明启示」这样的卡包名筛选
                        card._pack = { file: pack.file, name: packName };
                        registerCard(card);
                    });
                    loadedPacks.set(pack.file, { file: pack.file, name: packName, count: packCards.length });
                    console.log(`[CardLibrary] 已加载卡包 ${pack.file}（${packName}），共 ${packCards.length} 张卡牌`);
                } catch (e) {
                    console.warn(`[CardLibrary] 解析卡包 ${pack.file} 失败`, e);
                }
            }

            // 加载完成后刷新卡牌库显示（带筛选状态；卡包下拉也要重建）
            if (global.DeckBuilderUI && global.DeckBuilderUI.refreshLibrary) {
                global.DeckBuilderUI.refreshLibrary();
            } else if (global.UI && global.UI.renderCardLibrary) {
                global.UI.renderCardLibrary();
            }
            // 刷新卡组槽位，避免自定义卡牌因异步加载未显示
            if (global.DeckBuilderUI && global.DeckBuilderUI.renderDeckSlots) {
                global.DeckBuilderUI.renderDeckSlots();
            }

        } catch (e) {
            console.warn('[CardLibrary] 加载卡包清单失败', e);
        } finally {
            // ★无论成败都算"已经尝试完"：这之后 UI 才允许提示"卡牌不在卡包中" ✓
            packsState = 'ready';
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
        loadCardPacks,
        arePacksReady,
        // 卡包（需求2）：已加载卡包列表 + manifest 条目规范化（两种格式兼容）
        getLoadedPacks,
        normalizePackEntry
    };
})(window);