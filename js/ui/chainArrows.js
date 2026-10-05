// js/ui/chainArrows.js
// 响应连锁「指向箭头」层：全屏 SVG（pointer-events:none），把面板上的卡牌详情
// 与战场上的目标用带曲度的箭头连起来。颜色：战术/效果=蓝，攻击=红，阻挡=黄。
//
// 端点每帧按 getBoundingClientRect 重算 —— 卡片被拖动、手牌扇形变化都能实时跟随。

(function(global) {
    const NS = 'http://www.w3.org/2000/svg';
    const ARROW_COLORS = {
        self:     { stroke: '#5fc9ff', glow: 'rgba(95, 201, 255, 0.45)' },    // 我方发动（青）
        opponent: { stroke: '#ff5f8a', glow: 'rgba(255, 95, 138, 0.45)' },    // 对方发动（品红）
        yellow:   { stroke: '#ffd700', glow: 'rgba(255, 215, 0, 0.45)' },     // 阻挡（黄）
        // 兼容旧调用
        blue:     { stroke: '#5fc9ff', glow: 'rgba(95, 201, 255, 0.45)' },
        red:      { stroke: '#ff5f8a', glow: 'rgba(255, 95, 138, 0.45)' }
    };

    let svg = null;
    let defs = null;
    let group = null;
    let rafId = 0;
    let drawing = [];      // [{ color, fromEl, toEl, opacity }]

    function ensureLayer() {
        if (svg && document.body.contains(svg)) return svg;
        svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('id', 'chainArrowLayer');
        svg.setAttribute('class', 'chain-arrow-layer');
        svg.setAttribute('aria-hidden', 'true');

        defs = document.createElementNS(NS, 'defs');
        Object.keys(ARROW_COLORS).forEach(key => {
            const marker = document.createElementNS(NS, 'marker');
            marker.setAttribute('id', 'chainArrowHead-' + key);
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '8');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerWidth', '7');
            marker.setAttribute('markerHeight', '7');
            marker.setAttribute('orient', 'auto-start-reverse');
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
            path.setAttribute('fill', ARROW_COLORS[key].stroke);
            marker.appendChild(path);
            defs.appendChild(marker);
        });
        svg.appendChild(defs);

        group = document.createElementNS(NS, 'g');
        group.setAttribute('class', 'chain-arrow-group');
        svg.appendChild(group);

        document.body.appendChild(svg);
        sizeLayer();
        window.addEventListener('resize', sizeLayer);
        return svg;
    }

    function sizeLayer() {
        if (!svg) return;
        svg.setAttribute('width', window.innerWidth);
        svg.setAttribute('height', window.innerHeight);
        svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    }

    /** 面板矩形（判断目标是否被右侧面板遮挡） */
    function panelRect() {
        const p = document.getElementById('chainPanel');
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return (r && r.width && r.height) ? r : null;
    }

    /** 点是否在矩形内 */
    function inside(r, x, y) {
        return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    const MIN_LEN = 36;        // 箭头最小长度：保证终点一定落在起点的"正确一侧"

    /**
     * 取箭头端点：
     *  · 方向按"源中心 → 目标中心"的向量决定（横向为主 / 纵向兜底）
     *  · ★关键：终点必须夹到起点的正确一侧（最小长度 MIN_LEN），
     *    否则当目标是"大区域"（半场兜底、跨越面板的元素）时会取到位于起点另一侧的边，
     *    画出来就成了"箭头朝反方向"；
     *  · 目标被右侧面板遮挡时：改走"左侧水平进出"，并把终点夹到面板左缘外侧。
     */
    function endpoints(fromEl, toEl) {
        const a = fromEl.getBoundingClientRect();
        const b = toEl.getBoundingClientRect();
        const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
        const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };

        const pr = panelRect();
        // 目标与面板有重叠且偏在面板一侧 → 视为"被面板遮挡"（含部分遮挡）
        const overlap = !!pr && b.right > pr.left && b.left < pr.right
            && b.bottom > pr.top && b.top < pr.bottom;
        const hidden = overlap && bc.x > pr.left;

        if (hidden) {
            const sx = a.left;
            const rawEx = Math.min(b.left, pr.left - 8);
            return {
                sx,
                sy: ac.y,
                ex: Math.min(rawEx, sx - MIN_LEN),
                ey: bc.y,
                hidden: true
            };
        }

        const dx = bc.x - ac.x;
        const dy = bc.y - ac.y;
        const horiz = Math.abs(dx) >= Math.abs(dy);

        if (horiz) {
            const right = dx >= 0;
            const sx = right ? a.right : a.left;
            const big = b.width > 240;                               // 大区域（半场兜底等）→ 指向其中线更自然
            let ex = big ? bc.x : (right ? b.left : b.right);
            if (right) ex = Math.max(ex, sx + MIN_LEN);
            else ex = Math.min(ex, sx - MIN_LEN);
            if (Math.abs(ex - sx) < MIN_LEN) {                       // 太短 → 指向目标中心（仍保证方向正确）
                ex = right ? Math.max(bc.x, sx + MIN_LEN) : Math.min(bc.x, sx - MIN_LEN);
            }
            return { sx, sy: ac.y, ex, ey: bc.y, hidden: false };
        }

        const down = dy >= 0;
        const sy = down ? a.bottom : a.top;
        const bigV = b.height > 240;
        let ey = bigV ? bc.y : (down ? b.top : b.bottom);
        if (down) ey = Math.max(ey, sy + MIN_LEN);
        else ey = Math.min(ey, sy - MIN_LEN);
        if (Math.abs(ey - sy) < MIN_LEN) {
            ey = down ? Math.max(bc.y, sy + MIN_LEN) : Math.min(bc.y, sy - MIN_LEN);
        }
        return { sx: ac.x, sy, ex: bc.x, ey, hidden: false };
    }

    /** 二次贝塞尔：控制点取"向上"的法线方向 → 弧线向上拱起（贴近参考图观感） */
    function buildPath(sx, sy, ex, ey) {
        const mx = (sx + ex) / 2;
        const my = (sy + ey) / 2;
        const dx = ex - sx;
        const dy = ey - sy;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const bend = Math.min(90, len * 0.18);

        let nx = -dy / len;
        let ny = dx / len;
        if (ny > 0) { nx = -nx; ny = -ny; }        // 统一朝"上方"弯曲

        const cx = mx + nx * bend;
        const cy = my + ny * bend;
        return `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    }
    /**
     * 解析箭头两端：语义数据 ⇒ 元素（每帧重新查，绝不缓存引用）。
     * 锚点的选择策略全部来自 ChainTarget（唯一事实来源）：
     *   fromSeq           → 面板里该序列的卡面
     *   target（目标对象）  → 战场上的那张卡 / 头像（含兜底）
     * 兼容旧写法 fromSelector / fromSelectors / toSelector / toSelectors / fromEl / toEl。
     */
    function resolveEnds(item) {
        const T = global.ChainTarget;
        const usable = el => (el && (!T || T.visible(el)));

        let fromEl = usable(item.fromEl) ? item.fromEl : null;
        let toEl = usable(item.toEl) ? item.toEl : null;

        if (!fromEl && T) {
            fromEl = (item.fromSeq != null)
                ? T.resolveSource(item.fromSeq)
                : T.queryFirst(item.fromSelectors || (item.fromSelector ? [item.fromSelector] : []));
        }
        if (!toEl && T) {
            toEl = item.target
                ? T.resolveTarget(item.target)
                : T.queryFirst(item.toSelectors || (item.toSelector ? [item.toSelector] : []));
        }
        return { fromEl, toEl };
    }

    /** 端点的可读描述（日志 / 诊断用） */
    function endLabel(item, which) {
        const T = global.ChainTarget;
        if (which === 'from') {
            return item.fromSeq != null
                ? `序列${item.fromSeq}卡面`
                : (item.fromSelector || '(未指定)');
        }
        if (item.target) return item.target.key || (item.target.type + ':' + item.target.instanceId);
        return item.toSelector || '(未指定)';
    }

    let warnedSig = '';
    let debugLogSig = '';
    let probeSig = '';

    /** 探针：目标卡是否真的在本端 DOM（缺失时会回退到前场行/半场 → 告警一次） */
    function probeTargets() {
        const T = global.ChainTarget;
        if (!T) return;
        const missingIds = [];
        drawing.forEach(item => {
            const t = item.target;
            if (!t || t.type !== 'card' || !t.instanceId) return;
            if (!T.queryFirst(T.cardSelectors(t.instanceId))) missingIds.push(t.instanceId);
        });
        const sig = missingIds.join(',');
        if (sig === probeSig) return;
        probeSig = sig;
        if (!missingIds.length) return;
        console.warn('[ChainArrows] 目标卡不在本端 DOM：' + JSON.stringify(missingIds)
            + ' → 箭头回退到"该方前场行/半场"。本端现有卡牌：'
            + JSON.stringify(T.localCardIds()));
    }

    /** 重绘所有箭头（每帧调用，跟随卡片位置；端元素每次都重新解析） */
    function paint() {
        if (!group) return;
        while (group.firstChild) group.removeChild(group.firstChild);

        const missing = [];
        const debugPairs = [];
        const T = global.ChainTarget;

        drawing.forEach(item => {
            const ends = resolveEnds(item);
            const fromEl = ends.fromEl;
            const toEl = ends.toEl;
            if (!fromEl || !toEl) {
                missing.push({
                    from: endLabel(item, 'from'),
                    fromFound: !!fromEl,
                    to: endLabel(item, 'to'),
                    toFound: !!toEl,
                    fromCandidates: (item.fromSeq != null && T) ? T.sourceSelectors(item.fromSeq) : null,
                    toCandidates: (item.target && T) ? T.targetSelectors(item.target) : null
                });
                return;
            }
            const ep = endpoints(fromEl, toEl);
            const sx = ep.sx, sy = ep.sy, ex = ep.ex, ey = ep.ey;
            const color = ARROW_COLORS[item.color] || ARROW_COLORS.blue;
            const d = buildPath(sx, sy, ex, ey);

            if (global.CHAIN_DEBUG) {
                const pr = panelRect();
                const desc = el => (T ? T.describe(el) : '(无)');
                debugPairs.push(
                    `箭头#${debugPairs.length + 1}（${item.color}）`
                    + `\n    源: ${endLabel(item, 'from')} → ${desc(fromEl)}`
                    + `\n    目标: ${endLabel(item, 'to')} → ${desc(toEl)}`
                    + `\n    端点: (${Math.round(sx)},${Math.round(sy)}) → (${Math.round(ex)},${Math.round(ey)})`
                    + `  方向=${ex < sx ? '左' : '右'}`
                    + (ep.hidden ? ' [目标被右侧面板遮挡，已夹到面板左缘]' : '')
                    + (pr ? `\n    面板 rect=(${Math.round(pr.left)},${Math.round(pr.top)},${Math.round(pr.width)}x${Math.round(pr.height)})` : '')
                    + `  视口=${window.innerWidth}x${window.innerHeight}`
                );
            }

            const glow = document.createElementNS(NS, 'path');
            glow.setAttribute('d', d);
            glow.setAttribute('class', 'chain-arrow-glow');
            glow.setAttribute('stroke', color.glow);
            glow.setAttribute('fill', 'none');
            glow.setAttribute('stroke-width', '5');
            glow.setAttribute('opacity', String((item.opacity || 1) * 0.5));
            group.appendChild(glow);

            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('class', 'chain-arrow');
            path.setAttribute('stroke', color.stroke);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-width', '1.8');       // 细线，贴近参考图的观感
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('marker-end', `url(#chainArrowHead-${item.color})`);
            path.setAttribute('opacity', String(item.opacity || 1));
            group.appendChild(path);

            if (global.CHAIN_DEBUG) {
                // 调试锚点：起点画实心小圆、终点画空心小方 —— 一眼确认"源/目标"有没有画反
                const dot = document.createElementNS(NS, 'circle');
                dot.setAttribute('cx', String(sx));
                dot.setAttribute('cy', String(sy));
                dot.setAttribute('r', '4');
                dot.setAttribute('fill', color.stroke);
                group.appendChild(dot);

                const box = document.createElementNS(NS, 'rect');
                box.setAttribute('x', String(ex - 6));
                box.setAttribute('y', String(ey - 6));
                box.setAttribute('width', '12');
                box.setAttribute('height', '12');
                box.setAttribute('fill', 'none');
                box.setAttribute('stroke', color.stroke);
                box.setAttribute('stroke-width', '2');
                group.appendChild(box);
            }
        });

        if (global.CHAIN_DEBUG && debugPairs.length) {
            const sig = debugPairs.join('|');
            if (sig !== debugLogSig) {
                debugLogSig = sig;
                console.log('[ChainArrows] 端点解析（源 → 目标）：\n  ' + debugPairs.join('\n  '));
            }
        }

        // 诊断：有箭头因为找不到端点（DOM 里没这张卡）而没画出来 → 只提示一次，避免刷屏
        if (missing.length) {
            const sig = JSON.stringify(missing);
            if (sig !== warnedSig) {
                warnedSig = sig;
                console.warn('[ChainArrows] ' + missing.length + '/' + drawing.length
                    + ' 条箭头未绘制（端点不存在）。明细（可直接复制）：\n' + sig);
            }
        } else if (warnedSig) {
            warnedSig = '';
        }

        probeTargets();          // 目标卡缺失时告警（回退到前场行/半场的情况）
    }

    function loop() {
        rafId = 0;
        if (!drawing.length) return;
        paint();
        rafId = requestAnimationFrame(loop);
    }

    /**
     * 设置当前要绘制的箭头
     * @param {Array} items
     *   推荐（语义化）：[{ color, opacity, fromSeq, target }]
     *   兼容（选择器 / 元素）：[{ color, opacity, fromSelector|fromSelectors|fromEl, toSelector|toSelectors|toEl }]
     *   锚点每帧重新解析 —— 战场被重建、卡牌被拖动都能自动跟随。
     */
    function setArrows(items) {
        drawing = (Array.isArray(items) ? items : []).filter(it => it
            && (it.fromEl || it.fromSeq != null || it.fromSelector || it.fromSelectors)
            && (it.toEl || it.target || it.toSelector || it.toSelectors));
        if (!drawing.length) {
            clear();
            return;
        }
        ensureLayer();
        sizeLayer();
        paint();
        if (!rafId) rafId = requestAnimationFrame(loop);
    }

    function clear() {
        drawing = [];
        if (group) while (group.firstChild) group.removeChild(group.firstChild);
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
    }

    function destroy() {
        clear();
        if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
        svg = null; defs = null; group = null;
    }

    global.ChainArrows = { setArrows, clear, destroy };
})(window);
