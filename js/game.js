// 斗兽棋游戏逻辑

// 棋子类型定义
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

// 玩家设置（特效/音效开关），localStorage 持久化
const SETTINGS_KEY = 'doushouqi-settings';
const settings = (function () {
    const defaults = { fxEnabled: true, soundEnabled: true };
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return Object.assign({}, defaults, JSON.parse(raw));
    } catch (e) { /* localStorage 不可用时静默 */ }
    return defaults;
})();

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* 静默 */ }
}

// 抽屉状态
let drawerState = {
  open: false,
  activeTab: null
};

// 移动日志
const moveLog = [];

// 游戏状态
let gameState = {
    board: [],
    currentPlayer: 'red',
    selectedPiece: null,
    validMoves: [],
    gameOver: false,
    redPieces: 8,
    bluePieces: 8,
    fxPlaying: false   // 特效播放中，禁止玩家操作
};

// 棋盘尺寸
const ROWS = 7;
const COLS = 9;

// 特殊地形位置
const RED_DEN = { row: 0, col: 3 };
const BLUE_DEN = { row: 6, col: 3 };

const RED_TRAPS = [
    { row: 0, col: 2 },
    { row: 0, col: 4 },
    { row: 1, col: 3 }
];

const BLUE_TRAPS = [
    { row: 6, col: 2 },
    { row: 6, col: 4 },
    { row: 5, col: 3 }
];

// 河流位置：棋盘中间三行，左右两侧各有两列河流，中间是陆地
const RIVER_CELLS = [
    // 第3行(索引2)
    { row: 2, col: 1 }, { row: 2, col: 2 },
    { row: 2, col: 6 }, { row: 2, col: 7 },
    // 第4行(索引3)
    { row: 3, col: 1 }, { row: 3, col: 2 },
    { row: 3, col: 6 }, { row: 3, col: 7 },
    // 第5行(索引4)
    { row: 4, col: 1 }, { row: 4, col: 2 },
    { row: 4, col: 6 }, { row: 4, col: 7 }
];

// 检查位置是否在棋盘内
function isValidPosition(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

// 检查是否是河流
function isRiver(row, col) {
    return RIVER_CELLS.some(cell => cell.row === row && cell.col === col);
}

// 检查是否是某方的兽穴
function isDen(row, col, player) {
    if (player === 'red') {
        return row === RED_DEN.row && col === RED_DEN.col;
    } else if (player === 'blue') {
        return row === BLUE_DEN.row && col === BLUE_DEN.col;
    }
    return false;
}

// 检查是否是某方的陷阱
function isTrap(row, col, player) {
    if (player === 'red') {
        return RED_TRAPS.some(trap => trap.row === row && trap.col === col);
    } else {
        return BLUE_TRAPS.some(trap => trap.row === row && trap.col === col);
    }
}

// 检查是否是敌方兽穴
function isEnemyDen(row, col, player) {
    if (player === 'red') {
        return row === BLUE_DEN.row && col === BLUE_DEN.col;
    } else {
        return row === RED_DEN.row && col === RED_DEN.col;
    }
}

// 初始化棋盘
function initBoard() {
    // 创建空棋盘
    gameState.board = [];
    for (let row = 0; row < ROWS; row++) {
        gameState.board[row] = [];
        for (let col = 0; col < COLS; col++) {
            gameState.board[row][col] = null;
        }
    }

    // ========== 红方棋子（顶部，玩家1）==========
    // 行0：象(左)、空、陷阱(左)、兽穴、陷阱(右)、空、狮(右)
    gameState.board[0][0] = { type: 'ELEPHANT', owner: 'red' };
    gameState.board[0][8] = { type: 'LION', owner: 'red' };
    
    // 行1：空、虎、空、陷阱、空、空、豹、空
    gameState.board[1][1] = { type: 'TIGER', owner: 'red' };
    gameState.board[1][6] = { type: 'LEOPARD', owner: 'red' };
    
    // 行2：狼、空、狗、空、猫、空、狗、空、鼠
    // 注意：行2有河，列1-2和列6-7是河，列0,3,4,5,8是陆地
    gameState.board[2][0] = { type: 'WOLF', owner: 'red' };
    gameState.board[2][8] = { type: 'RAT', owner: 'red' };
    gameState.board[2][3] = { type: 'DOG', owner: 'red' };
    gameState.board[2][5] = { type: 'CAT', owner: 'red' };

    // ========== 蓝方棋子（底部，玩家2）==========
    // 行6：狮(左)、空、陷阱(左)、兽穴、陷阱(右)、空、象(右)
    gameState.board[6][0] = { type: 'LION', owner: 'blue' };
    gameState.board[6][8] = { type: 'ELEPHANT', owner: 'blue' };
    
    // 行5：空、豹、空、陷阱、空、空、虎、空
    gameState.board[5][1] = { type: 'LEOPARD', owner: 'blue' };
    gameState.board[5][6] = { type: 'TIGER', owner: 'blue' };
    
    // 行4：鼠、空、狗、空、猫、空、狼、空...
    // 注意：行4有河，列1-2和列6-7是河，列0,3,4,5,8是陆地
    gameState.board[4][0] = { type: 'RAT', owner: 'blue' };
    gameState.board[4][8] = { type: 'WOLF', owner: 'blue' };
    gameState.board[4][3] = { type: 'CAT', owner: 'blue' };
    gameState.board[4][5] = { type: 'DOG', owner: 'blue' };

    // 检查棋子数量
    countPieces();
}

// 计算双方剩余棋子数
function countPieces() {
    let red = 0;
    let blue = 0;
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            if (gameState.board[row][col]) {
                if (gameState.board[row][col].owner === 'red') red++;
                else blue++;
            }
        }
    }
    gameState.redPieces = red;
    gameState.bluePieces = blue;
    document.getElementById('redCount').textContent = red;
    document.getElementById('blueCount').textContent = blue;
}

