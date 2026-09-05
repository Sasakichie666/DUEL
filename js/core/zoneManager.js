// js/core/zoneManager.js
// 区域管理器：只负责区域规则、格子占用检查、卡牌所有者查找，不包含具体操作

(function(global) {
    const ZONE = {
        HAND: 'hand',
        MAIN_DECK: 'mainDeck',
        COST_DECK: 'costDeck',
        FRONT_FIELD: 'frontField',
        BACK_FIELD: 'backField',
        COST_ZONE: 'costZone',
        GRAVEYARD: 'graveyard',
        EXILE: 'exile',
    };

    const SLOT_ZONES = new Set([
        ZONE.FRONT_FIELD,
        ZONE.BACK_FIELD,
        ZONE.COST_ZONE,
        ZONE.PUBLIC_FIELD,
    ]);

    const PILE_ZONES = new Set([
        ZONE.MAIN_DECK,
        ZONE.COST_DECK,
        ZONE.GRAVEYARD,
        ZONE.EXILE,
    ]);

    function getPlayerState(player) {
        return global.GameState.getPlayerState(player);
    }

    // 判断是否为格子区域（需要检查占用）
    function isSlotZone(zone) {
        return SLOT_ZONES.has(zone);
    }

    // 检查格子是否可用（为空）
    function isSlotAvailable(player, zone, index) {
        if (zone === ZONE.PUBLIC_FIELD) {
            const state = global.GameState.getState();
            if (!state || !state.publicField) return false;
            return index >= 0 && index < state.publicField.length && state.publicField[index] === null;
        }
        if (!SLOT_ZONES.has(zone)) return true;
        const state = getPlayerState(player);
        if (!state) return false;
        const array = state[zone];
        if (!array || index < 0 || index >= array.length) return false;
        return array[index] === null;
    }

    // 检查是否可以放置卡牌到指定区域
    function canPlaceCard(player, zone, index = -1) {
        if (SLOT_ZONES.has(zone)) {
            return isSlotAvailable(player, zone, index);
        }
        if (zone === ZONE.HAND) return true;
        if (PILE_ZONES.has(zone)) return true;
        return false;
    }

    // 查找卡牌实例所属玩家
    function findCardOwner(instanceId) {
        const state = global.GameState.getState();
        if (!state) return null;
        for (const playerKey of ['self', 'opponent']) {
            const player = state.players[playerKey];
            const zonesToCheck = [
                player.hand,
                player.frontField,
                player.backField,
                player.costZone,
                player.mainDeck,
                player.costDeck,
                player.graveyard,
                player.exile,
            ];
            for (const zoneArray of zonesToCheck) {
                if (zoneArray.some(c => c && c.instanceId === instanceId)) {
                    return playerKey;
                }
            }
        }
        return null;
    }

    // 导出（注意：不再包含 moveCard、drawFromDeckForDrag 等操作方法）
    global.ZoneManager = {
        ZONE,
        SLOT_ZONES,
        PILE_ZONES,
        isSlotZone,
        isSlotAvailable,
        canPlaceCard,
        findCardOwner,
    };
})(window);