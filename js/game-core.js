/* ============================================================
   斗兽棋纯游戏逻辑（零 DOM/动画依赖）
   供客户端和服务端共用
   ============================================================ */
(function () {
  const PIECE_TYPES = {
    ELEPHANT: { name: '象', level: 8, image: 'elephant.svg' },
    LION: { name: '狮', level: 7, image: 'lion.svg' },
    TIGER: { name: '虎', level: 6, image: 'tiger.svg' },
    LEOPARD: { name: '豹', level: 5, image: 'leopard.svg' },
    WOLF: { name: '狼', level: 4, image: 'wolf.svg' },
    DOG: { name: '狗', level: 3, image: 'dog.svg' },
    CAT: { name: '猫', level: 2, image: 'cat.svg' },
    RAT: { name: '鼠', level: 1, image: 'rat.svg' }
  };

  const ROWS = 7;
  const COLS = 9;

  const RED_DEN = { row: 0, col: 3 };
  const BLUE_DEN = { row: 6, col: 3 };

  const RED_TRAPS = [
    { row: 0, col: 2 }, { row: 0, col: 4 }, { row: 1, col: 3 }
  ];

  const BLUE_TRAPS = [
    { row: 6, col: 2 }, { row: 6, col: 4 }, { row: 5, col: 3 }
  ];

  const RIVER_CELLS = [
    { row: 2, col: 1 }, { row: 2, col: 2 },
    { row: 2, col: 6 }, { row: 2, col: 7 },
    { row: 3, col: 1 }, { row: 3, col: 2 },
    { row: 3, col: 6 }, { row: 3, col: 7 },
    { row: 4, col: 1 }, { row: 4, col: 2 },
    { row: 4, col: 6 }, { row: 4, col: 7 }
  ];

  const ORTHOGONAL_DIRS = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 }
  ];

  function isValidPosition(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS;
  }

  function isRiver(row, col) {
    return RIVER_CELLS.some(cell => cell.row === row && cell.col === col);
  }

  function isDen(row, col, player) {
    if (player === 'red') {
      return row === RED_DEN.row && col === RED_DEN.col;
    } else if (player === 'blue') {
      return row === BLUE_DEN.row && col === BLUE_DEN.col;
    }
    return false;
  }

  function isTrap(row, col, player) {
    if (player === 'red') {
      return RED_TRAPS.some(trap => trap.row === row && trap.col === col);
    } else {
      return BLUE_TRAPS.some(trap => trap.row === row && trap.col === col);
    }
  }

  function isEnemyDen(row, col, player) {
    if (player === 'red') {
      return row === BLUE_DEN.row && col === BLUE_DEN.col;
    } else {
      return row === RED_DEN.row && col === RED_DEN.col;
    }
  }

  function canCapture(attacker, defender, defenderRow, defenderCol) {
    if (!attacker || !defender) return false;
    if (attacker.owner === defender.owner) return false;

    if (isTrap(defenderRow, defenderCol, defender.owner)) {
      return true;
    }

    if (attacker.type === 'RAT' && defender.type === 'ELEPHANT') {
      return true;
    }

    if (attacker.type === 'ELEPHANT' && defender.type === 'RAT') {
      return false;
    }

    return PIECE_TYPES[attacker.type].level >= PIECE_TYPES[defender.type].level;
  }

  function initBoard() {
    const board = [];
    for (let row = 0; row < ROWS; row++) {
      board[row] = [];
      for (let col = 0; col < COLS; col++) {
        board[row][col] = null;
      }
    }

    board[0][0] = { type: 'ELEPHANT', owner: 'red' };
    board[0][8] = { type: 'LION', owner: 'red' };
    board[1][1] = { type: 'TIGER', owner: 'red' };
    board[1][6] = { type: 'LEOPARD', owner: 'red' };
    board[2][0] = { type: 'WOLF', owner: 'red' };
    board[2][8] = { type: 'RAT', owner: 'red' };
    board[2][3] = { type: 'DOG', owner: 'red' };
    board[2][5] = { type: 'CAT', owner: 'red' };

    board[6][0] = { type: 'LION', owner: 'blue' };
    board[6][8] = { type: 'ELEPHANT', owner: 'blue' };
    board[5][1] = { type: 'LEOPARD', owner: 'blue' };
    board[5][6] = { type: 'TIGER', owner: 'blue' };
    board[4][0] = { type: 'RAT', owner: 'blue' };
    board[4][8] = { type: 'WOLF', owner: 'blue' };
    board[4][3] = { type: 'CAT', owner: 'blue' };
    board[4][5] = { type: 'DOG', owner: 'blue' };

    return board;
  }

  function countPieces(board) {
    let red = 0;
    let blue = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (board[row][col]) {
          if (board[row][col].owner === 'red') red++;
          else blue++;
        }
      }
    }
    return { red, blue };
  }

  function getLionTigerJumpMoves(board, piece, row, col) {
    if (piece.type !== 'LION' && piece.type !== 'TIGER') return [];

    const moves = [];
    for (const dir of ORTHOGONAL_DIRS) {
      let r = row + dir.dr;
      let c = col + dir.dc;
      let crossedRiver = false;

      while (isValidPosition(r, c) && isRiver(r, c)) {
        if (board[r][c]) {
          crossedRiver = false;
          break;
        }
        crossedRiver = true;
        r += dir.dr;
        c += dir.dc;
      }

      if (!crossedRiver) continue;
      if (!isValidPosition(r, c)) continue;
      if (isDen(r, c, piece.owner)) continue;

      const target = board[r][c];
      if (!target) {
        moves.push({ row: r, col: c });
      } else if (target.owner !== piece.owner && canCapture(piece, target, r, c)) {
        moves.push({ row: r, col: c, capture: true });
      }
    }
    return moves;
  }

  function getNormalMoves(board, piece, row, col) {
    const moves = [];

    for (const dir of ORTHOGONAL_DIRS) {
      const r = row + dir.dr;
      const c = col + dir.dc;
      if (!isValidPosition(r, c)) continue;
      if (isRiver(r, c) && piece.type !== 'RAT') continue;
      if (isDen(r, c, piece.owner)) continue;

      const target = board[r][c];
      if (!target) {
        moves.push({ row: r, col: c });
        continue;
      }
      if (target.owner === piece.owner) continue;

      const fromRiver = isRiver(row, col);
      const toRiver = isRiver(r, c);
      if (fromRiver !== toRiver &&
          (piece.type === 'RAT' || target.type === 'RAT')) {
        continue;
      }

      if (canCapture(piece, target, r, c)) {
        moves.push({ row: r, col: c, capture: true });
      }
    }
    return moves;
  }

  function getValidMoves(board, row, col) {
    const piece = board[row][col];
    if (!piece) return [];

    const moves = [];
    moves.push(...getLionTigerJumpMoves(board, piece, row, col));
    moves.push(...getNormalMoves(board, piece, row, col));
    return moves;
  }

  function hasAnyValidMove(board, player) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const piece = board[row][col];
        if (piece && piece.owner === player) {
          const moves = getValidMoves(board, row, col);
          if (moves.length > 0) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function cloneBoard(board) {
    return board.map(row => row.map(cell => cell ? { ...cell } : null));
  }

  /**
   * 执行走棋（纯函数，不修改原 board）
   * @returns {Object} { success, board, captured, winner, winReason }
   */
  function executeMove(board, fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow][fromCol];
    if (!piece) return { success: false, error: '没有棋子' };

    const validMoves = getValidMoves(board, fromRow, fromCol);
    const isValid = validMoves.some(m => m.row === toRow && m.col === toCol);
    if (!isValid) return { success: false, error: '走法不合法' };

    const newBoard = cloneBoard(board);
    const captured = newBoard[toRow][toCol];
    newBoard[toRow][toCol] = piece;
    newBoard[fromRow][fromCol] = null;

    const opponent = piece.owner === 'red' ? 'blue' : 'red';
    const pieces = countPieces(newBoard);

    if (isEnemyDen(toRow, toCol, piece.owner)) {
      return {
        success: true,
        board: newBoard,
        captured,
        turn: opponent,
        winner: piece.owner,
        winReason: '成功占领敌方兽穴！'
      };
    }

    if (piece.owner === 'red' && pieces.blue === 0) {
      return {
        success: true,
        board: newBoard,
        captured,
        turn: opponent,
        winner: 'red',
        winReason: '已消灭所有敌方棋子！'
      };
    }

    if (piece.owner === 'blue' && pieces.red === 0) {
      return {
        success: true,
        board: newBoard,
        captured,
        turn: opponent,
        winner: 'blue',
        winReason: '已消灭所有敌方棋子！'
      };
    }

    if (!hasAnyValidMove(newBoard, opponent)) {
      return {
        success: true,
        board: newBoard,
        captured,
        turn: opponent,
        winner: piece.owner,
        winReason: '对方棋子全部被困，无法行动！'
      };
    }

    return {
      success: true,
      board: newBoard,
      captured,
      turn: opponent,
      winner: null,
      winReason: ''
    };
  }

  const exports = {
    PIECE_TYPES, ROWS, COLS,
    RED_DEN, BLUE_DEN, RED_TRAPS, BLUE_TRAPS, RIVER_CELLS, ORTHOGONAL_DIRS,
    isValidPosition, isRiver, isDen, isTrap, isEnemyDen, canCapture,
    initBoard, countPieces, getValidMoves, hasAnyValidMove, executeMove, cloneBoard
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    window.GameCore = exports;
  }
})();
