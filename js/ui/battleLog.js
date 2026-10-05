// js/ui/battleLog.js
// 对局日志：本地记录 + 联机双向同步（同一条日志里既能看到自己的行动，也能看到对手的行动）
// 设计原则：
//   1) 无侵入 —— 所有调用点通过 BattleLog.log(text, type)，DOM 不存在时静默忽略
//   2) 文案视角无关 —— 调用点只写「生命 -5」「「火球」进墓」这类描述，
//      「你 / 对手」的前缀由渲染层根据 type 自动加（这样才能安全地转发给对手）

(function(global) {
    const MAX_ENTRIES = 150;

    let listEl = null;
    let entries = [];
    let relayEnabled = false;   // 开局后才允许转发（避免大厅阶段的噪音）

    const TYPE_LABEL = {
        self: '你',
        opponent: '对手',
        turn: '回合',
        system: '系统'
    };

    function ensureEl() {
        if (!listEl || !document.body.contains(listEl)) {
            listEl = document.getElementById('battleLogList');
        }
        return listEl;
    }

    function timestamp() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"]/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;'
        }[c]));
    }

    // 只转发「玩家动作」；回合/系统提示各端自行生成，避免重复刷屏
    function shouldRelay(type) {
        return type === 'self';
    }

    function relay(text) {
        if (!relayEnabled) return;
        const Network = global.Network;
        if (!Network || typeof Network.getState !== 'function') return;
        const st = Network.getState();
        if (!st || !st.isConnected) return;
        Network.sendMessage(JSON.stringify({ type: 'battle_log', text: String(text) }));
    }

    function push(text, type) {
        entries.push({ text: String(text), type, time: timestamp() });
        if (entries.length > MAX_ENTRIES) entries.shift();
        render();
    }

    /**
     * 追加一条本地日志
     * @param {string} text - 视角无关的描述，例如「生命 -5」「「火球」进墓」
     * @param {string} type - 'self' | 'opponent' | 'turn' | 'system'
     */
    function log(text, type = 'system') {
        if (!text) return;
        push(text, type);
        if (shouldRelay(type)) relay(text);
    }

    /**
     * 收到对手同步过来的日志：显示为「对手」条目，且不再回传（避免回环）
     */
    function logRemote(text) {
        if (!text) return;
        push(text, 'opponent');
    }

    /**
     * 便捷方法（兼容旧接口）：以某个玩家视角记录
     */
    function logFor(player, text) {
        if (player === 'self' || player === 'opponent') {
            log(text, player);
        } else {
            log(text, 'system');
        }
        return TYPE_LABEL[player] || '';
    }

    function render() {
        const el = ensureEl();
        if (!el) return;
        if (entries.length === 0) {
            el.innerHTML = '<div class="battle-log-empty">暂无记录</div>';
            return;
        }
        // 按时间顺序排列：最早的在最上面，最新的追加在最下面
        const html = entries
            .slice()
            .map(e => {
                const label = TYPE_LABEL[e.type] || '系统';
                return `<div class="battle-log-item log-${e.type}">`
                    + `<span class="log-time">${e.time}</span>`
                    + `<span class="log-actor">${label}</span>`
                    + `<span class="log-text">${escapeHtml(e.text)}</span>`
                    + `</div>`;
            })
            .join('');
        el.innerHTML = html;
        scrollToBottom();   // 自动定位到最新一条
    }

    /**
     * 滚动到最底部（面板刚展开时也要调用）
     * 立即滚一次 + 下一帧再滚一次：面板从 display:none 切到显示时，
     * 首次读取的 scrollHeight 可能还是 0，补一帧即可拿到真实高度。
     */
    function scrollToBottom() {
        const el = ensureEl();
        if (!el) return;
        const doScroll = () => { el.scrollTop = el.scrollHeight; };
        doScroll();
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(doScroll);
    }

    function clear() {
        entries = [];
        render();
    }

    function init() {
        listEl = document.getElementById('battleLogList');
        render();
    }

    function setRelayEnabled(enabled) {
        relayEnabled = !!enabled;
    }

    global.BattleLog = {
        init,
        log,
        logRemote,
        logFor,
        clear,
        scrollToBottom,
        setRelayEnabled,
        getEntries: () => entries.slice()
    };
})(window);

