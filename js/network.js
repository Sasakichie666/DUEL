// js/network.js
// ============ 局域网联机框架（1.2 精简版）============
// 定位：本项目的最优联机方式是【用组网软件把两台机器放进同一局域网】——
//       例如 UU加速器的「UU联机」、蒲公英、Tailscale、ZeroTier，或干脆同一个 WiFi。
//       局域网内 WebRTC 直接走【本机网卡地址（host 候选）】，不经过任何 NAT。
//
// 为什么不需要 P2P 打洞 / STUN / TURN：
//   · 对称型 NAT（很多运营商宽带 / 手机热点）下 IPv4 打洞 100% 不可能成功 ✗
//   · 组网软件给每台机器一张虚拟网卡 → 浏览器把它当"同网段地址"收集为 host 候选
//     → 两台机器 host↔host 直连 ✓（已实测可用 ✓）
//   · 所以：不配 STUN、不配 TURN、不做打洞 —— 要么秒连，要么秒失败并说清原因 ✓
//
// 仍然必须保留的东西（这些不是"打洞"，而是连接本身）：
//   · PeerJS（WebRTC DataChannel）：浏览器之间传数据的唯一途径，局域网直连也靠它 ✓
//   · 信令服务器：只交换一次连接信息（默认公共云；也可用 ?peerhost= 指向自建服务器，完全本地化）
//   · 「允许暴露内网 IP」（面板上的按钮）：组网软件给的是内网地址，浏览器默认会把它藏成 xxxx.local ✗
//     而多数组网软件不转发组播 → 藏起来就用不了 → 这是局域网联机的**关键一步** ✓
//
// 自检：Network.diagnose() / Network.testIce() / 界面上的「🩺 连接自检」按钮

