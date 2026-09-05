// js/network.js
// P2P联机模块（基于PeerJS）

(function(global) {
    let peer = null;
    let conn = null;
    let isHost = false;
    let isJoined = false;
    let roomCode = null;
    let isReady = false;
    let opponentReady = false;
    let myDeckReady = false; // 这个由外部更新

    // 回调函数（由main.js注册）
    let callbacks = {
        onStatusChange: () => {},
        onMessage: () => {},
        onConnectionChange: () => {},
    };

    function setCallbacks(cb) {
        callbacks = { ...callbacks, ...cb };
    }

    function setupPeerConnection() {
        if (conn) {
            conn.close();
            conn = null;
        }
        if (peer) {
            peer.destroy();
            peer = null;
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
        setupPeerConnection();

        roomCode = generateRoomCode();
        const peerId = 'cardgame-' + roomCode;

        try {
            peer = new Peer(peerId);
            peer.on('open', (id) => {
                isHost = true;
                isJoined = true;
                callbacks.onStatusChange({ type: 'host_created', roomCode });
            });

            peer.on('connection', (connection) => {
                conn = connection;
                setupConnectionHandlers();
                callbacks.onConnectionChange({ type: 'opponent_joined' });
            });

            peer.on('error', (err) => {
                console.error('Peer错误:', err);
                let message = '发生错误';
                if (err.type === 'unavailable-id') message = '该房间ID已被占用，请重新创建';
                else if (err.type === 'peer-unavailable') message = '无法连接到PeerJS云服务器，请检查网络';
                resetConnection();
                callbacks.onStatusChange({ type: 'error', message });
            });
            return { success: true };
        } catch (e) {
            resetConnection();
            return { error: '创建房间失败' };
        }
    }

    async function joinRoom(password) {
        if (isJoined) return { error: '你已经在房间中' };
        if (!password || password.length !== 4) return { error: '请输入4位数字密码' };
        setupPeerConnection();
        roomCode = password;
        const peerId = 'cardgame-' + roomCode;

        try {
            peer = new Peer(); // 随机ID
            peer.on('open', (id) => {
                conn = peer.connect(peerId, { reliable: true });
                setupConnectionHandlers();
                callbacks.onStatusChange({ type: 'joining', roomCode });
            });

            peer.on('error', (err) => {
                console.error('Peer错误:', err);
                let message = '发生错误';
                if (err.type === 'peer-unavailable') message = '房间不存在或密码错误';
                else if (err.type === 'unavailable-id') message = '该房间ID不可用';
                resetConnection();
                callbacks.onStatusChange({ type: 'error', message });
            });
            return { success: true };
        } catch (e) {
            resetConnection();
            return { error: '加入房间失败' };
        }
    }

    function setupConnectionHandlers() {
        if (!conn) return;
        conn.on('open', () => {
            isJoined = true;
            callbacks.onConnectionChange({ type: 'connected' });
        });
        conn.on('data', (data) => {
            callbacks.onMessage(data);
        });
        conn.on('close', () => {
            callbacks.onConnectionChange({ type: 'disconnected' });
            resetConnection();
        });
        conn.on('error', (err) => {
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
        if (conn && conn.open && isReady && opponentReady) {
            conn.send(JSON.stringify({ type: 'game_start' }));
            return true;
        }
        return false;
    }

    function resetConnection() {
        setupPeerConnection();
        isHost = false;
        isJoined = false;
        roomCode = null;
        isReady = false;
        opponentReady = false;
        callbacks.onStatusChange({ type: 'reset' });
    }

    function getState() {
        return {
            isHost,
            isJoined,
            roomCode,
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
        setCallbacks
    };
})(window);