// 判断棋子是否可以吃另一个棋子
function canCapture(attacker, defender, defenderRow, defenderCol) {
    if (!attacker || !defender) return false;
    if (attacker.owner === defender.owner) return false;
    
    const attackerType = PIECE_TYPES[attacker.type];
    const defenderType = PIECE_TYPES[defender.type];
    
    // 如果防守方在己方陷阱里，则任人鱼肉
    if (isTrap(defenderRow, defenderCol, defender.owner)) {
        return true;
    }
    
    // 鼠可以吃象（特殊规则）
    if (attacker.type === 'RAT' && defender.type === 'ELEPHANT') {
        return true;
    }
    
    // 象不能吃鼠（象怕鼠）
    if (attacker.type === 'ELEPHANT' && defender.type === 'RAT') {
        return false;
    }
    
    // 普通规则：等级高的可以吃等级低的或同级
    return attackerType.level >= defenderType.level;
}

// 获取棋子可以移动到的所有位置
function getValidMoves(row, col) {
    const piece = gameState.board[row][col];
    if (!piece) return [];
    
    const moves = [];
    
    // 狮和虎可以跳河
    if (piece.type === 'LION' || piece.type === 'TIGER') {
        const directions = [
            { dr: -1, dc: 0 },
            { dr: 1, dc: 0 },
            { dr: 0, dc: -1 },
            { dr: 0, dc: 1 }
        ];
        
        for (const dir of directions) {
            let newRow = row + dir.dr;
            let newCol = col + dir.dc;
            let jumpedRiver = false;
            let blocked = false;
            
            while (isValidPosition(newRow, newCol)) {
                if (isRiver(newRow, newCol)) {
                    // 如果河里有棋子（鼠），则不能跳过
                    if (gameState.board[newRow][newCol]) {
                        blocked = true;
                        break;
                    }
                    jumpedRiver = true;
                    newRow += dir.dr;
                    newCol += dir.dc;
                } else {
                    // 到达陆地
                    if (jumpedRiver && !blocked) {
                        const target = gameState.board[newRow][newCol];
                        if (!target) {
                            moves.push({ row: newRow, col: newCol });
                        } else if (target.owner !== piece.owner) {
                            if (canCapture(piece, target, newRow, newCol)) {
                                moves.push({ row: newRow, col: newCol, capture: true });
                            }
                        }
                    }
                    break;
                }
            }
        }
    }
    
    // 普通移动：上下左右一格
    const directions = [
        { dr: -1, dc: 0 },
        { dr: 1, dc: 0 },
        { dr: 0, dc: -1 },
        { dr: 0, dc: 1 }
    ];
    
    for (const dir of directions) {
        const newRow = row + dir.dr;
        const newCol = col + dir.dc;
        
        if (!isValidPosition(newRow, newCol)) continue;
        
        // 检查是否是河流
        if (isRiver(newRow, newCol)) {
            if (piece.type !== 'RAT') continue;
        }
        
        // 检查是否是己方兽穴
        if (isDen(newRow, newCol, piece.owner)) continue;
        
        const targetPiece = gameState.board[newRow][newCol];
        
        if (!targetPiece) {
            moves.push({ row: newRow, col: newCol });
        } else if (targetPiece.owner !== piece.owner) {
            // 鼠在水中不能吃陆地上的棋子，陆地上的棋子也不能吃水中的鼠
            if (piece.type === 'RAT' && isRiver(row, col) !== isRiver(newRow, newCol)) {
                continue;
            }
            if (targetPiece.type === 'RAT' && isRiver(newRow, newCol) !== isRiver(row, col)) {
                continue;
            }
            
            if (canCapture(piece, targetPiece, newRow, newCol)) {
                moves.push({ row: newRow, col: newCol, capture: true });
            }
        }
    }
    
    return moves;
}

