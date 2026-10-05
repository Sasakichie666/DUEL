// js/ui/diagUI.js
// 连接自检面板：一键跑完 Network.selfCheck()，把结果放进"可一键复制"的文本框。
// 目的：连不上时，让对方不用会开控制台 —— 点一下按钮、复制、发过来即可。
// 纯诊断工具，不参与任何游戏逻辑；依赖缺失时静默降级。

(function(global) {
    let built = false;
    let running = false;
    let els = {};

    function build() {
        if (built) return;
        built = true;

        const overlay = document.createElement('div');
        overlay.className = 'diag-overlay';
        overlay.style.display = 'none';
        overlay.innerHTML = ''
            + '<div class="diag-modal">'
            + '  <div class="diag-head">'
            + '    <span class="diag-title">🩺 连接自检</span>'
            + '    <button class="diag-x" type="button" title="关闭">✕</button>'
            + '  </div>'
            + '  <div class="diag-tip">把下面这段报告复制发给对方（或截图），就能定位是「信令不通」「NAT 打不通」还是「防火墙/IPv6」问题。'
            + '<br>虚拟局域网（蒲公英 / Tailscale）联机前，先点「🔧 允许暴露内网 IP」—— 浏览器默认会把内网地址藏起来，那样组网软件给的虚拟网卡就用不上。</div>'
            + '  <textarea class="diag-report" readonly spellcheck="false"></textarea>'
            + '  <div class="diag-foot">'
            + '    <button class="btn diag-btn" type="button" data-act="run">🔍 重新自检</button>'
            + '    <button class="btn diag-btn diag-btn-warn" type="button" data-act="expose" title="申请一次麦克风权限（申请后立刻释放，不录音、不上传），让浏览器暴露真实内网 IP，并自动重跑 ICE 自检验证">🔧 允许暴露内网 IP</button>'
            + '    <button class="btn btn-success diag-btn" type="button" data-act="copy">📋 复制报告</button>'
            + '    <button class="btn diag-btn" type="button" data-act="close">关闭</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(overlay);

        els = {
            overlay,
            report: overlay.querySelector('.diag-report'),
            runBtn: overlay.querySelector('[data-act="run"]'),
            exposeBtn: overlay.querySelector('[data-act="expose"]')
        };

        overlay.querySelector('[data-act="close"]').addEventListener('click', close);
        overlay.querySelector('.diag-x').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('[data-act="copy"]').addEventListener('click', copyReport);
        els.runBtn.addEventListener('click', () => run(true));
        els.exposeBtn.addEventListener('click', exposeLocalIps);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && els.overlay.style.display !== 'none') close();
        });
    }

    function setText(text) {
        if (els.report) els.report.value = text;
    }

    function open() {
        build();
        els.overlay.style.display = 'flex';
    }

    function close() {
        if (built) els.overlay.style.display = 'none';
    }

    /** 跑一次自检（force=true 表示用户手动点的：即使已有结果也重跑） */
    async function run(force) {
        build();
        const Network = global.Network;
        if (running) return;
        if (!Network || !Network.selfCheck) {
            setText('联机模块未加载（js/network.js 缺失或报错），无法自检。');
            return;
        }
        if (els.report.value && !force) return;   // 已有结果就不重复跑（省时间）
        running = true;
        if (els.runBtn) els.runBtn.disabled = true;
        setText('正在自检…（信令实测最多 6 秒，ICE 候选最多 6 秒，请稍候）');
        try {
            const report = await Network.selfCheck();
            setText(report);
            console.log(report);
        } catch (e) {
            setText('自检出错：' + (e && e.message) + '\n' + (e && e.stack ? e.stack : ''));
        } finally {
            running = false;
            if (els.runBtn) els.runBtn.disabled = false;
        }
    }

    /**
     * 「允许暴露内网 IP」：申请一次麦克风权限（立即释放）→ 让浏览器不再把内网 IP 藏成 .local
     * → 虚拟局域网（蒲公英/Tailscale）的虚拟网卡才能被 ICE 用上 → 自动重跑 ICE 自检验证。
     */
    async function exposeLocalIps() {
        build();
        const Network = global.Network;
        if (running) return;
        if (!Network || !Network.enableLocalIpExposure) {
            setText('联机模块未加载或版本过旧（缺少 enableLocalIpExposure），请按 Ctrl+F5 强制刷新页面。');
            return;
        }
        running = true;
        if (els.exposeBtn) els.exposeBtn.disabled = true;
        setText('正在申请一次麦克风权限（浏览器会弹窗，点「允许」即可；申请后立刻释放，不会录音、不会上传）…');
        try {
            const r = await Network.enableLocalIpExposure();
            setText([
                '=== 允许暴露内网 IP ===',
                r.reason || '(无说明)',
                r.ok ? '' : '（仍可使用备用方案：chrome://flags/#enable-webrtc-hide-local-ips-with-mdns → Disabled → 重启浏览器）',
                '',
                r.report || '（未能重跑 ICE 自检）',
                '',
                '提示：点「🔍 重新自检」可拿到包含信令实测与连接路径的完整报告。'
            ].join('\n'));
            if (global.UI) {
                global.UI.showNotification(r.ok ? ('🔧 ' + r.reason) : ('⚠️ ' + r.reason), r.ok ? 'success' : 'warning', 8000);
            }
        } catch (e) {
            setText('执行出错：' + (e && e.message));
        } finally {
            running = false;
            if (els.exposeBtn) els.exposeBtn.disabled = false;
        }
    }

    function copyReport() {
        build();
        const text = els.report ? els.report.value : '';
        if (!text) { if (global.UI) global.UI.showNotification('还没有自检结果，先点「重新自检」', 'warning'); return; }
        const done = () => {
            if (global.UI) global.UI.showNotification('📋 报告已复制，粘贴发给对方即可', 'success');
        };
        // file:// 打开时剪贴板 API 常常不可用 → 退回到"选中 + execCommand"
        if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
            global.navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        } else {
            fallbackCopy(text, done);
        }
    }

    function fallbackCopy(text, done) {
        try {
            const ta = els.report;
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, text.length);
            const ok = document.execCommand && document.execCommand('copy');
            if (ok) done();
            else if (global.UI) global.UI.showNotification('复制失败：请手动全选文本框（Ctrl+A）再复制', 'warning', 5000);
        } catch (e) {
            if (global.UI) global.UI.showNotification('复制失败：请手动全选文本框（Ctrl+A）再复制', 'warning', 5000);
        }
    }

    function init() {
        build();
        const btn = document.getElementById('btnDiag');
        if (btn) {
            btn.addEventListener('click', () => { open(); run(false); });
        }
    }

    global.DiagUI = { init, open, close, run, copyReport, exposeLocalIps };
})(window);
