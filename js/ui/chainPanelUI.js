// js/ui/chainPanelUI.js
// 响应连锁「右侧面板」：使用者 → 时点介绍 → 卡牌详情（每段一栏）→ 状态 → 按钮组。
// 面板挂在 document.body 上、z-index 最高层；位置贴在牌桌右缘（细工具栏左侧）。
//
// 面板只做两件事：把 ChainManager 的窗口状态画出来、把按钮点击转成 ChainManager 的调用。
// 所有"会不会改变游戏状态"的事情都不在这里发生（卡牌仍由玩家用现有拖拽/菜单手动处理）。

(function(global) {
    let panel = null;
    let headEl = null;
    let listEl = null;
    let statusEl = null;
    let btnsEl = null;
    let lastSignature = '';
    let respondRowVisible = false;
    let lastWinId = null;
    let collapsed = false;          // 折叠状态：只留标题栏（方便看手牌与战场），整个会话记住

    /** 折叠 / 展开响应面板 */
    function setCollapsed(v) {
        collapsed = !!v;
        if (panel) panel.classList.toggle('chain-collapsed', collapsed);
    }

    function ruleOf(win) {
        const R = global.ChainRules;
        return R && win ? R.get(win.timePoint) : null;
    }

    /** 当前"正在进行的动作"的时点（响应后是新增链段的时点，不是窗口最初的时点） */
    function activeTimePoint(win) {
        if (global.ChainManager && global.ChainManager.activeTimePoint) {
            return global.ChainManager.activeTimePoint(win);
        }
        return win ? win.timePoint : null;
    }

    function activeRule(win) {
        const R = global.ChainRules;
        const tp = activeTimePoint(win);
        return R && tp ? R.get(tp) : null;
    }

    /** 当前「焦点序列」：处理阶段 = 正在处理的序列；否则 = 最后发动的那一段（序列值最大） */
    function focusSeq(win) {
        const links = (win && win.links) || [];
        if (!links.length) return 0;
        if (win.phase === 'resolving' && win.resolveSeq != null) return win.resolveSeq;
        return links.reduce((m, l) => (l && l.seq > m ? l.seq : m), 0);
    }

    /** 处理阶段当前正在处理的那一段（不在处理阶段则为 null） */
    function resolvingLink(win) {
        if (!win || win.phase !== 'resolving') return null;
        return (win.links || []).find(l => l && l.seq === win.resolveSeq) || null;
    }

    /* ================= 面板骨架与定位 ================= */

    function ensurePanel() {
        if (panel && document.body.contains(panel)) return panel;

        panel = document.createElement('div');
        panel.className = 'chain-panel';
        panel.id = 'chainPanel';

        headEl = document.createElement('div');
        headEl.className = 'chain-head';
        listEl = document.createElement('div');
        listEl.className = 'chain-links';
        statusEl = document.createElement('div');
        statusEl.className = 'chain-status';
        btnsEl = document.createElement('div');
        btnsEl.className = 'chain-buttons';

        panel.append(headEl, listEl, statusEl, btnsEl);
        document.body.appendChild(panel);

        window.addEventListener('resize', positionPanel);
        return panel;
    }

    /** 贴在牌桌右缘（= 细工具栏左侧）；空间不足时收窄 */
    function positionPanel() {
        if (!panel) return;
        const table = document.querySelector('.battle-table');
        let right = 16;
        if (table) {
            const r = table.getBoundingClientRect();
            right = Math.max(12, window.innerWidth - r.right + 12);
        }
        const avail = Math.max(200, window.innerWidth - right - 12);
        panel.style.right = right + 'px';
        panel.style.setProperty('--chain-w', Math.min(340, avail) + 'px');   // 容得下 260px 的卡面详情
    }

    function hidePanel() {
        if (global.TargetSelector) global.TargetSelector.end();
        if (global.ChainArrows) global.ChainArrows.clear();
        if (panel) panel.classList.remove('open');
        respondRowVisible = false;
        lastSignature = '';
    }

    /* ================= 渲染入口 ================= */

    function signatureOf(win) {
        return win
            ? [win.id, win.rev, win.phase, win.decideSide, win.activeSide,
                win.resolveSeq != null ? win.resolveSeq : '-',
                (win.links || []).length,
                (win.links || []).map(l => (l.targets || []).length).join('.'),   // 目标变化也要重画行
                win.allowBlock ? 1 : 0, respondRowVisible ? 1 : 0].join('|')
            : 'none';
    }

    function render(win) {
        if (!win) {
            hidePanel();
            return;
        }
        ensurePanel();
        panel.classList.add('open');
        setCollapsed(collapsed);      // 沿用上次的折叠状态
        positionPanel();

        const sig = signatureOf(win);
        if (sig !== lastSignature) {
            lastSignature = sig;
            buildHead(win);
            buildLinks(win);
            buildFooter(win);
        }

        const myTargeting = win.phase === 'targeting' && win.activeSide === 'self';
        if (myTargeting) {
            if (global.TargetSelector && !global.TargetSelector.isActive()) {
                // 用「当前活跃链段」的时点：响应后要按新链段的规则选目标
                global.TargetSelector.begin(activeTimePoint(win), win.activeSide, () => {
                    lastSignature = '';
                    render(global.ChainManager.getWindow());
                });
            }
        } else if (global.TargetSelector && global.TargetSelector.isActive()) {
            global.TargetSelector.end();
        }

        updateArrows(win);
    }
    /* ================= 头部 ================= */

    function buildHead(win) {
        const rule = ruleOf(win);
        const host = win.host || win.initiator;
        headEl.innerHTML =
            `<span class="chain-ico">${rule ? rule.icon : '🔗'}</span>`
            + `<span class="chain-title">响应连锁</span>`
            + `<span class="chain-host">${host === 'self' ? '我方主持' : '对方主持'}</span>`
            + `<span class="chain-tp">${rule ? rule.label : ''}</span>`;

        // 折叠按钮：只留标题栏，方便看手牌与战场
        const foldBtn = document.createElement('button');
        foldBtn.type = 'button';
        foldBtn.className = 'chain-fold';
        foldBtn.title = collapsed ? '展开面板' : '折叠面板（方便看手牌与战场）';
        foldBtn.textContent = collapsed ? '▸' : '▾';
        foldBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setCollapsed(!collapsed);
            // 立刻重画头部（切换图标）
            if (headEl && headEl.contains(foldBtn)) {
                foldBtn.textContent = collapsed ? '▸' : '▾';
                foldBtn.title = collapsed ? '展开面板' : '折叠面板（方便看手牌与战场）';
            }
            if (collapsed && global.TargetSelector) global.TargetSelector.end();
        });
        headEl.appendChild(foldBtn);

        // ✕ 兜底关闭：有未处理序列时默认不许关（需二次确认强制结束）
        const remain = (win.links || []).length;
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'chain-close';
        closeBtn.title = remain > 0
            ? `还有 ${remain} 个序列未处理（全部处理完才会自动结束）`
            : '结束连锁（双方一起关闭）';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (remain > 0) {
                // 未处理完：必须二次确认，否则提示（避免两边进度不一致）
                const okForce = typeof global.confirm === 'function'
                    ? global.confirm(`还有 ${remain} 个序列未处理完，确定要强制结束响应连锁吗？`)
                    : false;
                if (!okForce) {
                    if (global.UI && global.UI.showNotification) {
                        global.UI.showNotification(`还有 ${remain} 个序列未处理完，全部处理完会自动关闭`, 'warning');
                    }
                    return;
                }
            }
            global.ChainManager.forceClose('manual');
        });
        headEl.appendChild(closeBtn);
    }

    /* ================= 序列链 ================= */

    function actorChip(side) {
        const cls = side === 'self' ? 'chip-self' : 'chip-opp';
        return `<span class="chain-actor ${cls}">${side === 'self' ? '我方' : '对方'}</span>`;
    }

    /**
     * ★盖伏的牌：对方只该看到「牌背」（翻盖时点尤其重要 ✓）
     *   本地视角里 actor !== 'self' ⇒ 这段链是【对方】发起的 → 隐藏正面信息 ✓
     *   判据是快照上的 hideFront（由 ChainManager.cardSnapshot 按"是不是盖伏登场"决定 ✓）：
     *   · 从手牌翻盖到战场（盖伏登场）→ hideFront=true → 对方只看到牌背 ✓
     *   · 场上翻盖（正面盖下去 / 从反面翻到正面）→ hideFront=false → 对方看得到正面详情 ✓
     *   （出网时 ChainManager.outboundCard 已把 hideFront 的卡抹成牌背信息，这里是第二道保险 ✓）
     */
    function shouldHideCardFront(card, actor) {
        return !!(card && card.hideFront && actor !== 'self');
    }

    /**
     * 这一行到底该不该画「牌背」（= shouldHideCardFront 的兜底版，面板实际用它 ✓）
     *   兜底：快照被抹过（无卡名、无 cardId）而本端又没有完整数据可回填时
     *         （例如本端窗口曾被强制关闭，只能采用对方那份）→ 也画牌背，
     *         总比画一张空白卡强 ✓
     */
    function shouldRenderCardBack(card, actor) {
        if (!card) return false;
        if (shouldHideCardFront(card, actor)) return true;
        return !!card.hideFront && !card.name && !card.cardId;
    }

    /** 目标名（统一走 ChainTarget.label：优先读战场上的卡名，找不到就按"我方/对方卡牌"） */
    function targetLabel(t) {
        return global.ChainTarget ? global.ChainTarget.label(t) : (t ? t.key : '');
    }

    function buildLinks(win) {
        listEl.innerHTML = '';
        const R = global.ChainRules;
        const focus = focusSeq(win);
        const resolving = win.phase === 'resolving';

        (win.links || []).forEach(link => {
            const rule = R ? R.get(link.timePoint) : null;
            const card = link.card;
            const isResolving = resolving && link.seq === win.resolveSeq;

            const row = document.createElement('div');
            row.className = 'chain-link'
                + (link.seq === focus ? ' is-latest' : '')
                + (isResolving ? ' is-resolving' : '')
                + (resolving && !isResolving ? ' is-dimmed' : '')
                + (link.kind === 'block' ? ' is-block' : '');
            row.dataset.seq = String(link.seq);        // 箭头层按 data-seq 定位源卡面

            const top = document.createElement('div');
            top.className = 'chain-link-top';
            top.innerHTML = `<span class="chain-seq">序列 ${link.seq}</span>`
                + (isResolving ? '<span class="chain-resolve-tag">处理中</span>' : '')
                + actorChip(link.actor);
            row.appendChild(top);

            const desc = document.createElement('div');
            desc.className = 'chain-link-desc';
            desc.textContent = link.desc || (rule ? rule.summary : '');
            row.appendChild(desc);

            if (card) {
                const box = document.createElement('div');
                box.className = 'chain-card-box';

                // ★盖伏的牌：对方视角只画牌背（见 shouldRenderCardBack 说明 ✓）
                const hideFront = shouldRenderCardBack(card, link.actor);

                // 优先用卡库里的完整卡牌数据（含颜色条件 / 系列 / 世界观），
                // 卡面本体复用 CardDetailUI.createDetailCard → 与悬浮详情规格完全一致
                const data = hideFront
                    ? { faceDown: true }        // 只给"盖着"这个事实，其余一概不给 ✓
                    : ((global.CardLibrary && card.cardId
                        && global.CardLibrary.getCardById(card.cardId)) || card);

                let cardEl = null;
                if (hideFront) {
                    cardEl = global.CardUI
                        ? global.CardUI.createCardElement(data, true, 'chain-card')     // 牌背 ✓
                        : document.createElement('div');
                } else if (global.CardDetailUI && global.CardDetailUI.createDetailCard) {
                    cardEl = global.CardDetailUI.createDetailCard(data, {
                        currentAttack: card.attack,
                        currentDefense: card.defense
                    });
                }
                if (!cardEl) {
                    cardEl = global.CardUI
                        ? global.CardUI.createCardElement(data, !!hideFront, 'chain-card')
                        : document.createElement('div');
                }

                cardEl.classList.add('chain-card');
                if (link.seq === focus) cardEl.dataset.latest = '1';   // 焦点序列（处理阶段=正在处理的那段）
                box.appendChild(cardEl);

                if (hideFront) {
                    const note = document.createElement('div');
                    note.className = 'chain-card-note';
                    note.textContent = (link.actor === 'self')
                        ? '盖伏的卡牌'
                        : '对方盖伏的卡牌（正面信息不可见）';
                    box.appendChild(note);
                }
                row.appendChild(box);
            }

            if (link.targets && link.targets.length) {
                const tg = document.createElement('div');
                tg.className = 'chain-targets';
                tg.textContent = '目标：' + link.targets.map(targetLabel).join('、');
                row.appendChild(tg);
            }

            listEl.appendChild(row);
        });

        // 追加新段后自动滚到最新
        requestAnimationFrame(() => { listEl.scrollTop = listEl.scrollHeight; });
    }
    /* ================= 底部：状态 + 按钮 ================= */

    function makeBtn(label, kind, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chain-btn chain-btn-' + (kind || 'ghost');
        btn.textContent = label;
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return btn;
    }

    function buildRespondRow() {
        const wrap = document.createElement('div');
        wrap.className = 'chain-btn-col';

        const tip = document.createElement('div');
        tip.className = 'chain-hint';
        tip.textContent = '选择响应方式（之后由对方继续决定）';
        wrap.appendChild(tip);

        const row = document.createElement('div');
        row.className = 'chain-btn-row';
        row.append(
            makeBtn('发动战术牌', 'primary', () => startRespond('tactic')),
            makeBtn('随从发动效果', 'primary', () => startRespond('minionEffect'))
        );
        wrap.appendChild(row);

        const back = document.createElement('div');
        back.className = 'chain-btn-row';
        back.appendChild(makeBtn('返回', 'ghost', () => {
            respondRowVisible = false;
            lastSignature = '';
            render(global.ChainManager.getWindow());
        }));
        wrap.appendChild(back);
        return wrap;
    }

    function buildFooter(win) {
        const rule = activeRule(win) || ruleOf(win);      // 目标提示按"当前活跃链段"的规则
        const awaiting = win.status === 'awaiting';
        const myDecide = awaiting && win.decideSide === 'self' && win.phase === 'deciding';
        const myTargeting = awaiting && win.activeSide === 'self' && win.phase === 'targeting';
        const rlink = resolvingLink(win);                  // 处理阶段：当前正在处理的序列
        const myResolve = !!rlink && rlink.actor === 'self' && awaiting;   // 该序列是不是我发的
        const left = (win.links || []).length;

        // 状态文案（等待方呼吸闪烁，更醒目）
        let text;
        if (myTargeting) text = '请点击战场上的目标，选好后点「确认选择」';
        else if (myResolve) text = `执行「序列 ${rlink.seq}」的效果，完成后点「处理」（还剩 ${left} 段）`;
        else if (rlink) text = `等待对方处理「序列 ${rlink.seq}」…（还剩 ${left} 段）`;
        else if (myDecide) text = '轮到你决定：响应 / 略过';
        else if (win.phase === 'targeting') text = '对方正在选择目标…';
        else if (win.decideSide === 'self') text = '等待你的响应…';
        else text = '等待对方行动…';
        statusEl.textContent = text;
        statusEl.classList.toggle('breathing', !myDecide && !myTargeting && !myResolve);

        btnsEl.innerHTML = '';

        // ---- 处理阶段：由「序列值最大」的发动者逐个点「处理」销毁序列 ----
        if (rlink) {
            if (!myResolve) return;                      // 等待方：只显示状态文字
            const hint = document.createElement('div');
            hint.className = 'chain-hint';
            hint.textContent = '效果已在棋盘上结算完毕 → 点「处理」销毁该序列（其箭头同时消失），回到上一个序列';
            btnsEl.appendChild(hint);

            const row = document.createElement('div');
            row.className = 'chain-btn-row';
            row.appendChild(makeBtn('处理', 'primary', () => global.ChainManager.resolveLocal()));
            btnsEl.appendChild(row);
            return;
        }

        if (myTargeting) {
            const hint = document.createElement('div');
            hint.className = 'chain-hint';
            hint.textContent = (rule && rule.scopeHint) || '点击战场上的卡牌或头像选择目标（再点一次取消）';
            btnsEl.appendChild(hint);

            const row = document.createElement('div');
            row.className = 'chain-btn-row';
            row.append(
                makeBtn('选择目标', 'ghost', () => {
                    if (global.TargetSelector) {
                        global.TargetSelector.begin(activeTimePoint(win), win.activeSide, () => {
                            lastSignature = '';
                            render(global.ChainManager.getWindow());
                        });
                    }
                }),
                makeBtn('确认选择', 'primary', () => {
                    if (global.TargetSelector) global.TargetSelector.end();
                    global.ChainManager.confirmTargets();
                })
            );
            btnsEl.appendChild(row);
            return;
        }

        if (!myDecide) return;                       // 等待方：只显示状态文字

        if (respondRowVisible) {
            btnsEl.appendChild(buildRespondRow());
            return;
        }

        const row = document.createElement('div');
        row.className = 'chain-btn-row';
        row.appendChild(makeBtn('响应', 'primary', () => {
            respondRowVisible = true;
            lastSignature = '';
            render(global.ChainManager.getWindow());
        }));
        row.appendChild(makeBtn('略过', 'ghost', () => global.ChainManager.passLocal()));
        if (win.allowBlock) {
            row.appendChild(makeBtn('阻挡', 'warn', () => startBlock(win)));
        }
        btnsEl.appendChild(row);
    }

    /* ================= 响应：选牌（复用现有检索/查阅面板） ================= */

    function isTactic(inst) {
        const d = inst && (inst.cardData || (global.CardLibrary && global.CardLibrary.getCardById(inst.cardId)));
        return !!(d && d.type === 'tactic');
    }

    function startRespond(kind) {
        const GS = global.GameState;
        const p = GS && GS.getPlayerState ? GS.getPlayerState('self') : null;
        if (!p) return;

        const list = kind === 'tactic'
            ? (p.hand || []).filter(c => c && isTactic(c))
            : (p.frontField || []).filter(Boolean);

        if (!list.length) {
            if (global.UI && global.UI.showNotification) {
                global.UI.showNotification(kind === 'tactic' ? '手牌里没有战术牌' : '前场没有可发动效果的随从', 'warning');
            }
            return;
        }
        if (!global.ViewerUI) return;

        global.ViewerUI.show(
            list,
            kind === 'tactic' ? '选择要发动的战术牌' : '选择要发动效果的随从',
            (instance) => { global.ChainManager.respondLocal(kind, instance); },
            { icon: '✨', hint: 'Esc 取消' }
        );
    }

    function startBlock(win) {
        if (!global.TargetSelector) return;
        global.TargetSelector.begin('BLOCK_DECLARE', 'self', () => {
            lastSignature = '';
            render(global.ChainManager.getWindow());
        }, (target) => {
            global.ChainManager.declareBlockLocal(target.instanceId);
        });
    }
    /* ================= 指向箭头 ================= */
    // 面板只负责"要画哪些箭头"（语义数据）；"怎么在 DOM 里找到锚点"全部交给
    // ChainTarget / ChainArrows，避免选择器字符串散落多处。

    /**
     * 每段序列 ⇒ 箭头项：
     *   { color, opacity, fromSeq, target }        普通目标
     *   { color:'yellow', fromSeq, blockedBy… }    被阻挡的攻击（改指阻挡者）
     * 箭头层每帧都会重新解析锚点 → 卡牌被拖动 / 战场重渲染都会自动跟随。
     */
    function updateArrows(win) {
        if (!global.ChainArrows) return;
        if (!win) { global.ChainArrows.clear(); return; }

        const links = win.links || [];
        const focus = focusSeq(win);                    // 处理阶段=正在处理的序列；否则=最后发动的那段
        const items = [];

        links.forEach(link => {
            const opacity = link.seq === focus ? 1 : 0.35;         // 焦点序列最亮，其余淡显
            const color = link.actor === 'self' ? 'self' : 'opponent';   // 颜色按发动方区分

            // 被阻挡的攻击：转黄并改指阻挡者
            if (link.blocked && link.blockedBy) {
                items.push({
                    color: 'yellow',
                    opacity: 1,
                    fromSeq: link.seq,
                    target: { type: 'card', instanceId: link.blockedBy, side: link.blockedBySide || 'self' }
                });
            }

            (link.targets || []).forEach(t => {
                items.push({ color, opacity, fromSeq: link.seq, target: t });
            });
        });

        global.ChainArrows.setArrows(items);
    }

    /** 供外部（如目标选择器）立即刷新箭头，不必等整块重渲染 */
    function refreshArrows() {
        updateArrows(global.ChainManager && global.ChainManager.getWindow
            ? global.ChainManager.getWindow() : null);
    }

    /* ================= 初始化 ================= */

    function init() {
        if (!global.ChainManager) {
            console.warn('[ChainPanelUI] ChainManager 未加载，面板停用');
            return false;
        }
        global.ChainManager.subscribe(win => {
            try {
                if (!win) { hidePanel(); return; }
                if (win.id !== lastWinId) {      // 换了一个新窗口 → 复位交互态
                    lastWinId = win.id;
                    respondRowVisible = false;
                    lastSignature = '';
                }
                render(win);
            } catch (e) {
                console.error('[ChainPanelUI] 渲染异常（已忽略，不影响对局）', e);
            }
        });
        return true;
    }

    global.ChainPanelUI = { init, render, hidePanel, refreshArrows, shouldHideCardFront, shouldRenderCardBack };
})(window);
