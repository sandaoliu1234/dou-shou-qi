const fs = require('fs');
const path = require('path');
const GameCore = require('../js/game-core');

const ROOM_DATA_FILE = path.join(__dirname, 'rooms.json');
const RECONNECT_WINDOW = 5 * 60 * 1000;

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.loadRooms();
    setInterval(() => this.saveRooms(), 10000);
    setInterval(() => this.cleanupStaleRooms(), 60000);
  }

  loadRooms() {
    try {
      if (!fs.existsSync(ROOM_DATA_FILE)) {
        console.log('[RoomManager] 房间数据文件不存在，跳过加载');
        return;
      }
      const data = fs.readFileSync(ROOM_DATA_FILE, 'utf-8');
      const saved = JSON.parse(data);
      for (const roomId in saved) {
        const roomData = saved[roomId];
        if (roomData.status !== 'ended') {
          const room = new Room(roomId, roomData);
          this.rooms.set(roomId, room);
        }
      }
      console.log(`[RoomManager] 成功加载 ${this.rooms.size} 个未结束房间`);
    } catch (e) {
      console.error('[RoomManager] 加载房间数据失败:', e.message);
      console.error(e);
    }
  }

  saveRooms() {
    const data = {};
    this.rooms.forEach((room, id) => {
      data[id] = {
        status: room.status,
        turn: room.turn,
        board: room.board,
        winner: room.winner,
        winReason: room.winReason,
        players: room.players.map(p => ({ id: p.id, side: p.side, name: p.name, disconnected: p.disconnected })),
        chatHistory: room.chatHistory
      };
    });
    try {
      // 先写到临时文件，再重命名，避免写入过程中崩溃导致文件损坏
      const tmpFile = ROOM_DATA_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      fs.renameSync(tmpFile, ROOM_DATA_FILE);
    } catch (e) {
      console.error('[RoomManager] 保存房间数据失败:', e.message);
      console.error(e);
    }
  }

  // 获取房间统计信息（健康检查使用）
  getStats() {
    let waiting = 0, playing = 0, ended = 0;
    this.rooms.forEach(room => {
      if (room.status === 'waiting') waiting++;
      else if (room.status === 'playing') playing++;
      else if (room.status === 'ended') ended++;
    });
    return {
      total: this.rooms.size,
      waiting,
      playing,
      ended
    };
  }

  // 获取房间列表（不暴露敏感信息）
  listRooms() {
    const list = [];
    this.rooms.forEach(room => {
      list.push({
        id: room.id,
        status: room.status,
        playerCount: room.players.length,
        createdAt: room.lastActivity
      });
    });
    return list;
  }

  cleanupStaleRooms() {
    const now = Date.now();
    this.rooms.forEach((room, id) => {
      if (room.status === 'ended' && now - room.lastActivity > 300000) {
        this.rooms.delete(id);
        console.log(`[RoomManager] 清理已结束房间: ${id}`);
      }
    });
  }

  // 生成唯一的 4 位房间号，最多尝试 100 次避免极端情况
  generateRoomId(maxAttempts = 100) {
    for (let i = 0; i < maxAttempts; i++) {
      const id = Math.floor(1000 + Math.random() * 9000).toString();
      if (!this.rooms.has(id)) return id;
    }
    // 极端情况：1000-9999 全部冲突（不可能，但兜底）
    throw new Error('无法生成唯一房间号，请稍后重试');
  }

  createRoom(playerId) {
    const id = this.generateRoomId();
    const room = new Room(id);
    room.addPlayer(playerId);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id) {
    return this.rooms.get(id);
  }

  handleDisconnect(playerId) {
    this.rooms.forEach((room) => {
      const player = room.getPlayer(playerId);
      if (player) {
        room.markDisconnected(playerId);
      }
    });
  }
}

class Room {
  constructor(id, data = null) {
    this.id = id;
    this.players = [];
    this.status = data?.status || 'waiting';
    this.turn = data?.turn || 'red';
    this.board = data?.board || GameCore.initBoard();
    this.winner = data?.winner || null;
    this.winReason = data?.winReason || '';
    this.chatHistory = data?.chatHistory || [];
    this.lastActivity = Date.now();
    this.reconnectTimers = new Map();
  }

  addPlayer(playerId) {
    const side = this.players.length === 0 ? 'red' : 'blue';
    this.players.push({
      id: playerId,
      side,
      name: side === 'red' ? '红方' : '蓝方',
      disconnected: false
    });
    this.lastActivity = Date.now();
  }

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId);
  }

  getPlayerSide(playerId) {
    const player = this.getPlayer(playerId);
    return player ? player.side : null;
  }

  markDisconnected(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return;

    player.disconnected = true;

    const timer = setTimeout(() => {
      this.removePlayer(playerId);
      this.reconnectTimers.delete(playerId);
    }, RECONNECT_WINDOW);

    this.reconnectTimers.set(playerId, timer);
    this.lastActivity = Date.now();
  }

  removePlayer(playerId) {
    const index = this.players.findIndex(p => p.id === playerId);
    if (index === -1) return;

    const timer = this.reconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(playerId);
    }

    this.players.splice(index, 1);
    this.lastActivity = Date.now();

    if (this.status === 'playing' && this.players.length === 0) {
      this.status = 'ended';
    }
  }

  startGame() {
    this.status = 'playing';
    this.turn = 'red';
    this.lastActivity = Date.now();
  }

  executeMove(playerId, fromRow, fromCol, toRow, toCol) {
    const side = this.getPlayerSide(playerId);
    if (side !== this.turn) {
      return { success: false, error: '还没轮到你' };
    }

    const result = GameCore.executeMove(this.board, fromRow, fromCol, toRow, toCol);
    if (result.success) {
      this.board = result.board;
      this.turn = result.turn;
      this.winner = result.winner;
      this.winReason = result.winReason;
      if (result.winner) {
        this.status = 'ended';
      }
      this.lastActivity = Date.now();
    }

    return result;
  }

  addChatMessage(playerId, message) {
    const player = this.getPlayer(playerId);
    if (!player) return null;
    const chatData = {
      playerSide: player.side,
      playerName: player.name,
      message,
      timestamp: Date.now()
    };
    this.chatHistory.push(chatData);
    if (this.chatHistory.length > 50) this.chatHistory.shift();
    this.lastActivity = Date.now();
    return chatData;
  }

  toDTO() {
    return {
      id: this.id,
      status: this.status,
      turn: this.turn,
      board: this.board,
      winner: this.winner,
      winReason: this.winReason,
      players: this.players.map(p => ({
        id: p.id,
        side: p.side,
        name: p.name,
        disconnected: p.disconnected
      })),
      playerCount: this.players.length,
      chatHistory: this.chatHistory
    };
  }
}

module.exports = RoomManager;
