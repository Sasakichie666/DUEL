// js/core/timePointBus.js
// 时点事件总线：游戏里发生「值得响应的事情」时广播一个事件。
// 设计目的：现有模块只需一行 emit，完全不需要知道连锁系统的存在（彻底解耦）。
//
// 事件对象约定：
//   { type, actor, card, fromZone, toZone, targets }
//   type    : 'minion:enter' | 'tactic:activate' | 'minion:effect' | 'attack:declare'
//   actor   : 'self' | 'opponent'（本地视角）
//   card    : 卡牌实例（可空）

(function(global) {
    const listeners = [];

    /** 订阅；返回取消函数 */
    function on(fn) {
        if (typeof fn !== 'function') return function() {};
        listeners.push(fn);
        return function offOnce() { off(fn); };
    }

    function off(fn) {
        const i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
    }

    /**
     * 广播事件。
     * 永不抛错：某个监听器异常只记日志，绝不向调用方冒泡 ——
     * 这样即使连锁系统出问题，拖拽/移动卡牌等现有功能也不受影响。
     */
    function emit(event) {
        if (!event || !event.type) return;
        listeners.slice().forEach(fn => {
            try {
                fn(event);
            } catch (e) {
                console.error('[TimePointBus] 监听器异常（已忽略，不影响原功能）', e);
            }
        });
    }

    function clear() {
        listeners.length = 0;
    }

    global.TimePointBus = { on, off, emit, clear };
})(window);
