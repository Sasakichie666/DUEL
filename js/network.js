// js/network.js
// P2P联机模块（基于PeerJS）——增强版
// 参考之前成功的联机代码，提升连接稳定性和穿透率

(function(global) {
    let peer = null;
    let conn = null;
    let isHost = false;
    let isJoined = false;
    let roomCode = null;
    let isReady = false;
    let opponentReady = false;
    let myDeckReady = false;
    let retryCount = 0;

    // 回调函数（由main.js注册）
    let callbacks = {
        onStatusChange: () => {},
        onMessage: () => {},
        onConnectionChange: () => {},
    };

    function setCallbacks(cb) {
        callbacks = { ...callbacks, ...cb };
    }

    // 增强的 ICE 服务器列表（免费 STUN/TURN）
    function getIceServers() {
        return [
            // STUN
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },

            // Metered TURN
            {
                urls: [
                    'turn:openrelay.metered.ca:80?transport=udp',
                    'turn:openrelay.metered.ca:80?transport=tcp'
                ],
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: [
                    'turn:openrelay.metered.ca:443?transport=udp',
                    'turn:openrelay.metered.ca:443?transport=tcp'
                ],
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: [
                    'turn:openrelay.metered.ca:443',
                    'turns:openrelay.metered.ca:443?transport=tcp'
                ],
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },

            // Numb TURN
            {
                urls: 'turn:numb.viagenie.ca',
                username: 'webrtc@live.com',
                credential: 'muazkh'
            },

            // freeturn.net
            {
                urls: 'turn:freeturn.net:3478',
                username: 'free',
                credential: 'free'
            },
            {
                urls: 'turns:freeturn.net:5349',
                username: 'free',
                credential: 'free'
            },

            // Twilio 公共 TURN（仅测试用）
            {
                urls: 'turn:global.turn.twilio.com:3478?transport=udp',
                username: 'f4b7c1e5c8b3a2d6e0f9a8b7c6d5e4f3',
                credential: 'kI7wG5vP3sX9tR2eL0mN6bQ8vC4xZ1aA='
            },
            {
                urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
                username: 'f4b7c1e5c8b3a2d6e0f9a8b7c6d5e4f3',
                credential: 'kI7wG5vP3sX9tR2eL0mN6bQ8vC4xZ1aA='
            },
            {
                urls: 'turns:global.turn.twilio.com:443?transport=tcp',
                username: 'f4b7c1e5c8b3a2d6e0f9a8b7c6d5e4f3',
                credential: 'kI7wG5vP3sX9tR2eL0mN6bQ8vC4xZ1aA='
            }
        ];
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
        // 生成4位大写字母和数字混合的房号，降低冲突概率
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    async function createRoom() {
        if (isJoined) return { error: '你已经在房间中' };
        setupPeerConnection();
        retryCount = 0;

        return await tryCreateRoom();
    }

    function tryCreateRoom() {
        roomCode = generateRoomCode();
        const peerId = 'cardgame-' + roomCode;

        try {
            peer = new Peer(peerId, {
                debug: 0,
                secure: location.protocol === 'https:',
                config: {
                    iceServers: getIceServers(),
                    iceCandidatePoolSize: 2
                }
            });

            peer.on('open', (id) => {
                isHost = true;
                isJoined = true;
                retryCount = 0;
                callbacks.onStatusChange({ type: 'host_created', roomCode });
            });

            peer.on('connection', (connection) => {
                conn = connection;
                setupConnectionHandlers();
                callbacks.onConnectionChange({ type: 'opponent_joined' });
            });

            peer.on('error', (err) => {
                console.error('Peer错误:', err);
                if (err.type === 'unavailable-id' && isHost && retryCount < 5) {
                    // 房间号被占用，重试
                    retryCount++;
                    peer.destroy();
                    tryCreateRoom();
                    return;
                }

                let message = '发生错误';
                if (err.type === 'peer-unavailable') message = '房间不存在或对方已离线';
                else if (err.type === 'network') message = '网络连接失败，请检查防火墙或网络';
                else if (err.type === 'browser-incompatible') message = '浏览器不支持WebRTC';
                else if (err.type === 'unavailable-id') message = '房间号已被占用，请重试';

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
        if (!password || password.length !== 4) return { error: '请输入4位房号' };
        password = password.toUpperCase();
        setupPeerConnection();
        roomCode = password;
        const peerId = 'cardgame-' + roomCode;

        try {
            peer = new Peer({
                debug: 0,
                secure: location.protocol === 'https:',
                config: {
                    iceServers: getIceServers(),
                    iceCandidatePoolSize: 2
                }
            });

            peer.on('open', (id) => {
                conn = peer.connect(peerId, { reliable: true });
                setupConnectionHandlers();
                callbacks.onStatusChange({ type: 'joining', roomCode });
            });

            peer.on('error', (err) => {
                console.error('Peer错误:', err);
                let message = '发生错误';
                if (err.type === 'peer-unavailable') message = '房间不存在或密码错误';
                else if (err.type === 'network') message = '网络连接失败';
                else if (err.type === 'browser-incompatible') message = '浏览器不支持WebRTC';
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