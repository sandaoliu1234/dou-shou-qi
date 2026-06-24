// 斗兽棋游戏逻辑（UI层）

// 从 GameCore 引入纯游戏逻辑
const {
  PIECE_TYPES, ROWS, COLS,
  RED_DEN, BLUE_DEN, RED_TRAPS, BLUE_TRAPS,
  isValidPosition, isRiver, isDen, isTrap, isEnemyDen, canCapture,
  initBoard: gcInitBoard, countPieces: gcCountPieces,
  getValidMoves: gcGetValidMoves, hasAnyValidMove: gcHasAnyValidMove,
  executeMove: gcExecuteMove, cloneBoard
} = window.GameCore;
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
    fxPlaying: false,   // 特效播放中，禁止玩家操作
    history: [],        // 走棋历史栈（每条含 board 快照 + 走棋信息，供悔棋使用）
    mode: 'pvp',        // 'pvp' 双人 / 'pve' 人机 / 'online' 联机
    aiSide: null,       // 'red' | 'blue' | null
    onlineSide: null    // 联机模式下自己的执子方
};

// 初始化棋盘
function initBoard() {
    gameState.board = gcInitBoard();
    countPieces();
}

// 计算双方剩余棋子数
function countPieces() {
    const pieces = gcCountPieces(gameState.board);
    gameState.redPieces = pieces.red;
    gameState.bluePieces = pieces.blue;
    document.getElementById('redCount').textContent = pieces.red;
    document.getElementById('blueCount').textContent = pieces.blue;
}

// 获取棋子可以移动到的所有位置
function getValidMoves(row, col) {
    return gcGetValidMoves(gameState.board, row, col);
}

// 检查某一方是否有任何合法移动（用于困毙判定）
function hasAnyValidMove(player) {
    return gcHasAnyValidMove(gameState.board, player);
}

// 渲染棋盘
let boardCells = [];

function createBoardCells() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = '';
    boardCells = [];
    
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            
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
            
            cell.addEventListener('click', () => handleCellClick(row, col));
            boardElement.appendChild(cell);
            boardCells.push(cell);
        }
    }
}

