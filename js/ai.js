/* ============================================================
   斗兽棋 AI（贪心 + 1 步前瞻）
   - 评分因素：
       ① 入对方兽穴：10000（直接胜）
       ② 吃子：对方棋子等级 × 10（鼠吃象额外 +50）
       ③ 走入己方陷阱：-30（会被对方免费吃）
       ④ 落点会被对方下一步吃掉：-我方棋子等级 × 12
       ⑤ 距对方兽穴越近越好：+（14 - 曼哈顿距离）× 2
   - 性能：每步最多枚举 16 × 4 ≈ 64 候选，落点威胁评估 O(16 × 64) = O(1024)，
          加上 getValidMoves 中的 RIVER/TRAP 查找，总单步 < 5ms，可放心使用。
   ============================================================ */
(function () {
  const { PIECE_TYPES, RED_DEN, BLUE_DEN, ROWS, COLS, isTrap, isEnemyDen, getValidMoves } = window;

  /**
   * 单步走法评分（不开新 board，靠临时改 board 推演 1 步）
   * @returns {number} 分数越高越优
   */
  function scoreMove(state, fromR, fromC, toR, toC) {
    const piece = state.board[fromR][fromC];
    const target = state.board[toR][toC];
    const opponent = piece.owner === 'red' ? 'blue' : 'red';
    const oppDen = piece.owner === 'red' ? BLUE_DEN : RED_DEN;

    // ① 入穴直接胜
    if (isEnemyDen(toR, toC, piece.owner)) return 10000;

    let s = 0;

    // ② 吃子得分
    if (target && target.owner !== piece.owner) {
      s += PIECE_TYPES[target.type].level * 10;
      if (piece.type === 'RAT' && target.type === 'ELEPHANT') s += 50;
    }

    // ③ 走入己方陷阱：危险
    if (isTrap(toR, toC, piece.owner)) s -= 30;

    // ④ 落点会被对方下一步吃 → 临时推演
    state.board[toR][toC] = piece;
    state.board[fromR][fromC] = null;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const opp = state.board[r][c];
        if (!opp || opp.owner !== opponent) continue;
        const moves = getValidMoves(r, c);
        for (const m of moves) {
          if (m.row === toR && m.col === toC && m.capture) {
            // 对方能吃我 → 大幅减分
            s -= PIECE_TYPES[piece.type].level * 12;
            break;
          }
        }
      }
    }
    // 还原 board（避免污染真实状态）
    state.board[fromR][fromC] = piece;
    state.board[toR][toC] = target;

    // ⑤ 越接近对方兽穴越好
    const dist = Math.abs(toR - oppDen.row) + Math.abs(toC - oppDen.col);
    s += Math.max(0, (14 - dist)) * 2;

    return s;
  }

  /**
   * 枚举当前玩家所有合法走法并选最高分
   * @returns {{from:{row,col},to:{row,col},capture:boolean}|null}
   */
  function pickMove(state) {
    const player = state.currentPlayer;
    let best = null;
    let bestScore = -Infinity;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = state.board[r][c];
        if (!piece || piece.owner !== player) continue;
        const moves = getValidMoves(r, c);
        for (const m of moves) {
          const s = scoreMove(state, r, c, m.row, m.col);
          if (s > bestScore) {
            bestScore = s;
            best = { from: { row: r, col: c }, to: { row: m.row, col: m.col, capture: !!m.capture } };
          }
        }
      }
    }
    return best;
  }

  window.DouShouQiAI = { pickMove, scoreMove };
})();
