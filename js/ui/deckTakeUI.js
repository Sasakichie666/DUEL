// js/ui/deckTakeUI.js
// 牌库取牌界面（检索 / 翻阅 共用的唯一实现）
//
// 为什么能共用：检索与翻阅本质是同一条流水线 ——
//   「取牌范围 → 检索式面板 → 选落点取走 → 告知对方」
// 差异只有两处，且全部收口在本文件的两张配置里：
//   ① 牌面范围：检索 = 整个牌库          / 翻阅 = 牌库顶 N 张
//   ② 取牌之后：检索 = 洗切 + 弹"检索告知" / 翻阅 = 不洗切 + 告知"翻到了这张"
// 其余（落点动作、面板外观、刷新时机、关闭回调）完全一致 ✓
//
// 对外（MenuAction 只调这几行，业务细节都在这里 ✓）：
//   DeckTakeUI.init()             订阅会话 → 驱动我方翻阅面板（打开 / 原地刷新 / 收起）
//   DeckTakeUI.openSearch(zone)   打开检索面板
//   DeckTakeUI.openPeek(zone, n)  打开翻阅面板（顶 n 张）
//   DeckTakeUI.ACTIONS            取牌落点表（供其它界面复用 ✓）

(function(global) {
    /** 取牌落点：检索与翻阅一模一样 ✓ */
    const ACTIONS = [
        { value: 'hand', label: '加入手牌' },
        { value: 'frontField', label: '放前场' },
        { value: 'backField', label: '放后场' },
        { value: 'graveyard', label: '送墓' },
        { value: 'exile', label: '放逐' }
    ];

    const DECK_LABEL = {
        mainDeck: '主牌库', costDeck: '费用牌库', legendDeck: '传说牌库',
        graveyard: '墓场', exile: '放逐区'
    };

    /**
     * ★三种模式 = 同一条流水线的三组配置（差异只有这两列 ✓）
     *   source   ：deck=整个牌库 / top=牌库顶 N 张 / zone=墓场·放逐区
     *   announce ：是否先告诉对方"我正在行动"（查阅=否 → 仅查阅纯私下 ✓）
     *   shuffle  ：取牌后洗不洗（只有检索洗 ✓）
     *   notify   ：取牌后对方看到什么（那张牌 / 翻到了这张 / 查阅了这张 ✓）
     */
    const MODES = {
        search: {
            icon: '🔎', source: 'deck', announce: 'search', notify: 'search', shuffle: true,
            title: zone => `${zoneLabel(zone)}检索`,
            hint: '检索后自动洗切牌库'
        },
        peek: {
            icon: '🃏', source: 'top', announce: 'peek', notify: 'peek', shuffle: false,
            title: (zone, n) => `${zoneLabel(zone)} 翻阅（牌库顶 ${n} 张）`,
            hint: '翻阅中：取牌后重算牌库顶 N 张（不洗切牌库）· 未勾选公开时对方只看到牌背'
        },
        browse: {
            icon: '🗂', source: 'zone', announce: null, notify: 'browse', shuffle: false,
            title: zone => `${zoneLabel(zone)}查阅`,
            hint: '查阅：只看也可以直接关闭；一旦取牌，对方会看到是哪一张'
        }
    };

    let activeId = null;      // 本模块当前驱动着的会话 id（换会话必然重开 ✓）
    let unsub = null;

    function rc() { return global.RevealChannel; }
    function viewer() { return global.ViewerUI; }

    function zoneLabel(zone) { return DECK_LABEL[zone] || '牌库'; }

    /** 我方某区域里的卡牌（牌库 / 墓场 / 放逐区 都是普通数组 ✓） */
    function zoneInstances(zone) {
        const GS = global.GameState;
        const st = GS && GS.getState ? GS.getState() : null;
        const arr = st && st.players && st.players.self ? st.players.self[zone] : null;
        return Array.isArray(arr) ? arr : [];
    }

    /** 面板公共配置（三种模式共用 ✓，差异只有 icon / hint） */
    function panelBase(modeKey, zone) {
        const M = MODES[modeKey] || MODES.search;
        return {
            actions: ACTIONS,
            defaultAction: 'hand',
            icon: M.icon,
            hint: M.hint,
            onClose: () => { const R = rc(); if (R) R.close(); }   // 只看不取 → 直接收尾 ✓
        };
    }

    function warn(msg) {
        if (global.UI && global.UI.showNotification) global.UI.showNotification(msg, 'warning');
    }

    /**
     * 取走一张 —— ★三种模式的唯一差异点（洗不洗 + 怎么告知对方）都在这里 ✓
     * @param {string} mode 'search' | 'peek' | 'browse'
     */
    function take(zone, instance, action, mode) {
        const MA = global.MenuAction;
        if (!MA || !MA.takeCardFromDeck) return false;
        const M = MODES[mode] || MODES.search;
        return MA.takeCardFromDeck(zone, instance, action, {
            noShuffle: !M.shuffle,
            notify: M.notify
        });
    }

    /* ================= 检索 / 查阅：静态列表（整库 / 墓场 / 放逐区） ================= */

    function openZonePanel(modeKey, zone) {
        const V = viewer(), R = rc();
        const M = MODES[modeKey];
        if (!V || !R || !M) return false;

        const cards = zoneInstances(zone);
        if (!cards.length) { warn(`${zoneLabel(zone)}是空的`); return false; }

        if (M.announce === 'search') R.startSearch(zone);   // 检索先告知"正在检索" ✓（查阅不告知 ✓）
        activeId = null;                                    // 静态面板不参与"翻阅刷新" ✓
        V.show(
            cards.slice(),
            M.title(zone),
            (inst, action) => take(zone, inst, action, modeKey),
            panelBase(modeKey, zone)
        );
        return true;
    }

    /** 检索：整个牌库（取牌后洗切 + 告知对方"检索了哪张" ✓） */
    function openSearch(zone) { return openZonePanel('search', zone); }

    /** 查阅：墓场 / 放逐区（先不告知 ✓；取牌才弹"查阅了这张" ✓；不洗切 ✓） */
    function openBrowse(zone) { return openZonePanel('browse', zone); }

    /* ================= 翻阅：牌库顶 N 张 ================= */

    function openPeek(zone, count) {
        const R = rc();
        if (!R) return false;
        return R.startPeek(zone, count);              // 会话建好 → onSession 会开面板 ✓
    }

    /** 我方翻阅面板：按会话驱动（打开 / 原地刷新 / 收起 ✓） */
    function onSession(s) {
        const V = viewer(), R = rc();
        if (!V) return;

        const minePeek = !!(s && s.owner === 'self' && s.kind === 'peek' && s.stage === 'open');
        if (!minePeek) {
            if (activeId) { activeId = null; if (V.hide) V.hide(); }
            return;
        }

        const cards = R.myVisibleInstances();
        const title = `${s.note || zoneLabel(s.zone) + ' 翻阅'}（牌库顶 ${s.count} 张）`;
        const reopened = activeId !== s.id || (V.isOpen && !V.isOpen());

        if (reopened) {
            // 新会话（含"第二次翻阅"✓）或面板被关掉 → 重新打开 ✓
            activeId = s.id;
            V.show(cards, title, (inst, action) => take(s.zone, inst, action, 'peek'), Object.assign(
                panelBase('peek', s.zone),
                {
                    controls: [
                        { type: 'checkbox', label: '公开给对手', checked: !!s.revealed, onChange: v => R.setRevealed(v) },
                        { type: 'button', label: '+1 张', onClick: () => R.addCount(1) },
                        { type: 'button', label: '收起', onClick: () => R.close() }
                    ]
                }
            ));
        } else {
            V.update(cards, title, { revealed: !!s.revealed });   // 原地刷新（不重开、不重置筛选 ✓）
        }
    }

    function init() {
        const R = rc();
        if (!R || !R.subscribe) {
            console.warn('[DeckTakeUI] RevealChannel 未加载，取牌界面停用');
            return false;
        }
        if (!unsub) unsub = R.subscribe(onSession);
        return true;
    }

    global.DeckTakeUI = { init, openSearch, openPeek, openBrowse, take, ACTIONS, MODES, zoneLabel };
})(window);
