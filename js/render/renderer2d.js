/* ============================================================
   Renderer2D: 现有 DOM 渲染的搬运实现
   ------------------------------------------------------------
   【来源】
   本文件的 createCells() / renderBoard() / getCellEl() 是从 js/game.js
   逐行搬运过来的（对应 game.js 中 createBoardCells() / renderBoard() / getCellEl()）。
   搬运时**只改了「数据来源」和「cell 的存放位置」，没有改任何渲染逻辑**：
     - gameState.xxx        → render(state) 的入参 state.xxx
     - 模块级 boardCells    → 工厂闭包内的私有 cells
     - handleCellClick      → 渲染器契约的 onCellClick 注册的回调
   DOM 结构、class 名称、class 添加顺序、img 路径、提前 continue 的跳过逻辑
   全部保持原样，以保证 2D 模式视觉零回归。

   【与原实现唯一的结构差异】
   原实现的 63 个格子直接挂在 #board 上；本实现同样挂在 #board 上
   （因为 css/style.css 里 .board-frame 的 grid 布局是 2D 棋盘的地基，
   换挂载点会直接改变视觉）。区别只在于：本实现把 click 监听收集起来，
   以便 unmount() 时能干净解绑；原实现是模块级一次性绑定、永不解绑。
   视觉与交互行为完全等价。

   【为什么 mount 的 container 不是 #board】
   挂载流程会 innerHTML = '' 清空 #board 再重建格子，
   如果渲染产物也挂在 #board 上就会被自己清掉。
   所以容器由外部传入（见 renderer.js 契约），本实现只在 mount 里
   记录 container 用于生命周期管理，棋盘本体仍然从 #board 挂载，
   这样 CSS 无需任何改动。
   ============================================================ */
