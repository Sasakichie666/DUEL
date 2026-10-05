// js/interaction/handLayout.js
// 手牌区自适应布局（参考主流卡牌游戏的做法）：
//   · 动态叠压：按「可用宽度 ÷ 张数」算出每张露出的宽度 —— 卡多了自动叠得更紧，永不越界
//   · 双车道  ：费用手牌固定占用左侧一条车道，主手牌在剩余车道内**恒定居中**；两组互不干扰
//   · 兜底缩放：某组即使叠到最紧仍放不下时，整组等比缩小
//   · 悬停放大：压缩得比较紧时，悬停的那张会放大（CSS 部分）
//
// 注：1.2 已**取消手牌聚焦切换**（原来点费用牌那组会把两组位置互换）——
//     现在主手牌恒定居中，费用牌的操作统一走「费用牌界面」批量面板。
//
// 计算结果写到 CSS 变量上（由 battle.css 使用）：
//   --hl-main-overlap / --hl-cost-overlap  每组卡牌之间的负 margin（叠压量）
//   --hl-main-scale   / --hl-cost-scale    极端情况下的整组缩放，1 = 不缩放

(function(global) {
    const CARD_W_FALLBACK = 110;   // 手牌卡宽度（与 css/card.css 一致），实际运行时实测
    const GAP_MAX = 76;            // 最松时每张露出的宽度（= 110 - 34，保持原有手感）
    const GAP_MIN = 18;            // 最紧时每张露出的宽度（至少露出一条边，能看出是卡）
    const SIDE_MAX_RATIO = 0.34;   // 非聚焦组最多占手牌区宽度的比例
    const LANE_GAP = 16;           // 两条车道之间的安全间隔
    const MIN_SCALE = 0.6;         // 缩放下限

    // 扇形排列参数（只作用于「居中/聚焦」的那一组，参考主流卡牌游戏的手牌弧线）
    const FAN_STEP = 2.4;          // 相邻两张的夹角（度）
    const FAN_MAX = 9;             // 单张最大倾角（度）
    const FAN_LIFT = 14;           // 中间那张相对两端抬高多少（px）
    const FAN_MIN_RATIO = 0.25;    // 叠压很紧时把夹角压到这个比例，避免糊成一团

    let rafId = 0;

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function handEl() { return document.getElementById('self-hand'); }
    function mainEl() { return document.getElementById('self-hand-main'); }
    function costEl() { return document.getElementById('self-hand-cost'); }

    function cardWidth(group) {
        const card = group && group.querySelector('.card-full');
        const w = card ? card.getBoundingClientRect().width : 0;
        return w > 0 ? w : CARD_W_FALLBACK;
    }

    /** 张数 → 每张露出宽度（含卡宽），落在 [GAP_MIN, GAP_MAX] */
    function gapFor(count, laneWidth, cardW) {
        if (count <= 1) return cardW;                    // 单张：不需要叠压
        const per = (laneWidth - cardW) / (count - 1);
        return clamp(per, GAP_MIN, GAP_MAX);
    }

    function setVar(el, name, value) {
        if (el) el.style.setProperty(name, value);
    }

    /**
     * 扇形排列：给某组的每一张卡写入 --fan-rot（倾角）与 --fan-y（弧线抬高）
     * 只有「居中/聚焦」的那一组开启；卡数少或叠得很紧时夹角自动减弱。
     */
    function applyFan(group, enabled, gap) {
        if (!group) return;
        const cards = group.querySelectorAll('.card-full');
        const count = cards.length;

        // 夹角强度：叠得越紧越弱（避免压缩时扇面糊在一起）
        const tight = (GAP_MAX - gap) / Math.max(1, GAP_MAX - GAP_MIN);
        const ratio = clamp(1 - tight, FAN_MIN_RATIO, 1);

        if (!enabled || count < 2) {
            cards.forEach(c => {
                c.style.setProperty('--fan-rot', '0deg');
                c.style.setProperty('--fan-y', '0px');
            });
            return;
        }

        const center = (count - 1) / 2;

        cards.forEach((c, i) => {
            const d = i - center;
            const rot = clamp(d * FAN_STEP * ratio, -FAN_MAX, FAN_MAX);
            const t = center === 0 ? 0 : d / center;          // -1 … 0 … 1
            const lift = -(1 - t * t) * FAN_LIFT;             // 中间最高，两端回到基线
            c.style.setProperty('--fan-rot', rot.toFixed(2) + 'deg');
            c.style.setProperty('--fan-y', lift.toFixed(1) + 'px');
        });
    }

    function update() {
        const hand = handEl();
        const main = mainEl();
        const cost = costEl();
        if (!hand || !main || !cost) return;

        const nMain = main.querySelectorAll('.card-full').length;
        const nCost = cost.querySelectorAll('.card-full').length;

        // 空手牌：复位为默认值
        if (nMain === 0 && nCost === 0) {
            setVar(hand, '--hl-main-overlap', '-34px');
            setVar(hand, '--hl-cost-overlap', '-52px');
            setVar(hand, '--hl-main-scale', '1');
            setVar(hand, '--hl-cost-scale', '1');
            applyFan(main, false, GAP_MAX);
            applyFan(cost, false, GAP_MAX);
            return;
        }

        const cs = getComputedStyle(hand);
        const usable = hand.clientWidth
            - (parseFloat(cs.paddingLeft) || 0)
            - (parseFloat(cs.paddingRight) || 0);
        if (!(usable > 0)) return;                       // 视图尚未布局，等下一次刷新

        const cardW = cardWidth(main) || cardWidth(cost);

        // ① 左侧车道固定给【费用手牌】（宽度上限 = 34% 手牌区）
        const sideCount = nCost;
        const sideNeed = sideCount > 0 ? cardW + (sideCount - 1) * GAP_MIN : 0;
        const sideLane = Math.min(sideNeed, usable * SIDE_MAX_RATIO);
        const sideGap = gapFor(sideCount, Math.max(sideLane, cardW), cardW);
        const sideScale = (sideNeed > sideLane + 0.5)
            ? clamp(sideLane / sideNeed, MIN_SCALE, 1)
            : 1;

        // ② 居中组固定是【主手牌】：整行居中 → 左右两侧都要预留「车道 + 安全间隔」
        const focusCount = nMain;
        const laneReserve = sideLane > 0 ? (sideLane + LANE_GAP) * 2 : LANE_GAP;
        const focusLane = Math.max(cardW, usable - laneReserve);
        const focusGap = gapFor(focusCount, focusLane, cardW);
        const focusNeed = focusCount > 0 ? cardW + (focusCount - 1) * GAP_MIN : 0;
        const focusScale = (focusNeed > focusLane + 0.5)
            ? clamp(focusLane / focusNeed, MIN_SCALE, 1)
            : 1;

        // ③ 写死归属：主手牌 = 居中组；费用手牌 = 左侧车道（已取消聚焦切换）
        const mainGap = focusGap;
        const mainScale = focusScale;
        const costGap = sideGap;
        const costScale = sideScale;

        setVar(hand, '--hl-main-overlap', (mainGap - cardW) + 'px');
        setVar(hand, '--hl-cost-overlap', (costGap - cardW) + 'px');
        setVar(hand, '--hl-main-scale', String(mainScale));
        setVar(hand, '--hl-cost-scale', String(costScale));

        // ④ 主手牌做扇形排列（费用手牌靠左紧叠，不扇形）
        applyFan(main, true, mainGap);
        applyFan(cost, false, costGap);
    }

    /** 合帧调度：连续多次触发（渲染 + 切模式 + 缩放窗口）只算一次 */
    function schedule() {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            update();
        });
    }

    window.addEventListener('resize', schedule);

    global.HandLayout = { update, schedule };
})(window);
