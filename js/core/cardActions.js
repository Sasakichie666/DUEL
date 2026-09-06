// js/core/cardActions.js
// 卡牌底层操作模块：从 gameState 迁移过来的原子操作，不包含菜单业务语义
// 修改：支持传说牌库 legendDeck 的抽牌、移回、检索、洗切；装备逻辑保持不变

(function(global) {
    const GameState = global.GameState;
    const ZoneManager = global.ZoneManager;

    function drawFromDeck(player, deckType, count = 1) {
        const state = GameState.getState();
        if (!state) return [];
        const playerState = state.players[player];
        if (!playerState) return [];

        const deck = playerState[deckType];
        const drawnCards = [];

        for (let i = 0; i < count; i++) {
            if (deck.length === 0) break;
            const card = deck.shift();
            card.zone = GameState.ZONE.HAND;
            card.zoneIndex = playerState.hand.length;
            playerState.hand.push(card);
            drawnCards.push(card);
        }

        updateHandCounts(playerState);
        GameState.notifyListeners();
        return drawnCards;
    }

    function drawInitialHand(player) {
        const drawnMain = drawFromDeck(player, 'mainDeck', GameState.INITIAL_HAND_SIZE);
        const drawnCost = drawFromDeck(player, 'costDeck', GameState.INITIAL_COST_HAND_SIZE);
        // 传说牌库不参与初始抽牌，可根据需要添加
        return [...drawnMain, ...drawnCost];
    }

    function moveCard(instanceId, toZone, toIndex) {
        const state = GameState.getState();
        if (!state) return false;

        let card = null;
        let player = null;
        const publicIndex = state.publicField ? state.publicField.findIndex(c => c && c.instanceId === instanceId) : -1;
        if (publicIndex !== -1) {
            card = state.publicField[publicIndex];
            state.publicField[publicIndex] = null;
            player = state.players['self'];
        } else {
            const result = removeCardFromCurrentZone(instanceId);
            if (!result) return false;
            card = result.card;
            player = result.player;
        }

        const sourceZone = card.zone;

       // === 新增：自动休整 ===
        if (sourceZone === GameState.ZONE.HAND &&
            (toZone === GameState.ZONE.FRONT_FIELD || toZone === GameState.ZONE.COST_ZONE)) {
            card.active = false;
        }
        

        // 从战场移到非战场区域时，重置攻防并处理装备卡
        if ((sourceZone === GameState.ZONE.FRONT_FIELD || sourceZone === GameState.ZONE.BACK_FIELD) &&
            (toZone !== GameState.ZONE.FRONT_FIELD && toZone !== GameState.ZONE.BACK_FIELD)) {
            resetAttackDefenseIfMinion(card);
            moveEquippedCardsToGraveyard(card);
        }

        if (toZone === GameState.ZONE.HAND) {
            card.faceDown = false;
        }
        if (toZone === GameState.ZONE.PERSONAL_ZONE) {
            card.faceDown = false;
            player.personalZone.push(card);
            card.zone = GameState.ZONE.PERSONAL_ZONE;
            card.zoneIndex = player.personalZone.length - 1;
            GameState.notifyListeners();
            return true;
        }

        if (toZone === GameState.ZONE.PUBLIC_FIELD) {
            if (toIndex < 0 || toIndex >= state.publicField.length) {
                placeCardInZone(player, card, card.zone, card.zoneIndex);
                GameState.notifyListeners();
                return false;
            }
            if (state.publicField[toIndex] !== null) {
                if (card.zone === GameState.ZONE.PUBLIC_FIELD) {
                    state.publicField[card.zoneIndex] = card;
                } else {
                    placeCardInZone(player, card, card.zone, card.zoneIndex);
                }
                GameState.notifyListeners();
                return false;
            }
            state.publicField[toIndex] = card;
            card.zone = GameState.ZONE.PUBLIC_FIELD;
            card.zoneIndex = toIndex;
            GameState.notifyListeners();
            return true;
        }

        if (ZoneManager.isSlotZone(toZone)) {
            if (!ZoneManager.isSlotAvailable(player.owner, toZone, toIndex)) {
                if (card.zone === GameState.ZONE.PUBLIC_FIELD) {
                    state.publicField[card.zoneIndex] = card;
                } else {
                    placeCardInZone(player, card, card.zone, card.zoneIndex);
                }
                GameState.notifyListeners();
                return false;
            }
        }

        placeCardInZone(player, card, toZone, toIndex);
        GameState.notifyListeners();
        return true;
    }

    function drawTopCardFromDeck(player, deckType) {
        const state = GameState.getState();
        if (!state) return null;
        const playerState = state.players[player];
        if (!playerState) return null;
        const deck = playerState[deckType];
        if (deck.length === 0) return null;
        const card = deck.shift();
        card.zone = null;
        card.zoneIndex = -1;
        GameState.notifyListeners();
        return card;
    }

    function moveCardFromDeckToZone(player, deckType, toZone, toIndex) {
        const state = GameState.getState();
        if (!state) return false;
        const playerState = state.players[player];
        if (!playerState) return false;

        const deck = playerState[deckType];
        if (deck.length === 0) return false;
        const card = deck.shift();

        if (toZone === GameState.ZONE.PERSONAL_ZONE) {
            card.faceDown = false;
            playerState.personalZone.push(card);
            card.zone = GameState.ZONE.PERSONAL_ZONE;
            card.zoneIndex = playerState.personalZone.length - 1;
            GameState.notifyListeners();
            return true;
        }

        if (toZone === GameState.ZONE.PUBLIC_FIELD) {
            if (toIndex < 0 || toIndex >= state.publicField.length || state.publicField[toIndex] !== null) {
                deck.unshift(card);
                card.zone = deckType;
                GameState.notifyListeners();
                return false;
            }
            state.publicField[toIndex] = card;
            card.zone = GameState.ZONE.PUBLIC_FIELD;
            card.zoneIndex = toIndex;
            GameState.notifyListeners();
            return true;
        }

        if (ZoneManager.isSlotZone(toZone)) {
            if (!ZoneManager.isSlotAvailable(player, toZone, toIndex)) {
                deck.unshift(card);
                card.zone = deckType;
                GameState.notifyListeners();
                return false;
            }
        }

        card.faceDown = false;
        placeCardInZone(playerState, card, toZone, toIndex);
        GameState.notifyListeners();
        return true;
    }

    function moveSpecificCardFromDeckToZone(player, deckType, instanceId, toZone, toIndex) {
        const state = GameState.getState();
        if (!state) return false;
        const playerState = state.players[player];
        if (!playerState) return false;

        const deck = playerState[deckType];
        const index = deck.findIndex(c => c && c.instanceId === instanceId);
        if (index === -1) return false;

        const card = deck.splice(index, 1)[0];

        if (toZone === GameState.ZONE.PUBLIC_FIELD) {
            if (toIndex < 0 || toIndex >= state.publicField.length || state.publicField[toIndex] !== null) {
                deck.splice(index, 0, card);
                card.zone = deckType;
                GameState.notifyListeners();
                return false;
            }
            state.publicField[toIndex] = card;
            card.zone = GameState.ZONE.PUBLIC_FIELD;
            card.zoneIndex = toIndex;
            GameState.notifyListeners();
            return true;
        }

        if (toZone === GameState.ZONE.PERSONAL_ZONE) {
            card.faceDown = false;
            playerState.personalZone.push(card);
            card.zone = GameState.ZONE.PERSONAL_ZONE;
            card.zoneIndex = playerState.personalZone.length - 1;
            GameState.notifyListeners();
            return true;
        }

        if (ZoneManager.isSlotZone(toZone)) {
            if (!ZoneManager.isSlotAvailable(player, toZone, toIndex)) {
                deck.splice(index, 0, card);
                card.zone = deckType;
                GameState.notifyListeners();
                return false;
            }
        }

        placeCardInZone(playerState, card, toZone, toIndex);
        GameState.notifyListeners();
        return true;
    }

    function returnCardToDeckTop(player, deckType, card) {
        const state = GameState.getState();
        if (!state || !card) return false;
        const playerState = state.players[player];
        if (!playerState) return false;

        const result = removeCardFromAnywhere(card.instanceId);
        if (!result) return false;

        const sourceZone = card.zone;
        if (sourceZone === GameState.ZONE.FRONT_FIELD || sourceZone === GameState.ZONE.BACK_FIELD) {
            resetAttackDefenseIfMinion(card);
            moveEquippedCardsToGraveyard(card);
        }

        playerState[deckType].unshift(card);
        card.zone = deckType;
        card.zoneIndex = 0;
        for (let i = 1; i < playerState[deckType].length; i++) {
            playerState[deckType][i].zoneIndex = i;
        }
        GameState.notifyListeners();
        return true;
    }

    function returnCardToDeckBottom(player, deckType, card) {
        const state = GameState.getState();
        if (!state || !card) return false;
        const playerState = state.players[player];
        if (!playerState) return false;

        const result = removeCardFromAnywhere(card.instanceId);
        if (!result) return false;

        const sourceZone = card.zone;
        if (sourceZone === GameState.ZONE.FRONT_FIELD || sourceZone === GameState.ZONE.BACK_FIELD) {
            resetAttackDefenseIfMinion(card);
            moveEquippedCardsToGraveyard(card);
        }

        playerState[deckType].push(card);
        card.zone = deckType;
        card.zoneIndex = playerState[deckType].length - 1;
        GameState.notifyListeners();
        return true;
    }

    function changeHealth(player, delta) {
        const state = GameState.getState();
        if (!state) return;
        const playerState = state.players[player];
        if (!playerState) return;
        playerState.health = Math.max(0, playerState.health + delta);
        GameState.notifyListeners();
    }

    function shuffleDeck(player, deckType) {
        const state = GameState.getState();
        if (!state) return false;
        const playerState = state.players[player];
        if (!playerState) return false;
        const deck = playerState[deckType];
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        deck.forEach((card, index) => { card.zoneIndex = index; });
        GameState.notifyListeners();
        return true;
    }

    function toggleCardFaceDown(card) {
        if (!card) return false;
        card.faceDown = !card.faceDown;
        GameState.notifyListeners();
        return true;
    }

    function equipCardToTarget(equipCard, targetCard) {
        const state = GameState.getState();
        if (!state || !equipCard || !targetCard) return false;

        if (targetCard.zone !== GameState.ZONE.FRONT_FIELD && targetCard.zone !== GameState.ZONE.BACK_FIELD) {
            return false;
        }

        if (!equipCard.cardData && equipCard.cardId) {
            equipCard.cardData = global.CardLibrary ? global.CardLibrary.getCardById(equipCard.cardId) : null;
        }

        const removeResult = removeCardFromAnywhere(equipCard.instanceId);
        if (!removeResult) return false;

        if (!targetCard.equippedCards) targetCard.equippedCards = [];
        targetCard.equippedCards.push(equipCard);
        equipCard.zone = 'equipped';
        equipCard.zoneIndex = -1;

        GameState.notifyListeners();
        return true;
    }

    function resetAttackDefenseIfMinion(card) {
        if (card && card.cardData && card.cardData.type === 'minion') {
            card.currentAttack = card.cardData.attack;
            card.currentDefense = card.cardData.defense;
        }
    }

    function moveEquippedCardsToGraveyard(targetCard) {
        if (targetCard && targetCard.equippedCards && targetCard.equippedCards.length > 0) {
            const state = GameState.getState();
            targetCard.equippedCards.forEach(equipCard => {
                if (!equipCard.cardData && equipCard.cardId) {
                    equipCard.cardData = global.CardLibrary ? global.CardLibrary.getCardById(equipCard.cardId) : null;
                }
                const ownerState = state.players[equipCard.owner];
                if (ownerState) {
                    ownerState.graveyard.push(equipCard);
                    equipCard.zone = GameState.ZONE.GRAVEYARD;
                    equipCard.zoneIndex = ownerState.graveyard.length - 1;
                }
            });
            targetCard.equippedCards = [];
        }
    }

    function removeCardFromAnywhere(instanceId) {
        const state = GameState.getState();
        if (!state) return null;

        if (state.publicField) {
            const pubIndex = state.publicField.findIndex(c => c && c.instanceId === instanceId);
            if (pubIndex !== -1) {
                const card = state.publicField[pubIndex];
                state.publicField[pubIndex] = null;
                return { card, player: state.players['self'] };
            }
        }

        return removeCardFromCurrentZone(instanceId);
    }

    function removeCardFromCurrentZone(instanceId) {
        const state = GameState.getState();
        if (!state) return null;

        for (const playerKey of ['self', 'opponent']) {
            const player = state.players[playerKey];

            const personalIndex = player.personalZone.findIndex(c => c && c.instanceId === instanceId);
            if (personalIndex !== -1) {
                const card = player.personalZone.splice(personalIndex, 1)[0];
                return { card, player };
            }

            const handIndex = player.hand.findIndex(c => c && c.instanceId === instanceId);
            if (handIndex !== -1) {
                const card = player.hand.splice(handIndex, 1)[0];
                updateHandCounts(player);
                return { card, player };
            }

            for (let i = 0; i < player.frontField.length; i++) {
                if (player.frontField[i] && player.frontField[i].instanceId === instanceId) {
                    const card = player.frontField[i];
                    player.frontField[i] = null;
                    return { card, player };
                }
            }

            for (let i = 0; i < player.backField.length; i++) {
                if (player.backField[i] && player.backField[i].instanceId === instanceId) {
                    const card = player.backField[i];
                    player.backField[i] = null;
                    return { card, player };
                }
            }

            for (let i = 0; i < player.costZone.length; i++) {
                if (player.costZone[i] && player.costZone[i].instanceId === instanceId) {
                    const card = player.costZone[i];
                    player.costZone[i] = null;
                    return { card, player };
                }
            }

            const pileZones = ['mainDeck', 'costDeck', 'legendDeck', 'graveyard', 'exile'];
            for (const pileZone of pileZones) {
                const idx = player[pileZone].findIndex(c => c && c.instanceId === instanceId);
                if (idx !== -1) {
                    const card = player[pileZone].splice(idx, 1)[0];
                    return { card, player };
                }
            }
        }
        return null;
    }

    function placeCardInZone(player, card, zone, index) {
        if (zone !== GameState.ZONE.FRONT_FIELD &&
            zone !== GameState.ZONE.BACK_FIELD &&
            zone !== GameState.ZONE.COST_ZONE &&
            zone !== GameState.ZONE.PUBLIC_FIELD) {
            card.active = true;
        }

        card.zone = zone;
        card.zoneIndex = index;

        switch (zone) {
            case GameState.ZONE.HAND:
                if (index === undefined || index < 0 || index >= player.hand.length) {
                    player.hand.push(card);
                    card.zoneIndex = player.hand.length - 1;
                } else {
                    player.hand.splice(index, 0, card);
                }
                updateHandCounts(player);
                break;
            case GameState.ZONE.FRONT_FIELD:
                if (index >= 0 && index < player.frontField.length) {
                    player.frontField[index] = card;
                }
                break;
            case GameState.ZONE.BACK_FIELD:
                if (index >= 0 && index < player.backField.length) {
                    player.backField[index] = card;
                }
                break;
            case GameState.ZONE.COST_ZONE:
                if (index >= 0 && index < player.costZone.length) {
                    player.costZone[index] = card;
                }
                break;
            case GameState.ZONE.MAIN_DECK:
                player.mainDeck.unshift(card);
                card.zoneIndex = 0;
                for (let i = 1; i < player.mainDeck.length; i++) {
                    player.mainDeck[i].zoneIndex = i;
                }
                break;
            case GameState.ZONE.COST_DECK:
                player.costDeck.unshift(card);
                card.zoneIndex = 0;
                for (let i = 1; i < player.costDeck.length; i++) {
                    player.costDeck[i].zoneIndex = i;
                }
                break;
            case GameState.ZONE.LEGEND_DECK:
                player.legendDeck.unshift(card);
                card.zoneIndex = 0;
                for (let i = 1; i < player.legendDeck.length; i++) {
                    player.legendDeck[i].zoneIndex = i;
                }
                break;
            case GameState.ZONE.GRAVEYARD:
                player.graveyard.push(card);
                card.zoneIndex = player.graveyard.length - 1;
                break;
            case GameState.ZONE.EXILE:
                player.exile.push(card);
                card.zoneIndex = player.exile.length - 1;
                break;
        }
    }

    function updateHandCounts(player) {
        let main = 0, cost = 0;
        player.hand.forEach(instance => {
            if (!instance) return;
            const card = instance.cardData || global.CardLibrary?.getCardById(instance.cardId);
            if (card && card.type === 'cost') cost++;
            else main++;
        });
        player.handMainCount = main;
        player.handCostCount = cost;
    }

    global.CardActions = {
        drawFromDeck,
        drawInitialHand,
        moveCard,
        drawTopCardFromDeck,
        moveCardFromDeckToZone,
        moveSpecificCardFromDeckToZone,
        returnCardToDeckTop,
        returnCardToDeckBottom,
        changeHealth,
        shuffleDeck,
        toggleCardFaceDown,
        equipCardToTarget
    };
})(window);