function renderBoard() {
    if (boardCells.length === 0) {
        createBoardCells();
        return;
    }
    
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const idx = row * COLS + col;
            const cell = boardCells[idx];
            
            cell.classList.remove('selected', 'movable', 'has-enemy');
            
            if (gameState.selectedPiece && 
                gameState.selectedPiece.row === row && 
                gameState.selectedPiece.col === col) {
                cell.classList.add('selected');
            }
            
            const validMove = gameState.validMoves.find(m => m.row === row && m.col === col);
            if (validMove) {
                cell.classList.add('movable');
                if (validMove.capture) {
                    cell.classList.add('has-enemy');
                }
            }
            
            const piece = gameState.board[row][col];
            const existingPiece = cell.querySelector('.piece');
            
            if (piece) {
                if (existingPiece) {
                    const isSameType = existingPiece.dataset.type === piece.type &&
                                      existingPiece.dataset.owner === piece.owner;
                    if (!isSameType) {
                        existingPiece.remove();
                    } else {
                        existingPiece.classList.toggle('selected-piece', 
                            gameState.selectedPiece && 
                            gameState.selectedPiece.row === row && 
                            gameState.selectedPiece.col === col);
                        continue;
                    }
                }
                
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece ${piece.owner}`;
                pieceElement.dataset.type = piece.type;
                pieceElement.dataset.owner = piece.owner;
                
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
            } else if (existingPiece) {
                existingPiece.remove();
            }
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

    // 联机模式下，不是自己的回合不能操作
    if (gameState.mode === 'online' && gameState.currentPlayer !== gameState.onlineSide) {
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
            if (gameState.mode === 'online') {
                gameState.fxPlaying = true;
                window.Online.sendMove(gameState.selectedPiece.row, gameState.selectedPiece.col, row, col);
                clearSelection();
                renderBoard();
            } else {
                await movePiece(gameState.selectedPiece.row, gameState.selectedPiece.col, row, col);
            }
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
    const logText = capturedPiece
        ? `${playerName}${pieceName} 吃 ${PIECE_TYPES[capturedPiece.type].name}`
        : `${playerName}${pieceName} 移动到 (${toRow + 1},${toCol + 1})`;
    logMove(logText, movingPiece.owner);

    // 4. 推入走棋历史（board 快照在覆盖前抓取，供悔棋使用）
    gameState.history.push({
        player: movingPiece.owner,
        from: { row: fromRow, col: fromCol },
        to: { row: toRow, col: toCol },
        captured: capturedPiece ? { ...capturedPiece } : null,
        logText,
        boardSnapshot: gameState.board.map(row => row.map(cell => cell ? { ...cell } : null))
    });

    // 5. 真正更新棋盘
    gameState.board[toRow][toCol] = movingPiece;
    gameState.board[fromRow][fromCol] = null;

    clearSelection();
    updateUndoButton();

    // 6. 兽穴获胜判定
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

    // 7. 换手
    const opponent = movingPiece.owner === 'red' ? 'blue' : 'red';
    gameState.currentPlayer = opponent;
    renderBoard();
    updateTurnIndicator();

    // 8. 困毙判定：轮到 opponent 后，若其无任何合法移动，则 movingPiece.owner 胜
    // （斗兽棋规则：轮到某方时若该方无路可走即判负）
    if (!hasAnyValidMove(opponent)) {
        updateHint(`${opponent === 'red' ? '红方' : '蓝方'}棋子全部被困，无法行动！`);
        gameState.fxPlaying = false;
        showWinner(movingPiece.owner, '对方棋子全部被困，无法行动！');
        return;
    }

    updateHint(`等待${opponent === 'red' ? '红方' : '蓝方'}行动...`);
    gameState.fxPlaying = false;

    // PVE 模式下轮到 AI 走棋时自动触发
    triggerAiIfNeeded();
}

/**
 * 若游戏未结束 + 当前玩家是 AI + 特效空闲 → 延迟 700ms 模拟思考后调 movePiece
 */
function triggerAiIfNeeded() {
    if (gameState.mode !== 'pve') return;
    if (gameState.gameOver) return;
    if (gameState.currentPlayer !== gameState.aiSide) return;
    if (gameState.fxPlaying) return;
    if (!window.DouShouQiAI) return;

    gameState.fxPlaying = true;
    updateHint(`AI 思考中…`);
    setTimeout(() => {
        const move = window.DouShouQiAI.pickMove(gameState);
        if (!move) {
            // AI 无路可走 → 困毙，movePiece 内部已处理；这里只是兜底
            gameState.fxPlaying = false;
            return;
        }
        movePiece(move.from.row, move.from.col, move.to.row, move.to.col);
    }, 700);
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

// 重新开始游戏（保留当前 mode/aiSide）
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
        fxPlaying: false,
        history: [],
        mode: gameState.mode,
        aiSide: gameState.aiSide
    };

    initBoard();
    renderBoard();
    updateTurnIndicator();
    updateHint(gameState.mode === 'pve'
        ? `人机模式开始！请${gameState.aiSide === 'red' ? '蓝方' : '红方'}先手`
        : '游戏开始！请红方选择棋子移动');
    moveLog.length = 0;
    renderLog();
    updateUndoButton();
    updateAiButton();

    // PVE 模式下，若 AI 是先手红方，立即触发
    triggerAiIfNeeded();
}

/**
 * 悔棋：弹出最近一步走棋历史，恢复 board 快照、切换回走棋方、撤销日志。
 * PVE 模式下会先跳过所有 AI 步，再 pop 一条玩家步，使悔棋后一定回到玩家回合。
 */
function undoMove() {
    if (gameState.fxPlaying) {
        updateHint('特效播放中，请稍候…');
        return;
    }
    if (gameState.history.length === 0) {
        updateHint('没有可悔棋的步数');
        return;
    }

    // 1) 跳过顶部所有 AI 步（仅移除栈，不恢复）
    let skippedAi = 0;
    while (gameState.history.length > 0 &&
           gameState.mode === 'pve' &&
           gameState.history[gameState.history.length - 1].player === gameState.aiSide) {
        gameState.history.pop();
        moveLog.shift();
        skippedAi++;
    }

    // 2) pop 玩家步并恢复其 boardSnapshot
    if (gameState.history.length === 0) {
        document.getElementById('winModal').classList.remove('show');
        moveLog.length = 0;
        renderLog();
        clearSelection();
        updateUndoButton();
        updateHint('已悔棋至初始局面');
        return;
    }
    const last = gameState.history.pop();
    moveLog.shift();

    gameState.board = last.boardSnapshot.map(row => row.map(cell => cell ? { ...cell } : null));
    gameState.currentPlayer = last.player;
    gameState.gameOver = false;
    gameState.fxPlaying = false;

    document.getElementById('winModal').classList.remove('show');
    renderLog();
    clearSelection();
    countPieces();
    renderBoard();
    updateTurnIndicator();
    updateUndoButton();

    const total = skippedAi + 1;
    const tip = `已悔棋 ${total} 步，${last.player === 'red' ? '红方' : '蓝方'}重新行动`;
    if (gameState.currentPlayer !== gameState.aiSide) {
        updateHint(tip);
    } else {
        // 极少见：玩家无棋可走时连退 → 落到 AI 回合
        triggerAiIfNeeded();
    }
}

/** 根据 history 是否为空，启用/禁用悔棋按钮 */
function updateUndoButton() {
    const btn = document.getElementById('btnUndo');
    if (!btn) return;
    btn.disabled = gameState.history.length === 0;
}

/** 同步顶部 AI 切换按钮的文案与样式 */
function updateAiButton() {
    const btn = document.getElementById('btnAiToggle');
    if (!btn) return;
    if (gameState.mode === 'pve') {
        const ai = gameState.aiSide === 'red' ? '红' : '蓝';
        btn.textContent = `🤖 人机对战（AI 执${ai}）`;
        btn.classList.add('active');
    } else {
        btn.textContent = '👥 双人对战';
        btn.classList.remove('active');
    }
}

/** 切换对战模式：PVP ↔ PVE（人机模式弹窗选色） */
function toggleAiMode() {
    if (gameState.mode === 'pve') {
        // 切回 PVP：直接重新开始
        gameState.mode = 'pvp';
        gameState.aiSide = null;
        restartGame();
        return;
    }
    // 切到 PVE：弹窗选色
    document.getElementById('pickSideModal').classList.add('show');
}

/** 玩家在选色弹窗里点了某色 */
function pickSide(humanSide) {
    document.getElementById('pickSideModal').classList.remove('show');
    gameState.mode = 'pve';
    gameState.aiSide = humanSide === 'red' ? 'blue' : 'red';
    restartGame();
}

// 暴露给 FxBridge / AI 使用的全局工具
window.isRiver = isRiver;
window.isEnemyDen = isEnemyDen;
window.isTrap = isTrap;
window.PIECE_TYPES = PIECE_TYPES;
window.RED_DEN = RED_DEN;
window.BLUE_DEN = BLUE_DEN;
window.ROWS = ROWS;
window.COLS = COLS;
window.getValidMoves = getValidMoves;

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
    document.getElementById('btnUndo').addEventListener('click', undoMove);
    document.getElementById('btnAiToggle').addEventListener('click', toggleAiMode);
    document.querySelectorAll('#pickSideModal .btn-pick-side').forEach(btn => {
        btn.addEventListener('click', () => pickSide(btn.dataset.side));
    });

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

    // 联机事件绑定
    const onlineToggle = document.getElementById('btnOnlineToggle');
    const createRoomBtn = document.getElementById('btnCreateRoom');
    const joinRoomBtn = document.getElementById('btnJoinRoom');
    const cancelOnlineBtn = document.getElementById('btnCancelOnline');
    const chatCloseBtn = document.getElementById('chatClose');
    const chatFabBtn = document.getElementById('chatFab');
    const chatSendBtn = document.getElementById('chatSend');
    const chatInputEl = document.getElementById('chatInput');
    if (onlineToggle) onlineToggle.addEventListener('click', toggleOnlineMode);
    if (createRoomBtn) createRoomBtn.addEventListener('click', createRoom);
    if (joinRoomBtn) joinRoomBtn.addEventListener('click', joinRoom);
    if (cancelOnlineBtn) cancelOnlineBtn.addEventListener('click', () => {
        document.getElementById('onlineModal').classList.remove('show');
        document.getElementById('roomInfo').style.display = 'none';
    });
    if (chatCloseBtn) chatCloseBtn.addEventListener('click', closeChatPanel);
    if (chatFabBtn) chatFabBtn.addEventListener('click', toggleChatPanel);
    if (chatSendBtn) chatSendBtn.addEventListener('click', sendChatMessage);
    if (chatInputEl) chatInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // 弹窗关闭按钮（右上角叉号）
    document.querySelectorAll('.modal-close[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const modalId = btn.getAttribute('data-close-modal');
            const modal = document.getElementById(modalId);
            if (modal) modal.classList.remove('show');
            // 关闭联机弹窗时重置房间信息显示
            if (modalId === 'onlineModal') {
                const roomInfo = document.getElementById('roomInfo');
                if (roomInfo) roomInfo.style.display = 'none';
            }
        });
    });

    initBoard();
    renderBoard();
    updateTurnIndicator();
    updateHint('游戏开始！请红方选择棋子移动');

    // 恢复聊天未读数
    restoreChatBadge();
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

/* ============================================================
   联机对战模式
   ============================================================ */

function toggleOnlineMode() {
    if (gameState.mode === 'online') {
        exitOnlineMode();
        return;
    }
    document.getElementById('onlineModal').classList.add('show');
}

function exitOnlineMode() {
    if (window.Online) {
        window.Online.leaveRoom();
    }
    gameState.mode = 'pvp';
    gameState.onlineSide = null;
    updateOnlineButton();
    closeChatPanel();
    hideChatFab();
    clearChatBadge();
    restartGame();
}

function updateOnlineButton() {
    const btn = document.getElementById('btnOnlineToggle');
    if (!btn) return;
    if (gameState.mode === 'online') {
        btn.textContent = '🌐 退出联机';
        btn.classList.add('active');
    } else {
        btn.textContent = '🌐 联机对战';
        btn.classList.remove('active');
    }
}

// ========== 加载状态辅助函数 ==========
function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.dataset.originalText = btn.textContent;
        btn.disabled = true;
        btn.classList.add('btn-loading');
        btn.textContent = '加载中...';
    } else {
        btn.disabled = false;
        btn.classList.remove('btn-loading');
        if (btn.dataset.originalText) {
            btn.textContent = btn.dataset.originalText;
            delete btn.dataset.originalText;
        }
    }
}

function showOnlineLoading(text) {
    let loadingEl = document.getElementById('onlineLoading');
    if (!loadingEl) {
        loadingEl = document.createElement('div');
        loadingEl.id = 'onlineLoading';
        loadingEl.className = 'online-loading';
        loadingEl.innerHTML = '<div class="loading-spinner"></div><div class="loading-text"></div>';
        document.body.appendChild(loadingEl);
    }
    loadingEl.querySelector('.loading-text').textContent = text || '加载中...';
    loadingEl.style.display = 'flex';
}

function hideOnlineLoading() {
    const loadingEl = document.getElementById('onlineLoading');
    if (loadingEl) loadingEl.style.display = 'none';
}

// ========== 聊天提示音 ==========
let _audioCtx = null;
let _chatSoundEnabled = true;

function playChatSound() {
    if (!_chatSoundEnabled) return;
    try {
        // 使用 Web Audio API 合成一个柔和的"叮"声，不依赖外部音频文件
        if (!_audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            _audioCtx = new AC();
        }
        const ctx = _audioCtx;
        if (ctx.state === 'suspended') {
            // 用户未交互前 AudioContext 处于 suspended，尝试恢复
            ctx.resume().catch(() => {});
        }
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
    } catch (e) {
        // 静默失败
    }
}

function createRoom() {
    const btn = document.getElementById('btnCreateRoom');
    setButtonLoading(btn, true);

    document.getElementById('onlineModal').classList.remove('show');
    showOnlineLoading('正在创建房间...');

    window.Online.connect();
    window.Online.setCallbacks({
        onRoomCreated: (data) => {
            setButtonLoading(btn, false);
            hideOnlineLoading();
            document.getElementById('roomInfo').style.display = 'block';
            document.getElementById('displayRoomId').textContent = data.id;
            updateHint(`已创建房间 ${data.id}，等待对手加入...`);
        },
        onPlayerJoined: (data) => {
            document.getElementById('roomInfo').style.display = 'none';
            startOnlineGame(data);
        },
        onGameStart: (data) => {
            startOnlineGame(data);
        },
        onMoveResult: (data) => {
            handleOnlineMoveResult(data);
        },
        onChat: (data) => {
            addChatMessage(data);
        },
        onPlayerLeft: (data) => {
            updateHint('对手已离开房间');
            showWinner(null, '对手已离开，游戏结束');
        },
        onDisconnect: () => {
            updateHint('与服务器断开连接，正在尝试重连...');
        },
        onReconnect: () => {
            updateHint('已重新连接到服务器');
        },
        onRateLimited: (data) => {
            setButtonLoading(btn, false);
            hideOnlineLoading();
            updateHint(data.message || '操作过于频繁');
        }
    });

    setTimeout(() => {
        window.Online.createRoom();
    }, 500);

    // 超时保护
    setTimeout(() => {
        setButtonLoading(btn, false);
        hideOnlineLoading();
    }, 5000);
}

function joinRoom() {
    const roomId = document.getElementById('roomIdInput').value.trim();
    if (!roomId || roomId.length !== 4) {
        alert('请输入4位房间号');
        return;
    }
    if (!/^\d{4}$/.test(roomId)) {
        alert('房间号必须是4位数字');
        return;
    }

    const btn = document.getElementById('btnJoinRoom');
    setButtonLoading(btn, true);

    document.getElementById('onlineModal').classList.remove('show');
    showOnlineLoading(`正在加入房间 ${roomId}...`);

    window.Online.connect();
    window.Online.setCallbacks({
        onRoomJoined: (data) => {
            setButtonLoading(btn, false);
            hideOnlineLoading();
            document.getElementById('roomInfo').style.display = 'none';
            if (data.playerCount === 2) {
                startOnlineGame(data);
            } else {
                updateHint(`已加入房间 ${data.id}，等待对手...`);
            }
        },
        onPlayerJoined: (data) => {
            startOnlineGame(data);
        },
        onGameStart: (data) => {
            startOnlineGame(data);
        },
        onMoveResult: (data) => {
            handleOnlineMoveResult(data);
        },
        onChat: (data) => {
            addChatMessage(data);
        },
        onPlayerLeft: (data) => {
            updateHint('对手已离开房间');
            showWinner(null, '对手已离开，游戏结束');
        },
        onDisconnect: () => {
            updateHint('与服务器断开连接，正在尝试重连...');
        },
        onReconnect: () => {
            updateHint('已重新连接到服务器');
        },
        onRateLimited: (data) => {
            setButtonLoading(btn, false);
            hideOnlineLoading();
            updateHint(data.message || '操作过于频繁');
        }
    });

    setTimeout(() => {
        window.Online.joinRoom(roomId);
    }, 500);

    // 超时保护
    setTimeout(() => {
        setButtonLoading(btn, false);
        hideOnlineLoading();
    }, 5000);
}

function startOnlineGame(data) {
    gameState.mode = 'online';
    gameState.board = data.board;
    gameState.currentPlayer = data.turn;
    gameState.gameOver = false;
    gameState.history = [];

    const player = data.players.find(p => p.id === window.Online.getSocket()?.id);
    gameState.onlineSide = player ? player.side : 'red';

    updateOnlineButton();
    updateHint(`联机模式开始！你执${gameState.onlineSide === 'red' ? '红方' : '蓝方'}，${gameState.currentPlayer === gameState.onlineSide ? '轮到你行动' : '等待对手行动'}`);

    countPieces();
    renderBoard();
    updateTurnIndicator();
    updateUndoButton();

    // 加载聊天历史（重连时）
    loadChatHistory(data.chatHistory || []);

    // 显示聊天图标按钮，聊天面板默认收起（由用户点击图标展开）
    showChatFab();
    closeChatPanel();
}

function loadChatHistory(history) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '';
    history.forEach(msg => addChatMessage(msg));
}

// ---------- 聊天面板控制 ----------
function toggleChatPanel() {
    const panel = document.getElementById('chatPanel');
    if (!panel) return;
    panel.classList.toggle('show');
    // 打开时清空未读徽标
    if (panel.classList.contains('show')) {
        clearChatBadge();
    }
}

function closeChatPanel() {
    const panel = document.getElementById('chatPanel');
    if (panel) panel.classList.remove('show');
}

function showChatFab() {
    const fab = document.getElementById('chatFab');
    if (fab) fab.style.display = 'flex';
}

function hideChatFab() {
    const fab = document.getElementById('chatFab');
    if (fab) fab.style.display = 'none';
}

function incrementChatBadge() {
    const badge = document.getElementById('chatBadge');
    if (!badge) return;
    // 从 localStorage 读取当前未读数（防止刷新后丢失）
    let current = 0;
    try {
        current = parseInt(localStorage.getItem('chatUnread') || '0', 10);
    } catch (e) { current = 0; }
    current += 1;
    try {
        localStorage.setItem('chatUnread', String(current));
    } catch (e) {}
    badge.textContent = current > 99 ? '99+' : String(current);
    badge.style.display = 'block';
    // 抖动动画
    const fab = document.getElementById('chatFab');
    if (fab) {
        fab.classList.remove('shake');
        void fab.offsetWidth; // 强制重排
        fab.classList.add('shake');
    }
}

function clearChatBadge() {
    const badge = document.getElementById('chatBadge');
    if (!badge) return;
    try {
        localStorage.setItem('chatUnread', '0');
    } catch (e) {}
    badge.textContent = '0';
    badge.style.display = 'none';
}

// 页面加载时，从 localStorage 恢复未读数
function restoreChatBadge() {
    try {
        const stored = localStorage.getItem('chatUnread');
        if (!stored) return;
        const count = parseInt(stored, 10);
        if (count > 0) {
            const badge = document.getElementById('chatBadge');
            if (badge) {
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.style.display = 'block';
            }
        }
    } catch (e) {}
}

function handleOnlineMoveResult(data) {
    if (!data.success) {
        updateHint(data.error || '走棋失败');
        gameState.fxPlaying = false;
        return;
    }

    gameState.board = data.board;
    gameState.currentPlayer = data.turn;
    gameState.gameOver = !!data.winner;

    if (data.captured) {
        const capturedName = PIECE_TYPES[data.captured.type].name;
        const capturerName = data.turn === 'red' ? '蓝方' : '红方';
        logMove(`${capturerName}吃${capturedName}`, data.turn === 'red' ? 'blue' : 'red');
    }

    countPieces();
    renderBoard();
    updateTurnIndicator();
    gameState.fxPlaying = false;

    if (data.winner) {
        showWinner(data.winner, data.winReason);
        return;
    }

    const hint = gameState.currentPlayer === gameState.onlineSide
        ? '轮到你行动'
        : '等待对手行动...';
    updateHint(hint);
}

function addChatMessage(data) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // 判断消息来源：自己 / 对方 / 系统
    const mySide = gameState.onlineSide;
    const senderSide = data.playerSide;
    const isMine = mySide && senderSide === mySide;
    const isSystem = !senderSide;

    // 如果聊天面板未打开且是对方消息，累加未读数
    const panel = document.getElementById('chatPanel');
    const panelOpen = panel && panel.classList.contains('show');
    if (!isSystem && !isMine && !panelOpen) {
        incrementChatBadge();
        // 播放提示音（对方消息 + 面板未打开）
        playChatSound();
    }

    const row = document.createElement('div');
    row.className = 'chat-msg-row' + (isSystem ? ' system' : (isMine ? ' mine' : ' other'));

    // 系统消息
    if (isSystem) {
        row.innerHTML = `<div class="chat-msg-system">${escapeHtml(data.message || '')}</div>`;
        container.appendChild(row);
        container.scrollTop = container.scrollHeight;
        return;
    }

    // 头像颜色：红方-红，蓝方-蓝
    const avatarClass = senderSide === 'red' ? 'avatar-red' : 'avatar-blue';
    const senderName = senderSide === 'red' ? '红方' : '蓝方';

    // 转义消息内容防 XSS
    const safeMsg = escapeHtml(data.message || '');
    const safeName = escapeHtml(data.playerName || senderName);
    const time = formatChatTime(data.timestamp || Date.now());

    row.innerHTML = `
        <div class="chat-avatar ${avatarClass}">${senderSide === 'red' ? '🦁' : '🐯'}</div>
        <div class="chat-bubble-wrap">
            <div class="chat-name">${safeName}</div>
            <div class="chat-bubble">${safeMsg}</div>
        </div>
        <div class="chat-time">${time}</div>
    `;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
}

function formatChatTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    if (window.Online) {
        window.Online.sendChat(message);
    }
    input.value = '';
}