(function(global) {
    const DEFAULT_TIMEOUT_MS = 15000;   // 信令超时（超过就明确报错，而不是一直转圈）
    const P2P_TIMEOUT_MS = 30000;       // 数据通道兜底超时：正常情况下由 ICE 报 failed 立即失败

    // ★刻意留空：局域网联机只用 host 候选。
    //   若将来真需要公网中继，把 TURN 配置塞进这里即可（形如 { urls: 'turn:host:3478', username: 'u', credential: 'p' }）
    const ICE_SERVERS = [];

    /**
     * 用 URL 参数指定"自己的信令服务器"（免改代码，方便现场排障）：
     *   ?peerhost=192.168.1.5&peerport=9000&peerpath=/&peerkey=peerjs
     * 自建信令（同一局域网下最稳，甚至可以不需要外网）：任一台机器执行
     *   npx peerjs --port 9000 --path /
     * 然后两边都打开 index.html?peerhost=<那台机器的局域网 / 虚拟网卡 IP>&peerport=9000
     */
    function urlParams() {
        const q = (global.location && global.location.search) || '';
        if (!q) return null;
        try {
            return new URLSearchParams(q);
        } catch (e) {
            return null;
        }
    }

    function signalingOptionsFromUrl() {
        const p = urlParams();
        if (!p) return null;
        const host = p.get('peerhost');
        if (!host) return null;
        return {
            host,
            port: Number(p.get('peerport')) || 9000,
            path: p.get('peerpath') || '/',
            key: p.get('peerkey') || 'peerjs',
            secure: p.get('peersecure') === '1'
        };
    }

    /** 当前使用的 ICE 服务器（局域网框架下刻意为空 —— 只用 host 候选，不打洞） */
    function iceServers() {
        return ICE_SERVERS.slice();
    }

    function peerOptions() {
        const opts = {
            config: { iceServers: iceServers() },
            debug: Number(global.PEER_DEBUG) || 1        // 控制台想看细节：设置 window.PEER_DEBUG = 3
        };
        const custom = signalingOptionsFromUrl();
        if (custom) {
            Object.assign(opts, custom);
            console.log('[联机] 使用自定义信令服务器：' + custom.host + ':' + custom.port + custom.path);
        }
        return opts;
    }

    let peer = null;
    let conn = null;
    let isHost = false;
    let isJoined = false;
    let roomCode = null;
    let isReady = false;
    let opponentReady = false;
    let myDeckReady = false; // 这个由外部更新
    let myPeerId = null;     // 本机在信令服务器上的真实 ID（可能被服务器加后缀，以它为准）
    let joining = false;     // 加入流程进行中（防连点 / 防重复建房）
    let signalingLost = false; // 是否正处于"与信令服务器断开"状态（界面要能看见）
    let signalingOpen = false; // 信令 WebSocket 当前是否在线（决定能不能再发起 connect）
    let joinSession = null;  // 当前一次 connect 尝试（用于把 peer 层的 peer-unavailable 转成 Promise 失败）
    let signalingReconnecting = false; // 掉线后是否已尝试过一次重连（局域网框架下只试一次，不搞长循环）
    let lastPath = null;     // 最近一次连接实际走的路径（诊断用，见 describeActivePath）
    let lastIceSummary = null; // 最近一次 ICE 自检的关键结论（mDNS 隐藏数 / 内网地址 / IPv6 数），供 diagnose 复用

    const MAX_ID_ATTEMPTS = 5;     // 【建房时】房间号被占用时最多换几次号
    // 客人重试：局域网联机下失败几乎都是瞬时的（房间号打错/房主没建好），
    // 所以只快速试 3 次（≈4.5 秒），不再像以前那样拖 33 秒 ✗→✓
    const JOIN_RETRY_DELAYS_MS = [1500, 1500, 1500];
    const MAX_JOIN_ATTEMPTS = JOIN_RETRY_DELAYS_MS.length;
    const SIGNALING_REWAIT_MS = 8000;   // 等信令恢复的最长时间（局域网内通常瞬时）
    const SIGNALING_RECONNECT_WAIT_MS = 5000; // 掉线后"重连一次"的观察窗口
    const PEERJS_VERSION = '1.5.1';     // 仅用于自检 URL 的 version 参数（与 js/lib 内的版本一致）

    function connTimeoutMs() {
        return Number(global.PEER_CONNECT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    }

    function p2pTimeoutMs() {
        return Number(global.PEER_P2P_TIMEOUT_MS) || P2P_TIMEOUT_MS;
    }

    function joinRetryDelayMs(attempt) {
        const base = JOIN_RETRY_DELAYS_MS[attempt - 1] || JOIN_RETRY_DELAYS_MS[JOIN_RETRY_DELAYS_MS.length - 1];
        const scale = Number(global.PEER_JOIN_RETRY_SCALE) || 1;   // 测试用：整体缩短等待
        return Math.max(1, Math.round(base * scale));
    }

    function sleep(ms) {
        return new Promise(resolve => global.setTimeout(resolve, ms));
    }

    /** 等 peer 的信令连接重新打开（open 事件 + 轮询双保险） */
    function waitSignalingOpen(p, ms) {
        return new Promise(resolve => {
            if (!p) return resolve(false);
            if (p.open) return resolve(true);
            let done = false;
            const finish = (v) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                clearInterval(iv);
                try { p.removeListener('open', onOpen); } catch (e) { /* 忽略 */ }
                resolve(v);
            };
            const onOpen = () => finish(true);
            const timer = global.setTimeout(() => finish(!!p.open), ms);
            const iv = global.setInterval(() => { if (p.open) finish(true); }, 150);
            try { p.on('open', onOpen); } catch (e) { /* 忽略 */ }
        });
    }

    /**
     * 等信令连接可用（只等，不折腾）。
     * ★局域网框架下不做"反复踢 reconnect"那套：信令通常是瞬时问题，
     *   等一会儿没好就直接让用户重新点「加入/创建房间」更干脆 ✗→✓
     */
    async function ensureSignaling(p, waitMs) {
        if (!p) return false;
        if (signalingOpen || p.open) return true;
        return waitSignalingOpen(p, waitMs || SIGNALING_REWAIT_MS);
    }

    // 回调函数（由main.js注册）
    let callbacks = {
        onStatusChange: () => {},
        onMessage: () => {},
        onConnectionChange: () => {},
    };

    function setCallbacks(cb) {
        callbacks = { ...callbacks, ...cb };
    }

    /* ================= 连接超时 / 库加载检查（避免"永远连接中"） ================= */

    let connectTimer = 0;
    let cancelIceWatch = null;   // 取消"监听 ICE failed"的句柄
    let p2pFailToken = 0;        // 本次握手的令牌：防止"ICE failed"和"兜底超时"重复触发失败流程

    function clearConnectTimeout() {
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = 0; }
        if (cancelIceWatch) { try { cancelIceWatch(); } catch (e) { /* 忽略 */ } cancelIceWatch = null; }
        p2pFailToken++;            // 作废：之后迟到的失败回调一律忽略
    }

    /**
     * 监听底层 RTCPeerConnection 的 ICE 状态：一旦变成 failed 就立刻判定"这条路走不通"。
     * ★为什么需要它：对称型 NAT 打不通时，ICE 一般 5~8 秒内就会自己报 failed；
     *   以前我们用一个固定超时（10s）去等，既慢又容易误杀慢但在成功的连接 ✗
     */
    function watchIceFailure(pc, onFailed) {
        if (!pc || typeof pc.addEventListener !== 'function') return function () { };
        let fired = false;
        const check = () => {
            if (fired) return;
            const st = pc.iceConnectionState;
            if (st === 'failed') {
                fired = true;
                try { onFailed(st); } catch (e) { /* 忽略 */ }
            }
        };
        try { pc.addEventListener('iceconnectionstatechange', check); } catch (e) { /* 忽略 */ }
        setTimeout(check, 0);      // 挂上时也看一眼当前状态
        return function () {
            try { pc.removeEventListener('iceconnectionstatechange', check); } catch (e) { /* 忽略 */ }
        };
    }

    /** 连接失败的排查指引（控制台输出，界面只给一句简短提示）——局域网版 */
    function logConnectGuide(stage) {
        console.error('[Network] 连接失败：' + stage
            + '\n本框架走"局域网直连"，所以只有两种情况：'
            + '\n  ① 信令没接上（连房间号都找不到）→ 检查外网；控制台若出现 "Lost connection to server." '
            + '就是信令掉线（保持页面在前台即可，程序会自动重连一次）'
            + '\n  ② 信令没问题但连不上 → 两台机器不在同一局域网 ✗ 处理：'
            + '\n     · 用 UU加速器的「UU联机」/ 蒲公英 / Tailscale 组网，两台进同一个房间'
            + '\n     · ★两台都要点「🩺 连接自检」面板里的「🔧 允许暴露内网 IP」（否则虚拟网卡地址会被浏览器藏成 .local）'
            + '\n     · 重跑自检确认两边的【内网地址】在同一网段'
            + '\n  ③ 某一台电脑的防火墙 / 安全软件拦了 WebRTC 的 UDP → 把 Wi-Fi 设为"专用网络"、允许浏览器通过防火墙'
            + '\n  ④ 电脑上开着 VPN / 加速器（非组网模式）/ 代理，可能劫持流量 → 只保留组网软件'
            + '\n自查：Network.diagnose() + Network.testIce()，或点界面上的「🩺 连接自检」');
    }

    /** 失败时的"人话"建议（局域网框架只有一条主路线） */
    function failureAdvice() {
        return '本框架只走「局域网直连」，所以要先让两台机器在同一局域网：'
            + '\n  ① 用 UU加速器的「UU联机」/ 蒲公英 / Tailscale 组网（两台进同一房间）'
            + '\n  ② ★两台都点「🩺 连接自检」→「🔧 允许暴露内网 IP」'
            + '\n     （浏览器默认会把虚拟网卡地址藏成 xxxx.local，藏起来就用不了 ✗）'
            + '\n  ③ 重跑自检，确认两边的【内网地址】在同一网段（例如都在 172.16.0.0/24）后重新建房/加入'
            + '\n  ④ 嫌麻烦也可让房主执行 npx peerjs --port 9000 --path /，用 ?peerhost= 走自建信令（更稳）';
    }

    /** P2P 握手失败（ICE failed / 兜底超时）→ 记录路径 + 明确提示 + 复位 */
    async function failP2PConnect(token, stage, why) {
        if (token !== p2pFailToken) return;     // 这次握手早已结束（连上了 / 已被重置）
        if (conn && conn.open) return;          // 已经连上了
        clearConnectTimeout();                  // 顺手让 token 作废，避免 ICE failed 与超时重复触发
        await noteActivePath(why || '连接失败');  // 先记录"卡在哪条路"，复位后就取不到 stats 了
        logConnectGuide(stage);
        callbacks.onStatusChange({
            type: 'error',
            message: '⏱️ ' + (why || '连接失败') + '：' + stage + '\n' + failureAdvice()
        });
        resetConnection();
    }

    /**
     * 给一次 P2P 握手装上"失败判定"：
     *   ① ICE 自己报 failed → 立即失败（对称 NAT 打不通时通常 5~8 秒内就会 failed ✓）
     *   ② 兜底超时 30 秒（只作保险，不再像以前那样 10 秒就误杀"慢但在成功"的连接 ✗）
     */
    function armConnectTimeout(stage, pc) {
        clearConnectTimeout();
        const token = p2pFailToken;             // clearConnectTimeout 已自增 → 这就是本次握手的令牌
        if (pc) {
            cancelIceWatch = watchIceFailure(pc, () => failP2PConnect(token, stage, 'ICE 失败（两端网络无法直连）'));
        }
        connectTimer = global.setTimeout(function () {
            failP2PConnect(token, stage, '连接超时');
        }, p2pTimeoutMs());
    }

    /**
     * 信令掉线：提示一次 + 只尝试重连一次（局域网框架，不再搞"抢号长循环"）。
     *
     * ★为什么不能在这里直接 reconnect()（PeerJS 的坑）：
     *   意外掉线时 PeerJS 的顺序是 → emit('error','Lost connection to server.') 然后才 this.disconnect()；
     *   而 Peer.reconnect() 开头是 `if (this.disconnected && !this.destroyed)` ——
     *   在 error 那一刻 disconnected 还是 false，reconnect() 是**空操作** ✗。
     *   所以真正的重连必须放在 'disconnected' 事件里（那时 disconnected 才为 true）✓
     */
    function markSignalingLost(peerRef, why) {
        signalingOpen = false;
        if (signalingLost) return;                              // 已经在掉线状态，不重复提示
        signalingLost = true;
        callbacks.onStatusChange({ type: 'signaling_lost', message: why || '与信令服务器断开，正在重连…' });
    }

    /**
     * 掉线后只重连一次：等最多 5 秒；成功就继续用（房间号不变 ✓），
     * 失败就明确告诉用户"重新点一次加入/创建房间"——比无限重试更好懂 ✓
     */
    async function tryReconnectOnce(p) {
        if (!p || p !== peer || p.destroyed) return false;
        if (signalingReconnecting) return false;    // 已经在重连了
        signalingReconnecting = true;
        try {
            if (p.disconnected) {
                try { p.reconnect(); } catch (e) { /* 已销毁/已在重连，忽略 */ }
            }
            const okOpen = await waitSignalingOpen(p, SIGNALING_RECONNECT_WAIT_MS);
            if (p !== peer) return false;
            if (okOpen || p.open) {
                markSignalingOpen();
                return true;
            }
            callbacks.onStatusChange({
                type: 'signaling_failed',
                roomCode, peerId: myPeerId,
                message: '信令连接没能恢复：请关掉页面重开（或重新点「创建房间 / 加入」）。'
                    + '局域网联机下也可以让房主执行 npx peerjs --port 9000 --path / 改用自建信令（更稳）'
            });
            return false;
        } finally {
            signalingReconnecting = false;
        }
    }

    /** 信令恢复 */
    function markSignalingOpen() {
        signalingOpen = true;
        if (!signalingLost) return;
        signalingLost = false;
        // 只有房主才有"自己的房间号"；客人是随机 ID，别把随机串当成房间号报出来
        callbacks.onStatusChange({
            type: 'signaling_ok',
            roomCode, peerId: myPeerId,
            message: isHost
                ? ('已重新连上信令服务器（房间号 ' + (roomCode || String(myPeerId || '').replace(/^cardgame-/, '')) + ' 仍然有效）')
                : '已重新连上信令服务器'
        });
    }

    /**
     * 断线打断了"客人↔房主"的握手时调用：丢弃这个半成品连接，
     * 让上面重试流程去建一条全新的（否则会干等超时，日志里就会出现"先 socket-closed、15秒后又 P2P 超时"）。
     */
    function dropHalfBuiltConn() {
        if (!conn || conn.open) return;
        const dead = conn;
        conn = null;              // 旧连接对象的事件会被"代际校验"忽略
        clearConnectTimeout();    // 别再等这个注定失败的握手
        try { dead.close(); } catch (e) { /* 忽略：半成品连接直接关掉，不留在那儿挂着 */ }
    }

    /**
     * PeerJS 库是否加载成功（最常见的两个原因：① 复制项目时漏了 js/lib/peerjs.min.js
     * ② index.html 还是旧的 CDN 地址而 CDN 又不可达；另外浏览器缓存也会让改动不生效）
     */
    function peerLibMissing() {
        if (typeof Peer !== 'undefined') return false;
        const why = global.__peerjsLoadFailed
            ? '本地 js/lib/peerjs.min.js 不存在，且回退 CDN(unpkg.com) 也不可达'
            : '本地文件没找到（复制项目时可能漏了 js/lib 目录），或浏览器仍在用缓存的旧页面';
        const msg = '联机库 PeerJS 未加载：' + why
            + '。自查：按 F12 → Network 里搜 peerjs（看是 404 还是被拦截）；'
            + '确认 js/lib/peerjs.min.js 存在后按 Ctrl+F5 强制刷新';
        console.error('[Network] ' + msg);
        callbacks.onStatusChange({ type: 'error', message: msg });
        return true;
    }

    /**
     * 控制台排查：Network.testIce()
     * 列出本机能收集到的 ICE 候选 —— 局域网联机只关心 host 候选里有没有
     * 【内网地址（含组网软件的虚拟网卡）】和【IPv6】。
     */
    async function testIce() {
        if (!global.RTCPeerConnection) {
            const m = '本机浏览器不支持 WebRTC（或已被禁用）';
            console.error(m);
            return m;
        }
        const pc = new RTCPeerConnection({ iceServers: iceServers() });
        const found = { host: 0, srflx: 0, relay: 0, prflx: 0, other: 0 };
        const list = [];
        const cands = [];       // {type, addr, ipv6}
        const gathered = new Promise(resolve => {
            const t = global.setTimeout(resolve, 6000);
            pc.onicecandidate = e => {
                if (!e.candidate) { clearTimeout(t); resolve(); return; }
                const c = e.candidate;
                let type = 'other';
                if (/ typ host/.test(c.candidate)) type = 'host';
                else if (/ typ srflx/.test(c.candidate)) type = 'srflx';
                else if (/ typ relay/.test(c.candidate)) type = 'relay';
                else if (/ typ prflx/.test(c.candidate)) type = 'prflx';
                found[type]++;
                const addr = c.address || '';
                const ipv6 = addr.indexOf(':') >= 0;
                cands.push({ type, addr, ipv6 });
                list.push(type + '  ' + addr + ':' + (c.port || ''));
            };
        });
        try {
            pc.createDataChannel('probe');
            await pc.setLocalDescription(await pc.createOffer());
            await gathered;
        } catch (e) {
            console.error('[Network] ICE 自检出错：', e);
        }
        try { pc.close(); } catch (e) { /* 忽略 */ }

        const ipv6Count = cands.filter(c => c.ipv6).length;
        const mdns = cands.filter(c => /\.local$/i.test(c.addr));
        // 内网地址清单（虚拟局域网就是靠它直连的，必须看得见）
        const privateIps = [];
        const vpnLike = [];
        cands.forEach(c => {
            if (c.ipv6 || !c.addr || /\.local$/i.test(c.addr)) return;
            if (!/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(c.addr)) return;
            if (privateIps.indexOf(c.addr) === -1) privateIps.push(c.addr);
            // 已知组网软件的常见网段：Tailscale=100.64/10，蒲公英/ZeroTier 常用 172.16~172.31
            if (/^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])|172\.(1[6-9]|2\d|3[01]))\./.test(c.addr)) {
                if (vpnLike.indexOf(c.addr) === -1) vpnLike.push(c.addr);
            }
        });
        const privSubnets = [];
        cands.forEach(c => {
            if (c.ipv6) return;
            const m = c.addr.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
            if (!m) return;
            if (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(c.addr)) {
                if (privSubnets.indexOf(m[1]) === -1) privSubnets.push(m[1]);
            }
        });

        lastIceSummary = {
            at: Date.now(),
            mdnsCount: mdns.length,
            privateIps: privateIps.slice(),
            vpnLike: vpnLike.slice(),
            ipv6Count,
            host: found.host, srflx: found.srflx, relay: found.relay
        };

        const lines = [
            '=== ICE 候选自检 ===',
            '模式：局域网直连（只用本机网卡地址，不配 STUN/TURN、不做打洞）',
            `host(本机直连)=${found.host}   IPv6 候选=${ipv6Count}   （srflx=${found.srflx} / relay=${found.relay} 恒为 0，属正常）`
        ].concat(list.map(x => '  · ' + x));
        if (found.host === 0) lines.push('⚠️ 没有 host 候选：本机浏览器网络被禁/被安全软件拦截（局域网联机必须要有它）');

        /* ---- 虚拟局域网（蒲公英 / Tailscale / ZeroTier）判读 ---- */
        if (privateIps.length) {
            lines.push('✅ 能看到本机的内网地址：' + privateIps.join(' , ')
                + (vpnLike.length
                    ? ('\n   ⭐ 其中 ' + vpnLike.join(' , ') + ' 疑似虚拟局域网（Tailscale 用 100.64~100.127；蒲公英/ZeroTier 常用 172.16~172.31）'
                        + '\n   → 让两台机器各自看这份报告：如果**两边都出现同一个网段的地址**（例如都在 172.16.0.0/24），'
                        + '那它就是组网软件给的虚拟网卡 ✓ 走它就能 host↔host 直连（对称型 NAT 也拦不住，因为它俩已经"同网段"了）')
                    : ''));
        } else {
            lines.push('⚠️ 看不到任何内网 IP（上面只有 .local）：本机 IP 被浏览器的 mDNS 隐藏机制藏起来了。'
                + '\n   · 虚拟局域网（蒲公英 / Tailscale）**就是靠这张网卡直连的**，被藏起来就认不出来 ✗'
                + '\n   → 两种解法（任选其一，两台机器都要做）：'
                + '\n     ① 点「连接自检」面板里的「🔧 允许暴露内网 IP」按钮（申请一次麦克风权限，立即释放、不录音）'
                + '\n     ② chrome://flags/#enable-webrtc-hide-local-ips-with-mdns → 设为 Disabled → 重启浏览器');
        }
        if (mdns.length) {
            lines.push('ℹ️ 另有 ' + mdns.length + ' 个 mDNS 隐藏地址（xxxx-….local）：'
                + '它们要靠组播(UDP 5353)解析 ✗ 而多数虚拟局域网不转发组播（Tailscale 就不转发）'
                + '→ 所以别指望它，务必让上面出现真实内网 IP');
        }
        if (ipv6Count > 0) {
            lines.push('✅ 有 IPv6 候选：异地互联成功率最高的一条路（前提是对方也有 IPv6 且两边防火墙都放行入站）');
        } else {
            lines.push('⚠️ 没有 IPv6 候选：若双方 IPv4 都在运营商级 NAT（异地/双热点），基本无解 → 需要 TURN 或虚拟局域网');
        }
        if (privSubnets.length >= 3) {
            lines.push('ℹ️ 检测到多张网卡的网段（' + privSubnets.join(' , ') + '）：'
                + '可能装了 VMware/VirtualBox/Hyper-V/WSL/加速器虚拟网卡，'
                + '会让 ICE 选到不通的那张卡 → 临时禁用它们再试');
        }
        lines.push(found.relay === 0
            ? 'ℹ️ 没有 relay 候选：未配置 TURN；双方都在运营商级 NAT 后面时会连不上'
            : '✅ 有 relay 候选：TURN 可用，能穿透绝大多数网络');
        const report = lines.join('\n');
        console.log(report);
        return report;
    }

    /* ================= 连接路径可视化（诊断"到底走的哪条路"） ================= */

    function addrFamily(addr) {
        if (!addr) return '';
        return String(addr).indexOf(':') >= 0 ? 'IPv6' : 'IPv4';
    }

    /**
     * 从 getStats() 里读出"本次连接实际用的是哪一对候选"。
     * ★这是判断"为什么某台机器连不上"最有力的证据：
     *   成功走的哪条路（IPv6 直连 / IPv4 打洞 / 同网段 / TURN 中继）、
     *   失败时候选对都停在什么状态（全是 failed → 打洞失败）。
     */
    /**
     * 从 SDP 里解析候选。
     * 为什么要这么做：新版 Chromium 的 getStats() 候选对象里**不再给 address**（会打印成空 ✗），
     * 而 SDP 的 a=candidate 行仍然带着完整地址 → 用「端口(+类型)」回填，
     * 这样"本机/对方走的是哪张网卡、是 IPv4 还是 IPv6、是不是 .local"才看得出来。
     */
    function sdpCandidates(sdp) {
        const out = [];
        if (!sdp) return out;
        String(sdp).split(/\r?\n/).forEach(line => {
            const m = line.match(/^a=candidate:\S+\s+\d+\s+(udp|tcp)\s+\d+\s+(\S+)\s+(\d+)\s+typ\s+(\w+)/i);
            if (!m) return;
            out.push({
                proto: m[1].toUpperCase(),
                addr: m[2],
                port: Number(m[3]),
                type: m[4].toLowerCase()
            });
        });
        return out;
    }

    /** 候选的人类可读文本（地址取不到时至少给出 类型/协议:端口，不留空白） */
    function candText(c) {
        if (!c) return '?';
        const proto = c.proto || '?';
        const port = c.port ? (':' + c.port) : '';
        if (!c.addr) return c.type + '/' + proto + port;
        const tag = /\.local$/i.test(c.addr) ? '（mDNS隐藏）' : '';
        return c.type + '/' + proto + ' ' + c.addr + port + tag;
    }

    async function describeActivePath(pc) {
        if (!pc || typeof pc.getStats !== 'function') return null;
        let stats = null;
        try { stats = await pc.getStats(); } catch (e) { return null; }
        if (!stats) return null;

        const byId = new Map();
        const pairs = [];
        const eat = (r) => {
            if (!r || !r.id) return;
            byId.set(r.id, r);
            if (r.type === 'candidate-pair') pairs.push(r);
        };
        try {
            if (typeof stats.forEach === 'function') stats.forEach(eat);
            else if (Array.isArray(stats)) stats.forEach(eat);
        } catch (e) { /* 忽略 */ }

        // SDP 兜底（stats 里没地址时用）
        const localSdp = sdpCandidates(pc.localDescription && pc.localDescription.sdp);
        const remoteSdp = sdpCandidates(pc.remoteDescription && pc.remoteDescription.sdp);
        const lookSdp = (list, c) => {
            if (!c || !list.length) return null;
            return list.find(x => x.port === c.port && x.type === c.type && (!c.proto || x.proto === c.proto))
                || list.find(x => x.port === c.port)
                || null;
        };

        const pickCand = (id, isLocal) => {
            const c = byId.get(id);
            const st = c ? {
                type: c.candidateType || '?',
                proto: (c.protocol || '').toUpperCase(),
                addr: c.address || '',
                port: c.port
            } : null;
            if (!st) return null;
            if (st.addr) return st;
            const fromSdp = lookSdp(isLocal ? localSdp : remoteSdp, st);
            if (fromSdp) {
                return {
                    type: st.type !== '?' ? st.type : fromSdp.type,
                    proto: st.proto || fromSdp.proto,
                    addr: fromSdp.addr,
                    port: fromSdp.port,
                    fromSdp: true
                };
            }
            return st;
        };
        const label = (l, r) => {
            if (!l || !r) return '未知路径';
            if (l.type === 'relay' || r.type === 'relay') return 'TURN 中继（relay）';
            // ★先判 IPv6：公网 IPv6 是"跨互联网"的直连，**不是**同网段 ✗
            //   （两者都以 host 候选出现，所以必须靠地址族区分，否则会误报成"局域网"）
            if (addrFamily(l.addr) === 'IPv6' && addrFamily(r.addr) === 'IPv6') {
                return 'IPv6 直连（公网 IPv6，不经过 NAT）';
            }
            if (l.type === 'host' && r.type === 'host') return '局域网直连（同网段 / UU 组网）';
            return l.type + ' ↔ ' + r.type;
        };

        const counts = {};
        pairs.forEach(p => { counts[p.state] = (counts[p.state] || 0) + 1; });
        const okPairs = pairs.filter(p => p.state === 'succeeded');
        const sel = okPairs.find(p => p.nominated || p.selected) || okPairs[0] || null;

        if (!sel) {
            // 失败时也别只给一句"没有成功候选对"：把本机候选清单列出来，才知道是"网卡没被收集到"还是"NAT 打不通"
            const localList = [];
            const seen = {};
            pairs.forEach(p => {
                const lc = pickCand(p.localCandidateId, true);
                const key = lc ? (lc.type + '|' + lc.addr + '|' + lc.port) : '';
                if (lc && !seen[key]) { seen[key] = 1; localList.push(candText(lc)); }
            });
            const remoteList = [];
            const seenR = {};
            pairs.forEach(p => {
                const rc = pickCand(p.remoteCandidateId, false);
                const key = rc ? (rc.type + '|' + rc.addr + '|' + rc.port) : '';
                if (rc && !seenR[key]) { seenR[key] = 1; remoteList.push(candText(rc)); }
            });
            return {
                ok: false,
                text: '没有成功的候选对（候选对状态统计：' + JSON.stringify(counts) + '）'
                    + (localList.length ? ('；本机候选：' + localList.join(' / ')) : '')
                    + (remoteList.length ? ('；对方候选：' + remoteList.join(' / ')) : ''),
                counts,
                pairCount: pairs.length,
                localList,
                remoteList
            };
        }
        const l = pickCand(sel.localCandidateId, true);
        const r = pickCand(sel.remoteCandidateId, false);
        return {
            ok: true,
            text: label(l, r) + '  [本机 ' + candText(l) + ' ↔ 对方 ' + candText(r) + ']',
            local: l,
            remote: r,
            counts,
            pairCount: pairs.length
        };
    }

    /** 记录并打印本次连接路径（连上/失败时都调用） */
    async function noteActivePath(reason) {
        const pc = conn && conn.peerConnection;
        const info = await describeActivePath(pc);
        if (!info) return null;
        lastPath = Object.assign({}, info, { reason, at: Date.now() });
        console.log('[Network] ' + (reason ? reason + ' → ' : '') + '本次连接路径：' + info.text);
        callbacks.onStatusChange({ type: 'connection_path', path: lastPath });
        return lastPath;
    }

    /* ================= 信令自检（修掉"假红"） ================= */

    /**
     * 构造一条【与 PeerJS 客户端完全一致】的信令地址。
     * 旧版自检直接连 wss://0.peerjs.com/（根路径）→ 服务器只认 /peerjs?key=...，
     * 必然握手失败，会误报"被屏蔽 / 无外网"（而真实的 PeerJS 连接其实是好的）。
     */
    function signalingProbeUrl() {
        const custom = signalingOptionsFromUrl();
        const o = custom || { host: '0.peerjs.com', port: 443, path: '/', key: 'peerjs', secure: true };
        let base = (o.secure ? 'wss://' : 'ws://') + o.host + ':' + o.port + (o.path || '/');
        if (base.charAt(base.length - 1) !== '/') base += '/';
        const rnd = () => Math.random().toString(36).slice(2, 10);
        return base + 'peerjs?key=' + encodeURIComponent(o.key)
            + '&id=' + encodeURIComponent('cardgame-diag' + rnd())
            + '&token=' + encodeURIComponent(rnd())
            + '&version=' + PEERJS_VERSION;
    }

    /**
     * 真连一次信令服务器，并等它的回包（OPEN / ID-TAKEN / ERROR）。
     * 只做 WebSocket 握手还不够：key 写错、被代理改写、被网关拦截，都会在这一步才暴露。
     * 用完立刻 close()，不在服务器上留垃圾注册。
     */
    function probeSignaling(timeoutMs) {
        return new Promise(resolve => {
            const url = signalingProbeUrl();
            let ws = null;
            let done = false;
            const finish = (ok, reason) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try { if (ws) ws.close(); } catch (e) { /* 忽略 */ }
                resolve({ ok, reason, url });
            };
            const timer = global.setTimeout(() => {
                finish(false, '❌ 超时：6 秒内没能完成握手（DNS 解析不了 / 被防火墙或代理拦 / 没有外网）');
            }, timeoutMs || 6000);
            if (typeof global.WebSocket !== 'function') {
                clearTimeout(timer);
                return finish(false, '— 当前环境没有 WebSocket（在 Node 里跑自检时属正常，浏览器里不会出现这句）');
            }
            try {
                ws = new global.WebSocket(url);
            } catch (e) {
                clearTimeout(timer);
                return finish(false, '❌ 浏览器拒绝建立连接：' + (e && e.message));
            }
            ws.onmessage = (ev) => {
                let msg = null;
                try { msg = JSON.parse(ev.data); } catch (e) { /* 可能不是 JSON */ }
                if (msg && msg.type === 'OPEN') return finish(true, '✅ 可达，且服务器已接受注册（回包 OPEN）');
                if (msg && msg.type === 'ID-TAKEN') return finish(true, '✅ 可达（回包 ID-TAKEN：随机测试号偶发撞号，属正常）');
                if (msg && msg.type === 'ERROR') {
                    return finish(false, '⚠️ 可达，但服务器回 ERROR：' + JSON.stringify(msg.payload || {}));
                }
                finish(true, '✅ 可达（回包 ' + String(ev.data).slice(0, 120) + '）');
            };
            ws.onerror = () => finish(false, '❌ 连不上（被网络设备拦 / 证书问题 / 无外网）');
            ws.onclose = (ev) => {
                if (!done) finish(false, '❌ 握手被关闭（code=' + (ev && ev.code) + '）→ 多半被网络设备或代理拦截');
            };
        });
    }

    /**
     * 「允许暴露内网 IP」按钮的后端。
     * 原理：Chromium 只在页面**没有**获得媒体设备权限时，才把本机 IP 藏成 xxxx.local；
     *       拿到一次麦克风权限后就不再隐藏 ✓（这也是那个 flag 说明里写的例外）。
     * 做法：申请麦克风 → **立刻停止轨道（不录音、不上传）** → 重跑一次 ICE 自检对比 →
     *       能看到的真实内网地址就是虚拟局域网（蒲公英/Tailscale）那张网卡 ✓
     */
    async function enableLocalIpExposure() {
        const result = { ok: false, reason: '', before: lastIceSummary, after: null, report: '' };
        const nav = global.navigator || {};
        const md = nav.mediaDevices;
        if (!md || typeof md.getUserMedia !== 'function') {
            result.reason = '当前环境没有 getUserMedia（多半是因为页面不是"安全来源"：'
                + '请用 http://127.0.0.1 或 http://localhost 打开，或改用 https；用局域网 IP（http://192.168.x.x）打开时浏览器会禁用）→ '
                + '这种情况请改用：chrome://flags/#enable-webrtc-hide-local-ips-with-mdns → Disabled → 重启浏览器';
            return result;
        }
        let stream = null;
        try {
            stream = await md.getUserMedia({ audio: true });
        } catch (e) {
            result.reason = '权限被拒绝或被浏览器拦下（' + ((e && e.name) || '?') + '）：' + ((e && e.message) || '')
                + ' → 请改用：chrome://flags/#enable-webrtc-hide-local-ips-with-mdns → Disabled → 重启浏览器';
            return result;
        } finally {
            // 立刻释放麦克风：不录音、不保留任何媒体流
            if (stream && stream.getTracks) {
                try { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* 忽略 */ } }); } catch (e) { /* 忽略 */ }
            }
        }
        // 授权后立刻重跑 ICE 自检，用结果自己验证有没有生效
        result.report = await testIce();
        result.after = lastIceSummary;
        const gotIps = !!(lastIceSummary && lastIceSummary.privateIps && lastIceSummary.privateIps.length);
        const stillMdns = !!(lastIceSummary && lastIceSummary.mdnsCount);
        if (gotIps && !stillMdns) {
            result.ok = true;
            result.reason = '✅ 生效：已经能看到真实内网地址 ' + lastIceSummary.privateIps.join(' , ')
                + (lastIceSummary.vpnLike.length
                    ? ('（其中 ' + lastIceSummary.vpnLike.join(' , ') + ' 疑似虚拟局域网网卡 ✓ 让两台机器对比是否同网段）')
                    : '');
        } else if (gotIps) {
            result.ok = true;
            result.reason = '✅ 部分生效：能看到内网地址 ' + lastIceSummary.privateIps.join(' , ')
                + '（仍有 ' + lastIceSummary.mdnsCount + ' 个 .local，属正常波动）';
        } else {
            result.reason = '⚠️ 没生效：仍然只看到 .local。请改用更可靠的方式：'
                + 'chrome://flags/#enable-webrtc-hide-local-ips-with-mdns → Disabled → 重启浏览器（两台机器都要做）';
        }
        return result;
    }

    /** 控制台自检：Network.diagnose() */
    async function diagnose() {
        const lines = [];
        const loc = global.location || {};
        lines.push('=== 联机自检 ===');
        lines.push('时间：' + new Date().toLocaleString());
        lines.push('页面：' + (loc.protocol === 'file:' ? 'file:// 本地打开' : (loc.origin || loc.href || '?')));
        lines.push('浏览器：' + ((global.navigator && global.navigator.userAgent) || '?'));
        lines.push('PeerJS 库：' + (typeof Peer === 'undefined'
            ? '❌ 未加载（js/lib/peerjs.min.js 缺失 / 被拦截）' : '✅ 已加载'));
        lines.push('WebRTC 支持：' + (global.RTCPeerConnection ? '✅' : '❌ 浏览器不支持或被禁用'));
        lines.push('本机在线标记：' + ((global.navigator && global.navigator.onLine) ? '✅ 有外网' : '❌ 没有外网'));

        const custom = signalingOptionsFromUrl();
        lines.push('信令服务器：' + (custom
            ? (custom.host + ':' + custom.port + custom.path + '（URL 自定义）')
            : '0.peerjs.com:443（默认公共云）'));
        const probe = await probeSignaling(6000);
        lines.push('  实测地址 ' + probe.url);
        lines.push('  实测结果 ' + probe.reason);
        lines.push('PeerJS 信令状态：' + (signalingOpen ? '✅ 在线'
            : (signalingLost ? '⚠️ 掉线（正在重连一次…）' : '— 未连接')));
        lines.push('ICE 服务器：（无 —— 局域网直连只用本机网卡地址，不配 STUN/TURN）');

        if (conn && conn.peerConnection) {
            lines.push('当前 ICE 状态：' + conn.peerConnection.iceConnectionState
                + ' / 收集中=' + conn.peerConnection.iceGatheringState);
            const path = await describeActivePath(conn.peerConnection);
            if (path) lines.push('实际连接路径：' + path.text);
        } else if (lastPath) {
            lines.push('上次连接路径：' + lastPath.text + '（' + (lastPath.reason || '') + '）');
        }

        lines.push('我的 Peer ID：' + (myPeerId || (isJoined ? '（客人侧：由服务器分配，未记录）' : '（尚未注册到信令服务器）')));
        if (roomCode) {
            lines.push(isHost
                ? ('当前房间号：' + roomCode + '（把这一串原样给客人，就能找到我）')
                : ('当前房间号（房主的）：' + roomCode));
        }

        /* ---- 虚拟局域网（蒲公英 / Tailscale）相关判读 ---- */
        if (lastIceSummary) {
            lines.push('mDNS 隐藏：' + (lastIceSummary.mdnsCount
                ? ('⚠️ 内网 IP 被隐藏（' + lastIceSummary.mdnsCount + ' 个 .local）→ 虚拟局域网直连会失效 ✗')
                : '✅ 未隐藏（能看到真实内网地址）'));
            lines.push('内网地址：' + (lastIceSummary.privateIps.length
                ? (lastIceSummary.privateIps.join(' , ')
                    + (lastIceSummary.vpnLike.length ? ('；疑似虚拟局域网：' + lastIceSummary.vpnLike.join(' , ')) : ''))
                : '（看不到，被 .local 替代 ✗ 请点「🔧 允许暴露内网 IP」或关 flag）'));
        } else {
            lines.push('mDNS/内网地址：本次还没跑 ICE 自检（selfCheck 会自动跑；也可手动 Network.testIce()）');
        }
        try {
            const perm = global.navigator && global.navigator.permissions;
            const md = global.navigator && global.navigator.mediaDevices;
            if (perm && typeof perm.query === 'function') {
                const st = await perm.query({ name: 'microphone' });
                lines.push('麦克风权限：' + st.state + '（granted 时「🔧 允许暴露内网 IP」才能生效）');
            } else {
                lines.push('getUserMedia：' + ((md && md.getUserMedia) ? '可用' : '不可用（页面不是安全来源时会被禁用）'));
            }
        } catch (e) { /* 忽略 */ }

        lines.push('当前状态：' + JSON.stringify(getState()));
        lines.push('');
        lines.push('怎么读这份报告：');
        lines.push('  · 信令"❌"是致命的（先查外网 / 代理 / VPN / 系统时间）；信令"✅"却连不上 → 两台不在同一局域网 ✗');
        lines.push('  · 关键看"内网地址 / mDNS 隐藏"：组网软件（UU联机/蒲公英/Tailscale）靠那张虚拟网卡直连，'
            + '被 .local 藏掉就用不了 → 点「🔧 允许暴露内网 IP」');
        lines.push('  · 两边报告的【内网地址】若在同一网段（如都在 172.16.0.0/24）→ 就能直连 ✓');
        const report = lines.join('\n');
        console.log(report);
        return report;
    }

    /** 一键自检（界面按钮用）：返回可复制的完整报告 */
    async function selfCheck() {
        const parts = [];
        // ★顺序很重要：先跑 ICE 自检（它会给 lastIceSummary 赋值），
        //   再跑 diagnose —— 否则报告里的「mDNS 隐藏 / 内网地址」那几行拿不到数据。
        let iceReport = '';
        try {
            iceReport = await testIce();
        } catch (e) {
            iceReport = 'ICE 自检出错：' + (e && e.message);
        }
        try { parts.push(await diagnose()); } catch (e) { parts.push('联机自检出错：' + (e && e.message)); }
        parts.push(iceReport);
        parts.push([
            '=== 怎么处理（局域网联机框架）===',
            '0) ★只走一条路：让两台机器在【同一个局域网】—— UU加速器的「UU联机」/ 蒲公英 / Tailscale 组网，或同一个 WiFi',
            '1) 房主页面保持前台、别最小化（后台降频会让信令掉线）',
            '2) 掉线后只会自动重连一次；没恢复就重新点「创建房间 / 加入」即可（房间号不变）',
            '3) ★必须做的一步：两台都点本面板的「🔧 允许暴露内网 IP」'
                + '（浏览器默认会把虚拟网卡地址藏成 xxxx.local，多数组网软件不转发组播 → 藏起来就用不了 ✗）'
                + '；若按钮不可用（页面不是 https/localhost），改用 edge://flags/#enable-webrtc-hide-local-ips-with-mdns → Disabled → 重启浏览器',
            '4) 然后重跑自检：两边的【内网地址】若在同一网段（例如都在 172.16.0.0/24）→ 直接建房联机即可 ✓',
            '5) 想更稳（连公共信令都不用）：房主执行 npx peerjs --port 9000 --path / ，'
                + '两边用 index.html?peerhost=<房主虚拟网卡IP>&peerport=9000'
        ].join('\n'));
        return parts.join('\n\n');
    }

    function setupPeerConnection() {
        // 旧 peer 作废：清掉重连标志
        signalingReconnecting = false;
        if (conn) {
            conn.close();
            conn = null;
        }
        if (peer) {
            peer.destroy();
            peer = null;
        }
        myPeerId = null;
        joinSession = null;
    }

    /**
     * 建立并等待信令连接成功（拿到真实 Peer ID）。
     * @param {string} [wantId] 想要的 ID（房主用 cardgame-<4位密码>；不传则由服务器随机分配）
     * 失败时 reject：{type:'unavailable-id'|'timeout'|其它 PeerJS 错误}
     */
    function waitPeerOpen(wantId) {
        return new Promise((resolve, reject) => {
            const p = wantId ? new Peer(wantId, peerOptions()) : new Peer(peerOptions());
            let settled = false;
            const timer = global.setTimeout(() => {
                if (settled) return;
                settled = true;
                try { p.destroy(); } catch (e) { /* 忽略 */ }
                reject({ type: 'timeout', message: '连接信令服务器超时' });
            }, connTimeoutMs());
            p.on('open', () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signalingOpen = true;
                signalingLost = false;
                resolve(p);
            });
            p.on('error', (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { p.destroy(); } catch (e) { /* 忽略 */ }
                reject(err || { type: 'unknown' });
            });
        });
    }

    /**
     * 规范化"加入房间"输入：既接受 4 位密码（8940），也接受房主显示的完整 ID（cardgame-8940 / 8940-k3f2）
     * —— 服务器在 ID 被占用时可能给房主加后缀，那时必须以房主实际显示的字符串为准。
     */
    function normalizeRoomInput(raw) {
        let s = String(raw == null ? '' : raw).trim();
        if (!s) return { error: '请输入房间号' };
        s = s.replace(/\s+/g, '');
        if (/^cardgame-/i.test(s)) s = s.slice('cardgame-'.length);
        if (!/^[0-9]{4}(-[a-z0-9]+)?$/i.test(s)) {
            return { error: '请输入4位数字房间号（若房主显示的是带后缀的ID，请原样完整输入）' };
        }
        return { code: s, peerId: 'cardgame-' + s };
    }

    /** PeerJS 错误 → 用户能看懂的一句话 */
    function describePeerError(err) {
        const type = err && err.type;
        switch (type) {
            case 'unavailable-id': return '房间号已被占用，请重新创建房间';
            case 'peer-unavailable': return '找不到房主（对方不在线或房间号不对）';
            case 'network': return '网络异常，与信令服务器的连接中断';
            case 'server-error': return '信令服务器出错，请稍后重试';
            case 'socket-error': return '与信令服务器的连接出错，请检查网络';
            case 'socket-closed': return '与信令服务器的连接被关闭，请检查网络';
            case 'browser-incompatible': return '当前浏览器不支持 WebRTC 联机';
            case 'ssl-unavailable': return '信令服务器 SSL 不可用（可能被网络拦截）';
            case 'invalid-id': return '房间 ID 无效，请重新创建';
            default: return (err && err.message) || '发生未知错误';
        }
    }

    function generateRoomCode() {
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += Math.floor(Math.random() * 10);
        }
        return code;
    }

    async function createRoom() {
        if (isJoined) return { error: '你已经在房间中' };
        if (joining) return { error: '正在加入房间，请稍候…' };
        if (peerLibMissing()) return { error: '联机库未加载' };
        setupPeerConnection();

        // 房间号 = 全局唯一的 PeerJS ID（cardgame-8940）。
        // 公共云上若该号已被别人占用，服务器会报 unavailable-id → 换个号重建。
        let hostPeer = null;
        for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt++) {
            roomCode = generateRoomCode();
            try {
                hostPeer = await waitPeerOpen('cardgame-' + roomCode);
                break;
            } catch (e) {
                if (e && e.type === 'unavailable-id') continue;      // 换号重来
                resetConnection();
                logConnectGuide('连不上信令服务器（0.peerjs.com）');
                return {
                    error: (e && e.type === 'timeout')
                        ? '连不上信令服务器（0.peerjs.com），请检查外网'
                        : '创建房间失败：' + describePeerError(e)
                };
            }
        }
        if (!hostPeer) {
            resetConnection();
            return { error: '房间号连续被占用，请稍后重试' };
        }

        peer = hostPeer;
        myPeerId = hostPeer.id || ('cardgame-' + roomCode);
        // ★以服务器实际分配的 ID 为准写进界面：万一服务器给了带后缀的 ID（cardgame-8940-k3f2），
        //   客人照抄界面上的密码也一定能连上（旧版这里固定显示 4 位号，就会对不上 → peer-unavailable）。
        roomCode = String(myPeerId).replace(/^cardgame-/, '');
        isHost = true;
        isJoined = true;
        bindHostPeer(hostPeer);
        callbacks.onStatusChange({ type: 'host_created', roomCode, peerId: myPeerId });
        return { success: true };
    }

    /** 房主侧事件：有人来连 / 信令断了自动重连 / 各类错误 */
    function bindHostPeer(hostPeer) {
        hostPeer.on('open', () => {
            if (hostPeer !== peer) return;
            markSignalingOpen();                               // 重连成功
        });

        hostPeer.on('connection', (connection) => {
            if (hostPeer !== peer) return;                     // 已被重置的旧 peer，忽略
            conn = connection;
            armConnectTimeout('已找到房间，但 P2P 直连失败', connection.peerConnection);   // ICE failed 立即失败 + 30s 兜底
            setupConnectionHandlers();
            callbacks.onConnectionChange({ type: 'opponent_joined' });
        });

        // 信令掉线（热点抖动 / 标签页被后台挂起 → PeerJS 报 "Lost connection to server."）：
        //   提示 + 丢弃半成品连接 + 只重连一次（房间号不变 ✓）。
        //   ★不能在 error 里直接 reconnect()：那会儿 PeerJS 还没 disconnect()，reconnect() 是空操作 ✗
        hostPeer.on('disconnected', () => {
            if (hostPeer !== peer || !isJoined) return;
            markSignalingLost(hostPeer, '与信令服务器断开，正在重连…');
            dropHalfBuiltConn();
            tryReconnectOnce(hostPeer);
        });

        hostPeer.on('error', (err) => {
            if (hostPeer !== peer) return;
            console.error('Peer错误:', err);
            const type = err && err.type;
            if (type === 'socket-error' || type === 'socket-closed' || type === 'network') {
                markSignalingLost(hostPeer, '与信令服务器断开（' + (err.message || 'Lost connection to server') + '），正在重连…');
                dropHalfBuiltConn();
                return;                    // 真正的重连交给 'disconnected' 事件
            }
            if (type === 'unavailable-id') {
                // 服务器上旧注册还没释放（同 token 一般不会遇到）：重连一次抢回同一个号，绝不换号
                tryReconnectOnce(hostPeer);
                return;
            }
            resetConnection();
            callbacks.onStatusChange({ type: 'error', message: describePeerError(err) });
        });
    }

    async function joinRoom(password) {
        if (isJoined) return { error: '你已经在房间中' };
        if (joining) return { error: '正在加入房间，请稍候…' };
        if (peerLibMissing()) return { error: '联机库未加载' };
        const norm = normalizeRoomInput(password);
        if (norm.error) return { error: norm.error };

        setupPeerConnection();
        roomCode = norm.code;
        const targetId = norm.peerId;

        joining = true;
        try {
            let guestPeer;
            try {
                guestPeer = await waitPeerOpen();               // 用随机 ID 接入信令
            } catch (e) {
                resetConnection();
                logConnectGuide('连不上信令服务器（0.peerjs.com）');
                return { error: '连不上信令服务器（0.peerjs.com），请检查外网' };
            }
            peer = guestPeer;
            bindGuestPeer(guestPeer);

            // ★房主可能刚点"创建房间"（ID 还没在服务器注册好）或刚断线正在重连 →
            //   遇到 peer-unavailable 先自动重试几次，而不是立刻判定"房间不存在"。
            for (let attempt = 1; attempt <= MAX_JOIN_ATTEMPTS; attempt++) {
                if (guestPeer !== peer) return { error: '已取消' };
                callbacks.onStatusChange({ type: 'joining', roomCode, attempt, maxAttempts: MAX_JOIN_ATTEMPTS });
                // 信令不在线（刚掉线/正在重连）时先等它回来，否则 connect 发出去也没人转发
                if (!(await ensureSignaling(guestPeer))) {
                    if (guestPeer !== peer) return { error: '已取消' };
                    resetConnection();
                    logConnectGuide('连不上信令服务器（0.peerjs.com）');
                    return { error: '信令服务器连接不上（可能网络中断），请检查外网后重试' };
                }
                try {
                    await connectOnce(guestPeer, targetId);
                    clearConnectTimeout();
                    isJoined = true;
                    callbacks.onStatusChange({ type: 'joined', roomCode });
                    callbacks.onConnectionChange({ type: 'connected' });
                    return { success: true };
                } catch (e) {
                    if (guestPeer !== peer) return { error: '已取消' };
                    const type = e && e.type;
                    // 可重试的失败：房主不在线（可能刚建房/刚重连）、或握手被断线打断
                    const retryable = (type === 'peer-unavailable')
                        || (type === 'signaling-lost')
                        || (type === 'timeout' && !signalingOpen);
                    if (retryable && attempt < MAX_JOIN_ATTEMPTS) {
                        await sleep(joinRetryDelayMs(attempt));
                        continue;
                    }
                    // 彻底失败：先把"这次卡在哪条路"记录下来（复位后就取不到 stats 了）
                    await noteActivePath('加入失败');
                    resetConnection();
                    if (type === 'peer-unavailable') {
                        return { error: '找不到房间 ' + norm.code
                            + '：房主可能还没建好 / 刚掉线 / 页面已关闭。'
                            + '请让房主确认房间号，稍等几秒后再点「加入」' };
                    }
                    if (type === 'signaling-lost') {
                        return { error: '连接过程中与信令服务器断开了，请检查网络后重试（房主也请保持页面在前台）' };
                    }
                    if (type === 'timeout' || type === 'ice-failed') {
                        logConnectGuide('已找到房间，但两端网络无法直连');
                        return { error: '已找到房间，但两端网络不允许直连 ✗（本框架只走局域网直连）：\n'
                            + failureAdvice() };
                    }
                    return { error: '加入房间失败：' + describePeerError(e) };
                }
            }
            return { error: '加入房间失败' };
        } finally {
            joining = false;
            joinSession = null;
        }
    }

    /** 客人侧事件：信令断了自动重连 / 各类错误（peer-unavailable 交给重试逻辑） */
    function bindGuestPeer(guestPeer) {
        guestPeer.on('open', () => {
            if (guestPeer !== peer) return;
            markSignalingOpen();
        });

        guestPeer.on('disconnected', () => {
            if (guestPeer !== peer) return;
            markSignalingLost(guestPeer, '与信令服务器断开，正在重连…');
            // 握手途中掉线 → 立刻判本次尝试失败，交给重试流程重来，而不是干等超时
            if (joinSession && joinSession.onSignalingLost) joinSession.onSignalingLost();
            tryReconnectOnce(guestPeer);
        });

        guestPeer.on('error', (err) => {
            if (guestPeer !== peer) return;
            console.error('Peer错误:', err);
            const type = err && err.type;
            if (type === 'peer-unavailable' && joinSession && joinSession.onUnavailable) {
                joinSession.onUnavailable();               // 转成本次尝试失败 → 触发重试
                return;
            }
            if (type === 'socket-error' || type === 'socket-closed' || type === 'network') {
                markSignalingLost(guestPeer, '与信令服务器断开（' + (err.message || 'Lost connection to server') + '），正在重连…');
                if (joinSession && joinSession.onSignalingLost) joinSession.onSignalingLost();
                return;                                    // 重连交给 'disconnected' 事件
            }
            if (type === 'unavailable-id') {
                tryReconnectOnce(guestPeer);               // 重连一次，不影响本次加入流程
                return;
            }
            resetConnection();
            callbacks.onStatusChange({ type: 'error', message: describePeerError(err) });
        });
    }

    /** 单次连接尝试：成功（conn 已 open）resolve；失败 reject({type}) */
    function connectOnce(guestPeer, targetId) {
        return new Promise((resolve, reject) => {
            let c = null;
            try {
                c = guestPeer.connect(targetId, { reliable: true });
            } catch (e) {
                reject(e || { type: 'unknown' });
                return;
            }
            if (!c) { reject({ type: 'unknown', message: 'connect() 未返回连接对象' }); return; }
            conn = c;

            let settled = false;
            let cancelWatch = null;
            const finish = (isOk, arg) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (cancelWatch) { try { cancelWatch(); } catch (e) { /* 忽略 */ } cancelWatch = null; }
                joinSession = null;
                if (isOk) {
                    setupConnectionHandlers(true);         // 已经 open：只挂数据/关闭处理
                    global.setTimeout(() => noteActivePath('已连上'), 600);
                    resolve();
                } else {
                    reject(arg);
                }
            };
            // ① ICE 自己报 failed → 立即判失败（对称 NAT 打不通时一般 5~8 秒就 failed）
            cancelWatch = watchIceFailure(c.peerConnection, () => finish(false, { type: 'ice-failed' }));
            // ② 兜底超时 30 秒（只作保险）
            const timer = global.setTimeout(() => finish(false, { type: 'timeout' }), p2pTimeoutMs());
            // PeerJS 把"连不上对方"抛在 peer 层（Could not connect to peer xxx），这里接住；
            // 信令中途掉线也算本次失败（立刻重试，而不是干等超时）
            joinSession = {
                onUnavailable: () => finish(false, { type: 'peer-unavailable' }),
                onSignalingLost: () => finish(false, { type: 'signaling-lost' })
            };
            c.on('open', () => finish(true));
            c.on('error', (err) => finish(false, err || { type: 'unknown' }));
        });
    }

    function setupConnectionHandlers(alreadyOpen) {
        if (!conn) return;
        const thisConn = conn;
        // 代际校验：半成品连接 / 被替换掉的旧连接，其迟到事件一律忽略
        // （否则一条早已作废连接的 close 会把当前正常对局 reset 掉）
        const alive = () => conn === thisConn && !!conn;
        if (!alreadyOpen) {
            // 房主侧：等对端连上来
            thisConn.on('open', () => {
                if (!alive()) return;
                clearConnectTimeout();                 // 连上了：撤销超时
                isJoined = true;
                callbacks.onConnectionChange({ type: 'connected' });
                // 稍等一下再读 stats，让候选对稳定下来；结果会打进控制台与自检报告
                global.setTimeout(() => noteActivePath('已连上'), 600);
            });
        }
        thisConn.on('data', (data) => {
            if (!alive()) return;
            callbacks.onMessage(data);
        });
        thisConn.on('close', () => {
            if (!alive()) return;
            callbacks.onConnectionChange({ type: 'disconnected' });
            resetConnection();
        });
        thisConn.on('error', (err) => {
            if (!alive()) return;
            console.error('数据连接错误:', err);
            callbacks.onConnectionChange({ type: 'error', message: '连接发生错误' });
            resetConnection();
        });
    }

    function sendMessage(data) {
        if (conn && conn.open) {
            conn.send(data);
            return true;
        }
        return false;
    }

    function setReady(ready) {
        isReady = ready;
        if (conn && conn.open) {
            conn.send(JSON.stringify({ type: 'ready_status', ready }));
        }
    }

    function setOpponentReady(ready) {
        opponentReady = ready;
        callbacks.onStatusChange({ type: 'opponent_ready', ready });
    }

    function startGame() {
        if (!isHost) return false;   // 只有房主可以发起开始
        if (conn && conn.open && isReady && opponentReady) {
            conn.send(JSON.stringify({ type: 'game_start' }));
            return true;
        }
        return false;
    }

    function resetConnection() {
        clearConnectTimeout();
        setupPeerConnection();
        isHost = false;
        isJoined = false;
        roomCode = null;
        isReady = false;
        opponentReady = false;
        joining = false;
        joinSession = null;
        signalingLost = false;
        signalingOpen = false;
        lastPath = null;
        callbacks.onStatusChange({ type: 'reset' });
    }

    function getState() {
        return {
            isHost,
            isJoined,
            roomCode,
            myPeerId,
            signalingLost,
            signalingOpen,
            signalingRetrying: signalingReconnecting,   // 是否正在"重连一次"（界面用它显示状态）
            signalingAttempt: signalingReconnecting ? 1 : 0,
            lastPath: lastPath ? lastPath.text : null,  // 最近一次实际连接路径（诊断用）
            isReady,
            opponentReady,
            myDeckReady,
            isConnected: conn ? conn.open : false
        };
    }

    function setMyDeckReady(ready) {
        myDeckReady = ready;
    }

    // 导出
    global.Network = {
        createRoom,
        joinRoom,
        sendMessage,
        setReady,
        setOpponentReady,
        startGame,
        resetConnection,
        getState,
        setMyDeckReady,
        setCallbacks,
        diagnose,                      // 控制台：Network.diagnose() 自检联机环境
        testIce,                       // 控制台：Network.testIce() 看本机能收集到哪些 ICE 候选
        selfCheck,                     // 界面/控制台：一键自检，返回可复制的完整报告
        enableLocalIpExposure,         // 界面：申请一次麦克风权限（立即释放）→ 让浏览器暴露真实内网 IP，并自动重跑 ICE 自检验证
        describeActivePath,            // 诊断：本次连接实际走的哪条路（IPv6直连/打洞/中继）
        signalingProbeUrl,             // 诊断/测试：自检用的信令地址（与 PeerJS 客户端完全一致）
        normalizeRoomInput,             // 控制台/测试：房间输入规范化（4位密码或完整 ID）
        signalingOptionsFromUrl,        // 控制台/测试：URL 里是否指定了自定义信令服务器
        iceServers                      // 控制台/测试：当前实际使用的 ICE 服务器（含 URL 里的 TURN）
    };
})(window);