(function () {
  const {
    PIECE_TYPES, ROWS, COLS,
    RED_DEN, BLUE_DEN, RED_TRAPS, BLUE_TRAPS,
    isRiver
  } = window.GameCore;

  /**
   * 工厂：创建一个 2D 渲染器实例
   * @returns {Object} 实现了契约 6 方法的渲染器实例
   */
  function createRenderer() {
    // 63 个格子的 DOM 引用，按 row * COLS + col 索引。
    // 属于本实例的私有状态：不缓存 gameState，只缓存「自己的 DOM 元素」，
    // 这是安全的——DOM 元素的存活由本渲染器自己负责，与 gameState 无关。
    let cells = [];

    // 外部传入的挂载容器（见上方说明：棋盘本体不挂这里）
    let container = null;

    // 玩家点击格子的回调，由 onCellClick(cb) 注册
    let cellClickCb = null;

    /**
     * 取 2D 棋盘根元素
     * @returns {HTMLElement|null}
     */
    function getBoardEl() {
      return document.getElementById('board');
    }

    /**
     * 根据 row/col 找到棋盘 DOM 格子
     * @param {number} row
     * @param {number} col
     * @returns {HTMLElement|null}
     */
    function getCellEl(row, col) {
      const board = getBoardEl();
      if (!board) return null;
      return board.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    }

    /**
     * 创建 63 个格子 DOM（搬运自 game.js 的 createBoardCells）
     * 会先清空 #board，再按行优先顺序追加格子。
     */
    function createCells() {
      const boardElement = getBoardEl();
      if (!boardElement) {
        console.error('Renderer2D: 找不到 #board 元素');
        return;
      }
      // 清空棋盘：注意这正是「container 不能是 #board」的原因
      boardElement.innerHTML = '';
      cells = [];

      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const cell = document.createElement('div');
          cell.className = 'cell';
          cell.dataset.row = row;
          cell.dataset.col = col;

          // 地形 class：兽穴 / 陷阱 / 河流，按 if-else 顺序互斥判定
          // （顺序与原实现一致，视觉依赖此顺序）
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

          // 点击 → 转发给契约注册的回调（2D 有真实 DOM，所以自己绑事件即可，
          // onCellClick 在这里不是 no-op，而是这条链路的注册端）
          cell.addEventListener('click', () => {
            if (typeof cellClickCb === 'function') cellClickCb(row, col);
          });
          boardElement.appendChild(cell);
          cells.push(cell);
        }
      }
    }

    /**
     * 全量重绘棋盘（搬运自 game.js 的 renderBoard）
     * @param {Object} state 完整 gameState（只读，不缓存）
     */
    function render(state) {
      if (!state) return;

      // 懒创建：首次 render 或 unmount 之后首次 render 时重建格子
      if (cells.length === 0) {
        createCells();
      }
      if (cells.length === 0) return;

      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const idx = row * COLS + col;
          const cell = cells[idx];
          if (!cell) continue;

          // 先清掉上一帧的高亮 class
          cell.classList.remove('selected', 'movable', 'has-enemy');

          // 选中态
          if (state.selectedPiece &&
              state.selectedPiece.row === row &&
              state.selectedPiece.col === col) {
            cell.classList.add('selected');
          }

          // 可移动 / 可吃子态
          const validMove = state.validMoves.find(m => m.row === row && m.col === col);
          if (validMove) {
            cell.classList.add('movable');
            if (validMove.capture) {
              cell.classList.add('has-enemy');
            }
          }

          const piece = state.board[row][col];
          const existingPiece = cell.querySelector('.piece');

          if (piece) {
            if (existingPiece) {
              // 增量优化：type 与 owner 都没变 → 不重建节点，
              // 只同步 selected-piece，避免每次重绘都重新加载图片、重置动画。
              // 【关键】这个 continue 提前跳过逻辑必须保留。
              const isSameType = existingPiece.dataset.type === piece.type &&
                                existingPiece.dataset.owner === piece.owner;
              if (!isSameType) {
                existingPiece.remove();
              } else {
                existingPiece.classList.toggle('selected-piece',
                  state.selectedPiece &&
                  state.selectedPiece.row === row &&
                  state.selectedPiece.col === col);
                continue;
              }
            }

            // 重建棋子节点：<div class="piece owner" data-type data-owner>
            //                 <img src alt> + <div class="level-badge">
            const pieceElement = document.createElement('div');
            pieceElement.className = `piece ${piece.owner}`;
            pieceElement.dataset.type = piece.type;
            pieceElement.dataset.owner = piece.owner;

            if (state.selectedPiece &&
                state.selectedPiece.row === row &&
                state.selectedPiece.col === col) {
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
            // 该格已无棋子，移除残留节点
            existingPiece.remove();
          }
        }
      }
    }

    /**
     * 取格子在视口 CSS 像素坐标系中的矩形（等价于 getBoundingClientRect）
     * @param {number} row
     * @param {number} col
     * @returns {{x:number,y:number,width:number,height:number}|null}
     */
    function getCellScreenPos(row, col) {
      const cell = getCellEl(row, col);
      if (!cell) return null;
      // 实时测量，不缓存：resize / DPR 变化 / GSAP 动画都会改变矩形
      const r = cell.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }

    /**
     * 纯数据派生：由棋子数据得到贴图地址与元信息（不依赖 DOM）
     * @param {Object} piece { type, owner }
     * @returns {{url:string, level:number, name:string}|null}
     */
    function getPieceAsset(piece) {
      if (!piece || !piece.type || !piece.owner) return null;
      const info = PIECE_TYPES[piece.type];
      if (!info) return null;
      return {
        url: `assets/images/${piece.owner}/${info.image}`,
        level: info.level,
        name: info.name
      };
    }

    return {
      /**
       * 挂载：记录容器，重建 63 个格子
       * @param {HTMLElement} mountContainer 外部传入的容器（不是 #board）
       */
      mount(mountContainer) {
        container = mountContainer || null;
        // 挂载即重建，保证 mount 之后 getCellScreenPos 立刻可用
        cells = [];
        createCells();
      },

      /**
       * 卸载：清空格子引用与回调，棋盘 DOM 留空（下次 mount 会重建）
       * 不必逐个 removeEventListener——格子节点整体被丢弃，
       * 监听器随之被垃圾回收，绑定目标已不存在，天然解绑。
       */
      unmount() {
        cells = [];
        cellClickCb = null;
        container = null;
        const boardElement = getBoardEl();
        if (boardElement) boardElement.innerHTML = '';
      },

      render,

      /**
       * 注册格子点击回调
       * @param {function(number, number): void} cb
       */
      onCellClick(cb) {
        cellClickCb = typeof cb === 'function' ? cb : null;
      },

      getCellScreenPos,
      getPieceAsset
    };
  }

  const Renderer2D = { create: createRenderer };

  // 暴露到全局
  window.Renderer2D = Renderer2D;

  // 自动注册到渲染器注册表（需先加载 renderer.js）
  if (window.Renderer) {
    window.Renderer.register(window.Renderer.MODE_2D, createRenderer);
  } else {
    console.error('Renderer2D: 依赖 window.Renderer，请先加载 js/render/renderer.js');
  }
})();
