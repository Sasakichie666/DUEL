// js/core/markOrderManager.js
// 标记与顺序独立管理器：全局存储，不依赖卡牌实例

(function(global) {
    const marks = new Map();   // key: instanceId, value: 'self' | 'opponent'
    const orders = new Map();  // key: instanceId, value: number

    function setMark(instanceId, type) {
        if (type === null || type === undefined) {
            marks.delete(instanceId);
        } else {
            marks.set(instanceId, type);
        }
    }

    function removeMark(instanceId) {
        marks.delete(instanceId);
    }

    function getMark(instanceId) {
        return marks.get(instanceId) || null;
    }

    function setOrder(instanceId, order) {
        if (order === 0 || order === null || order === undefined) {
            orders.delete(instanceId);
        } else {
            orders.set(instanceId, order);
        }
    }

    function removeOrder(instanceId) {
        orders.delete(instanceId);
    }

    function getOrder(instanceId) {
        return orders.get(instanceId) || 0;
    }

    function clearAll() {
        marks.clear();
        orders.clear();
    }

    // 获取所有标记（用于同步）
    function getMarksState() {
        const result = {};
        marks.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }

    // 获取所有顺序（用于同步）
    function getOrdersState() {
        const result = {};
        orders.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }

    // 从同步数据恢复
    function setMarksState(data) {
        marks.clear();
        if (data) {
            Object.entries(data).forEach(([key, value]) => {
                marks.set(key, value);
            });
        }
    }

    function setOrdersState(data) {
        orders.clear();
        if (data) {
            Object.entries(data).forEach(([key, value]) => {
                orders.set(key, value);
            });
        }
    }

    global.MarkOrderManager = {
        setMark,
        removeMark,
        getMark,
        setOrder,
        removeOrder,
        getOrder,
        clearAll,
        getMarksState,
        getOrdersState,
        setMarksState,
        setOrdersState
    };
})(window);