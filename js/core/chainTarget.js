// js/core/chainTarget.js
// 响应连锁「目标」统一模块 —— 目标语义 + DOM 锚点解析的【唯一事实来源】。
//
// 为什么要单独一层：
//   目标相关的知识（怎么规范化、怎么镜像、怎么在 DOM 里找到那张牌/头像）原本散在
//   chainManager / chainPanelUI / chainArrows / targetSelector 四个文件里各写一套，
//   容易出现"改了这边忘了那边"的不一致。现在全部收敛到这里：
//
//     语义层 :  normalize / flip / keyOf        （谁都能用，纯数据）
//     现场层 :  sideOfElement / fromElement     （点击时从 e.target 解析，不缓存）
//     锚点层 :  sourceSelectors / targetSelectors（多候选，从精确到宽松）
//     解析层 :  queryFirst / resolveTarget / resolveSource / resolveByKey
//
// 目标对象约定： { type:'card'|'avatar', side:'self'|'opponent', instanceId?, key }
//   side 一律按"本端视角"存储（self = 我），跨端发送时整体镜像一次。

(function(global) {

    /* ================= 语义层 ================= */

    function flipSide(side) { return side === 'self' ? 'opponent' : 'self'; }
    function sideLabel(side) { return side === 'self' ? '我方' : '对方'; }

    /** 规范化目标（并补上唯一 key） */
    function normalize(raw) {
        if (!raw) return null;
        const side = raw.side === 'opponent' ? 'opponent' : 'self';
        if (raw.type === 'avatar') return { type: 'avatar', side, key: 'avatar:' + side };
        if (raw.type === 'card' && raw.instanceId) {
            return { type: 'card', instanceId: raw.instanceId, side, key: 'card:' + raw.instanceId };
        }
        return null;
    }

    function normalizeList(list) {
        return (Array.isArray(list) ? list : []).map(normalize).filter(Boolean);
    }

    /** 镜像目标（发送 / 接收时用） */
    function flip(t) {
        if (!t) return null;
        const side = flipSide(t.side);
        return t.type === 'avatar'
            ? { type: 'avatar', side, key: 'avatar:' + side }
            : { type: 'card', instanceId: t.instanceId, side, key: 'card:' + t.instanceId };
    }

    function keyOf(t) { return t ? t.key : null; }

    /** 人类可读的目标名（优先读 DOM 上的卡名） */
    function label(t) {
        if (!t) return '';
        if (t.type === 'avatar') return sideLabel(t.side) + '头像';
        const el = queryFirst(cardSelectors(t.instanceId));
        const nameEl = el && el.querySelector ? el.querySelector('.card-name') : null;
        if (nameEl && nameEl.textContent) return nameEl.textContent.trim();
        return sideLabel(t.side) + '卡牌';
    }

    /* ================= 现场层（点击时解析，绝不缓存引用） ================= */

    function sideOfElement(el) {
        return el && el.closest && el.closest('.half.self-half') ? 'self' : 'opponent';
    }

    /** 被点击/悬停的元素 → 目标对象 */
    function fromElement(el) {
        if (!el || !el.closest) return null;
        const cardEl = el.closest('.card-full');
        if (cardEl && cardEl.dataset && cardEl.dataset.instanceId) {
            return normalize({ type: 'card', instanceId: cardEl.dataset.instanceId, side: sideOfElement(cardEl) });
        }
        const avatarEl = el.closest('.pc-avatar');
        if (avatarEl) return normalize({ type: 'avatar', side: sideOfElement(avatarEl) });
        return null;
    }

    /* ================= 锚点层（多候选选择器：从精确到宽松） ================= */

    function cardSelectors(instanceId) {
        const id = instanceId;
        return [
            `#view-battle .card-full[data-instance-id="${id}"]:not(.detail-card)`,   // 真实战场优先
            `.battle-table .card-full[data-instance-id="${id}"]:not(.detail-card)`,
            `.card-full[data-instance-id="${id}"]:not(.detail-card)`,
            `[data-instance-id="${id}"]:not(.detail-card)`                            // 手牌 / 费用 / 牌库等
        ];
    }

    /** 箭头【起点】：面板里"该序列"的卡面详情 */
    function sourceSelectors(seq) {
        return [
            `.chain-link[data-seq="${seq}"] .chain-card`,
            `.chain-link[data-seq="${seq}"] .card-full`,
            `.chain-link[data-seq="${seq}"]`,
            '.chain-panel'
        ];
    }

    /**
     * 箭头【终点】：战场上的那张卡 / 头像。
     * 找不到具体元素时按"该方前场行 → 该方半场"兜底
     * （前场行与卡牌同一条高度带，两端落点观感一致；正常情况下不会用到）。
     */
    function targetSelectors(t) {
        if (!t) return [];
        const side = t.side === 'self' ? 'self' : 'opponent';
        const half = `.half.${side}-half`;
        if (t.type === 'avatar') {
            return [
                `${half} .pc-avatar`,
                `.${side}-half .pc-avatar`,
                `${half} .half-info .pc-avatar`,
                '.pc-avatar',
                half
            ];
        }
        return cardSelectors(t.instanceId).concat([
            `${half} .field-row.front`,
            `${half} .field-row`,
            half
        ]);
    }



    /* ================= 解析层 ================= */

    /** 元素是否可见（隐藏元素 rect 为 0，不能当锚点，否则箭头会画到屏幕角落） */
    function visible(el) {
        if (!el) return false;
        if (typeof el.getBoundingClientRect !== 'function') return true;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    /**
     * 按候选顺序查元素：
     * 优先返回【可见】的元素；全不可见时才退回第一个命中的（尽量让箭头画得出来）。
     */
    function queryFirst(selectors) {
        let firstFound = null;
        const list = selectors || [];
        for (let i = 0; i < list.length; i++) {
            const sel = list[i];
            if (!sel) continue;
            let hit = null;
            try { hit = document.querySelector(sel); } catch (e) { hit = null; }
            if (!hit) continue;
            if (!firstFound) firstFound = hit;
            if (visible(hit)) return hit;
        }
        return firstFound;
    }

    function resolveSource(seq) { return queryFirst(sourceSelectors(seq)); }
    function resolveTarget(t) { return queryFirst(targetSelectors(t)); }

    /** 按 key 找元素（高亮"已选中"用） */
    function resolveByKey(key) {
        if (!key) return null;
        if (key.indexOf('avatar:') === 0) return resolveTarget({ type: 'avatar', side: key.slice(7) });
        if (key.indexOf('card:') === 0) return resolveTarget({ type: 'card', instanceId: key.slice(5), side: 'self' });
        return null;
    }

    /** 本端 DOM 里现有的卡牌 instanceId（诊断用） */
    function localCardIds() {
        const ids = [];
        try {
            document.querySelectorAll('.card-full[data-instance-id]').forEach(el => {
                const v = el.getAttribute && el.getAttribute('data-instance-id');
                if (v) ids.push(v);
            });
        } catch (e) { /* 忽略 */ }
        return ids;
    }

    /** 元素简述（调试日志用） */
    function describe(el) {
        if (!el) return '(未找到)';
        const tag = String(el.tagName || '?').toLowerCase();
        let cls = '';
        try { cls = (el.getAttribute ? (el.getAttribute('class') || '') : '') || ''; } catch (e) { cls = ''; }
        const r = el.getBoundingClientRect();
        return `${tag}.${String(cls).trim().split(/\s+/).join('.')}`
            + ` rect=(${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)})`;
    }

    global.ChainTarget = {
        // 语义
        flipSide, sideLabel, normalize, normalizeList, flip, keyOf, label,
        // 现场
        sideOfElement, fromElement,
        // 锚点
        sourceSelectors, targetSelectors, cardSelectors,
        // 解析
        visible, queryFirst, resolveSource, resolveTarget, resolveByKey, localCardIds, describe
    };
})(window);
