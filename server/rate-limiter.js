/**
 * 简单的内存速率限制器
 * 用于防止客户端滥用事件（恶意刷消息、刷走棋请求等）
 *
 * 使用方法：
 *   const rateLimiter = require('./rate-limiter');
 *   if (!rateLimiter.check(socketId, 'chat', 5)) {
 *     socket.emit('rateLimited', { action: 'chat' });
 *     return;
 *   }
 */
class RateLimiter {
  constructor() {
    // key: `${socketId}:${action}` -> 数组（最近请求时间戳）
    this.history = new Map();
    // 定期清理过期数据，避免内存泄漏
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    this.cleanupInterval.unref?.();
  }

  /**
   * 检查是否允许执行
   * @param {string} id 唯一标识（socketId）
   * @param {string} action 行为名称
   * @param {number} maxPerWindow 时间窗内最大次数
   * @param {number} windowMs 时间窗大小（毫秒），默认 1000
   * @returns {boolean} true=允许，false=触发限制
   */
  check(id, action, maxPerWindow, windowMs = 1000) {
    const now = Date.now();
    const key = `${id}:${action}`;
    const history = this.history.get(key) || [];

    // 清理时间窗外的旧记录
    const recent = history.filter(t => now - t < windowMs);

    if (recent.length >= maxPerWindow) {
      this.history.set(key, recent);
      return false;
    }

    recent.push(now);
    this.history.set(key, recent);
    return true;
  }

  /**
   * 重置某行为计数（如玩家断线后清理）
   */
  reset(id, action) {
    this.history.delete(`${id}:${action}`);
  }

  /**
   * 清理某 socket 的所有记录
   */
  clearAll(id) {
    for (const key of this.history.keys()) {
      if (key.startsWith(`${id}:`)) {
        this.history.delete(key);
      }
    }
  }

  /**
   * 清理过期记录
   */
  cleanup() {
    const now = Date.now();
    for (const [key, history] of this.history.entries()) {
      const recent = history.filter(t => now - t < 60000);
      if (recent.length === 0) {
        this.history.delete(key);
      } else {
        this.history.set(key, recent);
      }
    }
  }

  /**
   * 停止清理定时器
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

module.exports = RateLimiter;