// 渲染棋盘
function renderBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = '';
    
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            
            // 添加地形类
            if (row === RED_DEN.row && col === RED_DEN.col) {
                cell.classList.add('den-red');
            } else if (row === BLUE_DEN.row && col === BLUE_DEN.col) {
                cell.classList.add('den-blue');
            } else if (RED_TRAPS.some(t => t.row === row && t.col === col)) {
                cell.classList.add('trap-red');
            } else if (BLUE_TRAPS.some(t => t.row === row && t.col === col)) {
                cell.classList.add('trap-blue');
            } else if (isRiver(row, col)) {
                cell.classList.add('river');
            }
            
            // 选中状态
            if (gameState.selectedPiece && 
                gameState.selectedPiece.row === row && 
                gameState.selectedPiece.col === col) {
                cell.classList.add('selected');
            }
            
            // 可移动标记
            const validMove = gameState.validMoves.find(m => m.row === row && m.col === col);
            if (validMove) {
                cell.classList.add('movable');
                if (validMove.capture) {
                    cell.classList.add('has-enemy');
                }
            }
            
            // 渲染棋子
            const piece = gameState.board[row][col];
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece ${piece.owner}`;
                
                if (gameState.selectedPiece && 
                    gameState.selectedPiece.row === row && 
                    gameState.selectedPiece.col === col) {
                    pieceElement.classList.add('selected-piece');
                }
                
                const pieceInfo = PIECE_TYPES[piece.type];
                const img = document.createElement('img');
                img.src = `assets/images/${piece.owner}/${pieceInfo.image}`;
                img.alt = pieceInfo.name;
                pieceElement.appendChild(img);
                
                const badge = document.createElement('div');
                badge.className = 'level-badge';
                badge.textContent = pieceInfo.level;
                pieceElement.appendChild(badge);
                
                cell.appendChild(pieceElement);
            }
            
            cell.addEventListener('click', () => handleCellClick(row, col));
            
            boardElement.appendChild(cell);
        }
    }
}

// 处理格子点击
async function handleCellClick(row, col) {
    if (gameState.gameOver) return;

    // 特效播放中，忽略点击
    if (gameState.fxPlaying) {
        updateHint('正在播放特效，请稍候…');
        return;
    }

    // 首次点击解锁音效
    if (window.FxSound && typeof window.FxSound.unlock === 'function') {
        try { window.FxSound.unlock(); } catch (e) { /* 静默 */ }
    }

    const clickedPiece = gameState.board[row][col];

    if (gameState.selectedPiece) {
        const validMove = gameState.validMoves.find(m => m.row === row && m.col === col);

        if (validMove) {
            await movePiece(gameState.selectedPiece.row, gameState.selectedPiece.col, row, col);
            return;
        }

        if (clickedPiece && clickedPiece.owner === gameState.currentPlayer) {
            selectPiece(row, col);
            return;
        }

        clearSelection();
        renderBoard();
        return;
    }

    if (clickedPiece && clickedPiece.owner === gameState.currentPlayer) {
        selectPiece(row, col);
    }
}

// 选择棋子
function selectPiece(row, col) {
    gameState.selectedPiece = { row, col };
    gameState.validMoves = getValidMoves(row, col);
    renderBoard();
    
    const piece = gameState.board[row][col];
    const pieceInfo = PIECE_TYPES[piece.type];
    if (gameState.validMoves.length === 0) {
        updateHint(`${pieceInfo.name}没有可以移动的位置，请选择其他棋子`);
    } else {
        const captureCount = gameState.validMoves.filter(m => m.capture).length;
        if (captureCount > 0) {
            updateHint(`已选择${pieceInfo.name}，可以移动到 ${gameState.validMoves.length} 个位置（含 ${captureCount} 个可吃子）`);
        } else {
            updateHint(`已选择${pieceInfo.name}，可以移动到 ${gameState.validMoves.length} 个位置`);
        }
    }
}

// 清除选择
function clearSelection() {
    gameState.selectedPiece = null;
    gameState.validMoves = [];
}

// 移动棋子
/**
 * 移动棋子（含吃子、跳河、兽穴、陷阱、反杀、移动）
 * - 动效优先：先播特效，再更新 board，最后换手
 * - 动画期间 fxPlaying = true，handleCellClick 自动拒绝点击
 */
async function movePiece(fromRow, fromCol, toRow, toCol) {
    const movingPiece = gameState.board[fromRow][fromCol];
    const capturedPiece = gameState.board[toRow][toCol];
    const pieceName = PIECE_TYPES[movingPiece.type].name;
    const playerName = movingPiece.owner === 'red' ? '红方' : '蓝方';

    // 锁棋盘
    gameState.fxPlaying = true;
    updateHint(`正在播放 ${playerName}${pieceName} 的动作…`);

    // 1. 事件分类
    const eventInfo = (window.FxBridge && window.FxBridge.categorizeMove)
        ? window.FxBridge.categorizeMove(movingPiece, capturedPiece, fromRow, fromCol, toRow, toCol)
        : { category: '移动', scene: 'move', animal: 'dog', defenderAnimal: null };

    // 2. 播放特效
    const fromCellEl = getCellEl(fromRow, fromCol);
    const toCellEl = getCellEl(toRow, toCol);
    if (window.FxBridge && window.FxBridge.playFor) {
        await window.FxBridge.playFor(eventInfo, {
            fromCellEl, toCellEl,
            attacker: movingPiece,
            defender: capturedPiece
        }, settings);
    }

    // 3. 记录日志（在覆盖目标格前）
    if (capturedPiece) {
        const capturedName = PIECE_TYPES[capturedPiece.type].name;
        logMove(`${playerName}${pieceName} 吃 ${capturedName}`, movingPiece.owner);
    } else {
        logMove(`${playerName}${pieceName} 移动到 (${toRow + 1},${toCol + 1})`, movingPiece.owner);
    }

    // 4. 真正更新棋盘
    gameState.board[toRow][toCol] = movingPiece;
    gameState.board[fromRow][fromCol] = null;

    clearSelection();

    // 5. 兽穴获胜判定
    if (isEnemyDen(toRow, toCol, movingPiece.owner)) {
        countPieces();
        renderBoard();
        gameState.fxPlaying = false;
        showWinner(movingPiece.owner, '成功占领敌方兽穴！');
        return;
    }

    countPieces();
    if (movingPiece.owner === 'red' && gameState.bluePieces === 0) {
        renderBoard();
        gameState.fxPlaying = false;
        showWinner('red', '已消灭所有敌方棋子！');
        return;
    }
    if (movingPiece.owner === 'blue' && gameState.redPieces === 0) {
        renderBoard();
        gameState.fxPlaying = false;
        showWinner('blue', '已消灭所有敌方棋子！');
        return;
    }

    // 6. 换手
    gameState.currentPlayer = movingPiece.owner === 'red' ? 'blue' : 'red';
    renderBoard();
    updateTurnIndicator();
    updateHint(`等待${gameState.currentPlayer === 'red' ? '红方' : '蓝方'}行动...`);
    gameState.fxPlaying = false;
}

// 更新回合指示器
function updateTurnIndicator() {
    const turnPlayer = document.getElementById('turnPlayer');
    turnPlayer.textContent = gameState.currentPlayer === 'red' ? '红方' : '蓝方';
    
    const playerRed = document.getElementById('playerRed');
    const playerBlue = document.getElementById('playerBlue');
    
    playerRed.classList.toggle('active', gameState.currentPlayer === 'red');
    playerBlue.classList.toggle('active', gameState.currentPlayer === 'blue');
    
    document.getElementById('redStatus').textContent = 
        gameState.currentPlayer === 'red' ? '行动中' : '等待中';
    document.getElementById('blueStatus').textContent = 
        gameState.currentPlayer === 'blue' ? '行动中' : '等待中';
}

// 更新提示信息
function updateHint(text) {
    document.getElementById('actionHint').innerHTML = `<span>${text}</span>`;
}

// 显示获胜者
function showWinner(winner, reason) {
    gameState.gameOver = true;
    const modal = document.getElementById('winModal');
    const title = document.getElementById('winTitle');
    const message = document.getElementById('winMessage');
    
    title.textContent = `🎉 游戏结束`;
    message.textContent = `${winner === 'red' ? '红方' : '蓝方'}获胜！${reason}`;
    
    modal.classList.add('show');
}

// 重新开始游戏
function restartGame() {
    const modal = document.getElementById('winModal');
    modal.classList.remove('show');
    
    gameState = {
        board: [],
        currentPlayer: 'red',
        selectedPiece: null,
        validMoves: [],
        gameOver: false,
        redPieces: 8,
        bluePieces: 8,
        fxPlaying: false
    };
    
    initBoard();
    renderBoard();
    updateTurnIndicator();
    updateHint('游戏开始！请红方选择棋子移动');
    moveLog.length = 0;
    renderLog();
}

// 暴露给 FxBridge 使用的全局工具函数（兜底逻辑）
window.isRiver = isRiver;
window.isEnemyDen = isEnemyDen;
window.isTrap = isTrap;

/**
 * 根据 row/col 找到棋盘 DOM 格子
 */
function getCellEl(row, col) {
    const board = document.getElementById('board');
    if (!board) return null;
    return board.querySelector(`[data-row="${row}"][data-col="${col}"]`);
}

// 初始化游戏
function initGame() {
    document.getElementById('btnRestart').addEventListener('click', restartGame);
    document.getElementById('btnModalRestart').addEventListener('click', restartGame);

    // 抽屉交互
    document.querySelectorAll('.drawer-tab').forEach(tab => {
        tab.addEventListener('click', () => toggleDrawer(tab.dataset.tab));
    });
    document.getElementById('drawerToggle').addEventListener('click', () => toggleDrawer(null));

    // 开关绑定（特效 / 音效）
    const fxToggle = document.getElementById('toggleFx');
    const soundToggle = document.getElementById('toggleSound');
    if (fxToggle) {
        fxToggle.checked = settings.fxEnabled;
        fxToggle.addEventListener('change', function () {
            settings.fxEnabled = this.checked;
            saveSettings();
        });
    }
    if (soundToggle) {
        soundToggle.checked = settings.soundEnabled;
        soundToggle.addEventListener('change', function () {
            settings.soundEnabled = this.checked;
            if (window.FxSound) window.FxSound.setMuted(!this.checked);
            saveSettings();
        });
        if (window.FxSound) window.FxSound.setMuted(!soundToggle.checked);
    }

    initBoard();
    renderBoard();
    updateTurnIndicator();
    updateHint('游戏开始！请红方选择棋子移动');
}

// 切换抽屉
function toggleDrawer(tabName) {
    const drawer = document.getElementById('drawer');
    const toggle = document.getElementById('drawerToggle');
    const tabs = document.querySelectorAll('.drawer-tab');
    const panels = document.querySelectorAll('.drawer-body');

    // 点同一个 tab 或收起 → 关闭
    if (drawerState.open && drawerState.activeTab === tabName) {
        drawerState = { open: false, activeTab: null };
        drawer.classList.remove('open');
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.hidden = true);
        toggle.textContent = '展开 ↓';
        return;
    }

    // 点 toggle 且已打开 → 关闭
    if (tabName === null && drawerState.open) {
        drawerState = { open: false, activeTab: null };
        drawer.classList.remove('open');
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.hidden = true);
        toggle.textContent = '展开 ↓';
        return;
    }

    // 打开指定 tab
    drawerState = { open: true, activeTab: tabName };
    drawer.classList.add('open');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    panels.forEach(p => p.hidden = p.dataset.panel !== tabName);
    toggle.textContent = '收起 ↑';
}

// 记录移动日志
function logMove(text, owner) {
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    moveLog.unshift({ time: t, text, owner });
    if (moveLog.length > 50) moveLog.pop();
    renderLog();
}

function renderLog() {
    const list = document.getElementById('logList');
    if (!list) return;
    if (moveLog.length === 0) {
        list.innerHTML = '<div class="log-entry">暂无记录</div>';
        return;
    }
    list.innerHTML = moveLog.map(e =>
        `<div class="log-entry ${e.owner || ''}">[${e.time}] ${e.text}</div>`
    ).join('');
}

document.addEventListener('DOMContentLoaded', initGame);
