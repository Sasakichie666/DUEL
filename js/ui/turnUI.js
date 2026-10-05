// js/ui/turnUI.js
// 回合UI模块：显示投掷界面、点数、先后手选择（美观版）

(function(global) {
    let overlay = null;
    let content = null;
    let rollBtn = null;
    let myRollEl = null;
    let oppRollEl = null;
    let chooseSelfBtn = null;
    let chooseOppBtn = null;
    let infoText = null;

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.className = 'turn-overlay';
        overlay.style.display = 'none';
        document.body.appendChild(overlay);
        return overlay;
    }

    function showRollInterface() {
        const overlay = ensureOverlay();
        overlay.innerHTML = '';
        overlay.style.display = 'flex';

        content = document.createElement('div');
        content.className = 'turn-content';

        const title = document.createElement('div');
        title.className = 'turn-title';
        title.textContent = '⚖️ 决定先后手';
        content.appendChild(title);

        infoText = document.createElement('div');
        infoText.className = 'turn-info';
        infoText.textContent = '请双方点击投掷点数';
        content.appendChild(infoText);

        const rolls = document.createElement('div');
        rolls.className = 'turn-rolls';

        myRollEl = document.createElement('div');
        myRollEl.className = 'turn-roll turn-roll-self';
        myRollEl.innerHTML = '<span class="roll-label">我的点数</span><span class="roll-value">?</span>';
        rolls.appendChild(myRollEl);

        const vs = document.createElement('div');
        vs.className = 'turn-vs';
        vs.textContent = 'VS';
        rolls.appendChild(vs);

        oppRollEl = document.createElement('div');
        oppRollEl.className = 'turn-roll turn-roll-opp';
        oppRollEl.innerHTML = '<span class="roll-label">对手点数</span><span class="roll-value">?</span>';
        rolls.appendChild(oppRollEl);

        content.appendChild(rolls);

        rollBtn = document.createElement('button');
        rollBtn.className = 'btn btn-success turn-roll-btn';
        rollBtn.textContent = '🎲 投掷';
        rollBtn.addEventListener('click', () => {
            rollBtn.disabled = true;
            global.TurnManager.roll();
        });
        content.appendChild(rollBtn);

        overlay.appendChild(content);
    }

    function updateMyRoll(roll) {
        if (myRollEl) myRollEl.querySelector('.roll-value').textContent = roll;
    }

    function updateOpponentRoll(roll) {
        if (oppRollEl) oppRollEl.querySelector('.roll-value').textContent = roll;
    }

    function showTieAndRollAgain() {
        if (infoText) infoText.textContent = '平局！请重新投掷';
        if (rollBtn) rollBtn.disabled = false;
        if (myRollEl) myRollEl.querySelector('.roll-value').textContent = '?';
        if (oppRollEl) oppRollEl.querySelector('.roll-value').textContent = '?';
    }

    function showChooseFirst() {
        if (rollBtn) rollBtn.style.display = 'none';
        if (infoText) infoText.textContent = '你获胜！请选择先后手';
        const chooseContainer = document.createElement('div');
        chooseContainer.className = 'turn-choose';
        chooseSelfBtn = document.createElement('button');
        chooseSelfBtn.className = 'btn';
        chooseSelfBtn.textContent = '我方先手';
        chooseSelfBtn.addEventListener('click', () => {
            global.TurnManager.chooseFirst('self');
        });
        chooseOppBtn = document.createElement('button');
        chooseOppBtn.className = 'btn';
        chooseOppBtn.textContent = '对方先手';
        chooseOppBtn.addEventListener('click', () => {
            global.TurnManager.chooseFirst('opponent');
        });
        chooseContainer.appendChild(chooseSelfBtn);
        chooseContainer.appendChild(chooseOppBtn);
        if (content) content.appendChild(chooseContainer);
    }

    function showWaitOpponentChoose() {
        if (rollBtn) rollBtn.style.display = 'none';
        if (infoText) infoText.textContent = '对方获胜，等待对方选择先后手...';
    }

    function hide() {
        if (overlay) {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
        }
    }

    global.TurnUI = {
        showRollInterface,
        updateMyRoll,
        updateOpponentRoll,
        showTieAndRollAgain,
        showChooseFirst,
        showWaitOpponentChoose,
        hide,
    };
})(window);