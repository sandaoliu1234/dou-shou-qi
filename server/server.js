const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, '..')));
app.use(express.json());

const RoomManager = require('./room-manager');
const RateLimiter = require('./rate-limiter');

const roomManager = new RoomManager();
const rateLimiter = new RateLimiter();

// 服务端启动时间
const serverStartTime = Date.now();

// 限制配置：每个 socket 在 1 秒时间窗内的最大请求数
const RATE_LIMITS = {
  createRoom: { max: 1, window: 5000 },    // 5 秒最多 1 次
  joinRoom:   { max: 3, window: 5000 },    // 5 秒最多 3 次
  move:       { max: 5, window: 1000 },    // 1 秒最多 5 次
  chat:       { max: 5, window: 1000 },    // 1 秒最多 5 条消息
  syncState:  { max: 2, window: 1000 }     // 1 秒最多 2 次
};

function checkRate(socketId, action) {
  const cfg = RATE_LIMITS[action];
  if (!cfg) return true;
  return rateLimiter.check(socketId, action, cfg.max, cfg.window);
}

// ============= HTTP 路由 =============

// 健康检查端点
app.get('/health', (req, res) => {
  const roomStats = roomManager.getStats();
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    rooms: roomStats,
    timestamp: Date.now()
  });
});

// 房间查询端点（不暴露敏感信息）
app.get('/api/rooms', (req, res) => {
  const rooms = roomManager.listRooms().map(r => ({
    id: r.id,
    status: r.status,
    playerCount: r.playerCount,
    createdAt: r.createdAt
  }));
  res.json({ rooms });
});

// ============= Socket.IO 事件 =============

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('createRoom', () => {
    if (!checkRate(socket.id, 'createRoom')) {
      socket.emit('rateLimited', { action: 'createRoom', message: '操作过于频繁' });
      return;
    }

    const room = roomManager.createRoom(socket.id);
    socket.join(room.id);
    socket.emit('roomCreated', room.toDTO());
    console.log(`Room created: ${room.id}, player: ${socket.id}`);
  });

  socket.on('joinRoom', ({ roomId }) => {
    if (!checkRate(socket.id, 'joinRoom')) {
      socket.emit('rateLimited', { action: 'joinRoom', message: '操作过于频繁' });
      return;
    }
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('joinFailed', { error: '房间号无效' });
      return;
    }

    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('joinFailed', { error: '房间不存在' });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('joinFailed', { error: '房间已满或游戏已开始' });
      return;
    }
    if (room.players.some(p => p.id === socket.id)) {
      socket.emit('joinFailed', { error: '你已在该房间中' });
      return;
    }

    room.addPlayer(socket.id);
    socket.join(roomId);

    socket.emit('roomJoined', room.toDTO());
    socket.to(roomId).emit('playerJoined', room.toDTO());

    if (room.players.length === 2) {
      room.startGame();
      io.to(roomId).emit('gameStart', room.toDTO());
      console.log(`Game started in room: ${room.id}`);
    }
    console.log(`Player ${socket.id} joined room: ${roomId}`);
  });

  socket.on('move', ({ roomId, fromRow, fromCol, toRow, toCol }) => {
    if (!checkRate(socket.id, 'move')) {
      socket.emit('moveResult', { success: false, error: '操作过于频繁，请稍后再试' });
      return;
    }

    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('moveResult', { success: false, error: '房间不存在' });
      return;
    }
    // 严格校验：房间状态必须是 playing
    if (room.status !== 'playing') {
      socket.emit('moveResult', { success: false, error: '游戏未开始或已结束' });
      return;
    }
    // 严格校验：发起者必须是房间内的玩家
    const player = room.getPlayer(socket.id);
    if (!player) {
      socket.emit('moveResult', { success: false, error: '你不是该房间的玩家' });
      return;
    }
    // 严格校验：玩家不能处于断线状态（超过重连窗口）
    if (player.disconnected) {
      socket.emit('moveResult', { success: false, error: '你已断线，请重新加入' });
      return;
    }
    // 严格校验：必须是当前回合
    if (room.turn !== player.side) {
      socket.emit('moveResult', { success: false, error: '还没轮到你' });
      return;
    }
    // 严格校验：坐标合法
    if (![fromRow, fromCol, toRow, toCol].every(v => Number.isInteger(v) && v >= 0 && v < 7)) {
      socket.emit('moveResult', { success: false, error: '坐标无效' });
      return;
    }

    const result = room.executeMove(socket.id, fromRow, fromCol, toRow, toCol);
    socket.emit('moveResult', result);
    socket.to(roomId).emit('moveResult', result);

    if (result.winner) {
      room.status = 'ended';
      io.to(roomId).emit('gameEnd', room.toDTO());
      console.log(`Game ended in room ${room.id}, winner: ${result.winner}`);
    }
  });

  socket.on('chat', ({ roomId, message }) => {
    if (!checkRate(socket.id, 'chat')) {
      socket.emit('rateLimited', { action: 'chat', message: '发送过于频繁' });
      return;
    }

    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const player = room.getPlayer(socket.id);
    if (!player) return;

    // 校验消息内容
    if (typeof message !== 'string') return;
    const trimmed = message.trim();
    if (!trimmed) return;
    if (trimmed.length > 200) {
      socket.emit('rateLimited', { action: 'chat', message: '消息过长（最多 200 字）' });
      return;
    }

    const chatData = room.addChatMessage(socket.id, trimmed);
    if (chatData) {
      io.to(roomId).emit('chat', { ...chatData, roomId });
    }
  });

  socket.on('syncState', ({ roomId }) => {
    if (!checkRate(socket.id, 'syncState')) return;
    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('syncState', { notFound: true, roomId });
      return;
    }
    socket.emit('syncState', room.toDTO());
  });

  socket.on('leaveRoom', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    room.removePlayer(socket.id);
    socket.leave(roomId);
    io.to(roomId).emit('playerLeft', room.toDTO());
    console.log(`Player ${socket.id} left room: ${roomId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    rateLimiter.clearAll(socket.id);
    roomManager.handleDisconnect(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// 优雅关闭
function shutdown() {
  console.log('正在关闭服务...');
  rateLimiter.stop();
  roomManager.saveRooms();
  server.close(() => {
    console.log('服务已关闭');
    process.exit(0);
  });
  // 强制退出
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
