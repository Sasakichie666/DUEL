// js/core/responsePrefs.js
// 响应时点「忽略清单」（玩家本地偏好，新增）
//
// 语义（就是侧栏「响应」按钮里勾选的那些）：
//   勾选某时点 = 【对方】发动该时点时我方不再被询问，直接略过并进入处理阶段 ✓
//   · 只管"对方的时点"：我方自己发起的动作、我方响应之后由对方决策的窗口，都不受影响 ✓
//   · 两台机器各自独立（这是本地偏好，不参与联机同步 ✓）
//
// 存储：localStorage —— 刷新页面后仍然记得，避免每局都要重勾 ✓
// 谁是"权威"：ChainManager 读这里决定是否自动略过；UI（侧栏「响应」）只负责勾选 ✓

(function(global) {
    const STORAGE_KEY = 'responseIgnoreTimePoints';

    let ignored = new Set();      // 已勾选忽略的时点 key（如 'MINION_ENTER'）
    let listeners = [];

    /** 读取本地存档（数据损坏就当没设置过，绝不影响启动 ✓） */
    function load() {
        try {
            const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                ignored = new Set(arr.filter(k => typeof k === 'string' && k));
            }
        } catch (e) {
            ignored = new Set();
        }
    }

    function save() {
        try {
            if (global.localStorage) {
                global.localStorage.setItem(STORAGE_KEY, JSON.stringify(list()));
            }
        } catch (e) { /* 隐私模式等写不进去也不影响本次使用 ✓ */ }
    }

    function notify() {
        listeners.slice().forEach(fn => {
            try { fn(list()); } catch (e) { console.error('[ResponsePrefs] 订阅者异常（已忽略）', e); }
        });
    }

    /* ================= 查询 ================= */

    function isIgnored(key) {
        return !!key && ignored.has(key);
    }

    function list() {
        return Array.from(ignored);
    }

    /* ================= 修改 ================= */

    function setIgnored(key, value) {
        if (!key) return false;
        const before = ignored.has(key);
        if (value) ignored.add(key); else ignored.delete(key);
        const after = ignored.has(key);
        if (before !== after) {           // 只有真的变了才存档 + 通知（避免无意义刷屏 ✓）
            save();
            notify();
        }
        return after;
    }

    function toggle(key) {
        return setIgnored(key, !ignored.has(key));
    }

    /** 清空所有忽略（返回是否真的清掉了东西 ✓） */
    function clear() {
        if (!ignored.size) return false;
        ignored = new Set();
        save();
        notify();
        return true;
    }

    /**
     * 所有响应时点 + 当前勾选状态（侧栏「响应」面板直接渲染这个 ✓）
     * @returns {Array<{key,label,icon,ignored,ignorable}>}
     *   ignorable === false 的时点（如「阻挡宣言」是响应方自己发起的）不给勾选 ✓
     */
    function all() {
        const R = global.ChainRules;
        if (!R || !R.TIME_POINTS) return [];
        return Object.keys(R.TIME_POINTS).map(key => {
            const rule = R.get(key) || {};
            return {
                key,
                label: rule.label || key,
                icon: rule.icon || '•',
                ignored: ignored.has(key),
                ignorable: rule.ignorable !== false
            };
        });
    }

    function subscribe(fn) {
        if (typeof fn !== 'function') return function() {};
        listeners.push(fn);
        return function unsub() {
            const i = listeners.indexOf(fn);
            if (i !== -1) listeners.splice(i, 1);
        };
    }

    load();

    global.ResponsePrefs = {
        STORAGE_KEY,
        isIgnored,
        list,
        setIgnored,
        toggle,
        clear,
        all,
        subscribe
    };
})(window);
