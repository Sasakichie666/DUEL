// js/interaction/targetSelector.js
// 响应连锁「目标选择器」—— 刻意不缓存任何 DOM 引用：
//   ① 点击时用 e.target 现场解析目标、现场判定合法性
//      （战场随时可能因为 refreshAll 被整体重建，缓存引用必然失效）
//   ② 基础高亮完全交给 CSS（body 上挂 scope 类）→ 重渲染后高亮自动还在
//   ③ 选中态每 200ms 从当前窗口重新补一次类（只有"已选中"需要逐个标记）
// 参考思路：Forge / RiftAtlas 这类模拟器都是「待定动作 + 目标对象列表 + 绘制时实时查 DOM」。

(function(global) {
    // 目标语义 / 锚点解析统一委托 ChainTarget（唯一事实来源）
    function T() { return global.ChainTarget; }

    let active = false;
    let timePoint = null;
    let pickerSide = 'self';
    let scope = null;
    let onStateChange = null;
    let onPick = null;            // 传了就是"单选即提交"（阻挡）
    let clickHandler = null;
    let keyHandler = null;
    let markTimer = 0;

    function isActive() { return active; }

    /* ================= 现场解析（不缓存） ================= */

    function sideOf(el) { return T() ? T().sideOfElement(el) : 'opponent'; }

    /** 从被点击的元素解析目标（每次实时取） */
    function targetFromElement(el) { return T() ? T().fromElement(el) : null; }

    function keyOf(t) { return T() ? T().keyOf(t) : null; }

    function elementOf(key) { return T() ? T().resolveByKey(key) : null; }

    /* ================= 选中态补类 ================= */

    function markSelected() {
        if (!active) return;
        const win = global.ChainManager && global.ChainManager.getWindow
            ? global.ChainManager.getWindow() : null;
        const link = win && win.links ? win.links[win.links.length - 1] : null;
        const chosen = ((link && link.targets) || []).map(keyOf);

        document.querySelectorAll('.chain-target-on').forEach(el => el.classList.remove('chain-target-on'));
        chosen.forEach(key => {
            const el = elementOf(key);
            if (el) el.classList.add('chain-target-on');
        });
    }

    function refresh() { markSelected(); }
    /* ================= 事件 ================= */

    function handleClick(e) {
        if (!active) return;
        const target = targetFromElement(e.target);
        if (!target) return;                     // 点在空白处：不拦截，也不做事

        const R = global.ChainRules;
        const legal = R ? R.isTargetLegal(timePoint, pickerSide, target) : true;

        e.stopPropagation();
        e.preventDefault();
        if (!legal) {
            console.log('[TargetSelector] 该时点不可选此目标 ', target,
                '| 时点:', timePoint, '| scope:', scope, '| pickerSide:', pickerSide);
            return;
        }

        if (onPick) {                             // 单选即提交（阻挡）
            const cb = onPick;
            end();
            try { cb(target); } catch (err) { console.error(err); }
            return;
        }

        if (global.ChainManager && global.ChainManager.toggleTarget) {
            global.ChainManager.toggleTarget(target);
        }
        console.log('[TargetSelector] 已切换目标', target);
        markSelected();
        if (global.ChainPanelUI && global.ChainPanelUI.refreshArrows) {
            global.ChainPanelUI.refreshArrows();
        }
    }

    function handleKey(e) {
        if (e.key === 'Escape') end();
    }

    function startMarkTimer() {
        stopMarkTimer();
        // 战场被重渲染（换牌/拖拽/同步）后自动把选中态补回来
        markTimer = window.setInterval(markSelected, 200);
    }

    function stopMarkTimer() {
        if (markTimer) { clearInterval(markTimer); markTimer = 0; }
    }

    /* ================= 对外 ================= */

    function begin(tp, side, onEnd, pickHandler) {
        const R = global.ChainRules;
        const rule = R && R.get(tp);
        if (!rule) return false;
        end();

        timePoint = tp;
        pickerSide = side === 'opponent' ? 'opponent' : 'self';
        scope = rule.scope;
        onStateChange = typeof onEnd === 'function' ? onEnd : null;
        onPick = typeof pickHandler === 'function' ? pickHandler : null;
        active = true;

        const body = document.body;
        body.classList.add('chain-targeting');
        const scopeCls = (R && R.scopeClass) ? R.scopeClass(scope) : null;   // scope → CSS 高亮类的映射在 ChainRules 里
        if (scopeCls) body.classList.add(scopeCls);

        clickHandler = handleClick;
        keyHandler = handleKey;
        document.addEventListener('mousedown', clickHandler, true);
        document.addEventListener('keydown', keyHandler, true);

        markSelected();
        startMarkTimer();
        console.log('[TargetSelector] 进入目标选择', tp, '| scope:', scope, '| pickerSide:', pickerSide);
        return true;
    }

    function end() {
        if (!active) { active = false; return; }
        active = false;
        stopMarkTimer();
        document.querySelectorAll('.chain-target-on').forEach(el => el.classList.remove('chain-target-on'));

        const body = document.body;
        body.classList.remove('chain-targeting');
        String(body.className || '').split(/\s+/).forEach(c => {      // 清掉所有 chain-scope-* 高亮类
            if (c.indexOf('chain-scope-') === 0) body.classList.remove(c);
        });

        if (clickHandler) document.removeEventListener('mousedown', clickHandler, true);
        if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
        clickHandler = null;
        keyHandler = null;
        onPick = null;

        const cb = onStateChange;
        onStateChange = null;
        if (cb) { try { cb(false); } catch (err) { console.error(err); } }
    }

    global.TargetSelector = { begin, end, refresh, isActive, targetFromElement, keyOf, elementOf };
})(window);
