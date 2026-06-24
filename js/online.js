/* ============================================================
   联机对战客户端模块（Socket.io）
   ============================================================ */
(function () {
  let socket = null;
  let currentRoom = null;
  let isOnlineMode = false;
  let onRoomCreated = null;
  let onRoomJoined = null;
  let onPlayerJoined = null;
  let onGameStart = null;
  let onMoveResult = null;
  let onChat = null;
  let onPlayerLeft = null;
  let onDisconnect = null;
  let onReconnect = null;
  let onRateLimited = null;

  // localStorage 键：用于断线/刷新后恢复房间
  const STORAGE_KEY = 'online_room_state';

  // 保存当前房间 ID 到 localStorage（重连用）
  function saveRoomState() {
    if (currentRoom) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          id: currentRoom.id,
          savedAt: Date.now()
        }));
      } catch (e) { /* localStorage 可能被禁用 */ }
    }
  }

  function clearRoomState() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function getSavedRoomId() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data);
      // 超过 30 分钟的保存记录视为过期
      if (Date.now() - parsed.savedAt > 30 * 60 * 1000) {
        clearRoomState();
        return null;
      }
      return parsed.id;
    } catch (e) {
      return null;
    }
  }

  function connect(host = 'localhost', port = 3000) {
    if (socket) {
      socket.disconnect();
    }

    socket = io(`http://${host}:${port}`, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity
    });

    socket.on('connect', () => {
      console.log('Connected to server');
      // 如果本地保存了房间 ID 且当前没有活跃房间，尝试恢复
      if (!currentRoom) {
        const savedRoomId = getSavedRoomId();
        if (savedRoomId) {
          console.log('检测到本地保存的房间，尝试恢复:', savedRoomId);
          socket.emit('syncState', { roomId: savedRoomId });
        }
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      if (onDisconnect) onDisconnect();
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log(`Reconnected to server (attempt ${attemptNumber})`);
      // 重连后自动同步状态
      const savedRoomId = currentRoom ? currentRoom.id : getSavedRoomId();
      if (savedRoomId) {
        socket.emit('syncState', { roomId: savedRoomId });
      }
      if (onReconnect) onReconnect();
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`Reconnection attempt ${attemptNumber}...`);
    });

    socket.on('reconnect_failed', () => {
      console.error('Reconnection failed');
    });

    socket.on('roomCreated', (data) => {
      currentRoom = data;
      isOnlineMode = true;
      saveRoomState();
      if (onRoomCreated) onRoomCreated(data);
    });

    socket.on('roomJoined', (data) => {
      currentRoom = data;
      isOnlineMode = true;
      saveRoomState();
      if (onRoomJoined) onRoomJoined(data);
    });

    socket.on('playerJoined', (data) => {
      currentRoom = data;
      if (onPlayerJoined) onPlayerJoined(data);
    });

    socket.on('gameStart', (data) => {
      currentRoom = data;
      saveRoomState();
      if (onGameStart) onGameStart(data);
    });

    socket.on('moveResult', (data) => {
      if (onMoveResult) onMoveResult(data);
    });

    socket.on('chat', (data) => {
      if (onChat) onChat(data);
    });

    socket.on('playerLeft', (data) => {
      currentRoom = data;
      if (onPlayerLeft) onPlayerLeft(data);
    });

    socket.on('syncState', (data) => {
      // 同步状态：如果服务端找不到房间，清除本地记录
      if (!data || data.notFound) {
        clearRoomState();
        currentRoom = null;
        return;
      }
      currentRoom = data;
      isOnlineMode = true;
      saveRoomState();
      if (onGameStart) onGameStart(data);
    });

    socket.on('joinFailed', (data) => {
      console.error('Join failed:', data.error);
      clearRoomState();
      if (data.error && data.error.indexOf('不存在') !== -1) {
        // 房间不存在，可能是服务端重启后清空，提示用户
        alert('房间不存在或已过期：' + data.error);
      } else {
        alert(data.error);
      }
    });

    socket.on('rateLimited', (data) => {
      console.warn('操作被限流:', data);
      if (onRateLimited) {
        onRateLimited(data);
      } else {
        alert(data.message || '操作过于频繁，请稍后再试');
      }
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    currentRoom = null;
    isOnlineMode = false;
    clearRoomState();
  }

  function createRoom() {
    if (!socket) return;
    socket.emit('createRoom');
  }

  function joinRoom(roomId) {
    if (!socket) return;
    socket.emit('joinRoom', { roomId });
  }

  function sendMove(fromRow, fromCol, toRow, toCol) {
    if (!socket || !currentRoom) return;
    socket.emit('move', {
      roomId: currentRoom.id,
      fromRow,
      fromCol,
      toRow,
      toCol
    });
  }

  function sendChat(message) {
    if (!socket || !currentRoom) return;
    socket.emit('chat', {
      roomId: currentRoom.id,
      message
    });
  }

  function leaveRoom() {
    if (socket && currentRoom) {
      socket.emit('leaveRoom', { roomId: currentRoom.id });
    }
    clearRoomState();
    disconnect();
  }

  function setCallbacks(callbacks) {
    if (callbacks.onRoomCreated) onRoomCreated = callbacks.onRoomCreated;
    if (callbacks.onRoomJoined) onRoomJoined = callbacks.onRoomJoined;
    if (callbacks.onPlayerJoined) onPlayerJoined = callbacks.onPlayerJoined;
    if (callbacks.onGameStart) onGameStart = callbacks.onGameStart;
    if (callbacks.onMoveResult) onMoveResult = callbacks.onMoveResult;
    if (callbacks.onChat) onChat = callbacks.onChat;
    if (callbacks.onPlayerLeft) onPlayerLeft = callbacks.onPlayerLeft;
    if (callbacks.onDisconnect) onDisconnect = callbacks.onDisconnect;
    if (callbacks.onReconnect) onReconnect = callbacks.onReconnect;
    if (callbacks.onRateLimited) onRateLimited = callbacks.onRateLimited;
  }

  const exports = {
    connect,
    disconnect,
    createRoom,
    joinRoom,
    sendMove,
    sendChat,
    leaveRoom,
    setCallbacks,
    getSocket: () => socket,
    getRoom: () => currentRoom,
    isOnline: () => isOnlineMode,
    isConnected: () => socket && socket.connected
  };

  window.Online = exports;
})();
