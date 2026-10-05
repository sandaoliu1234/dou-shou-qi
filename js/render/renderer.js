/* ============================================================
   Renderer: 可插拔渲染器抽象层（契约 + 注册表）
   ------------------------------------------------------------
   【为什么要有这一层】
   斗兽棋原本是「DOM 棋盘 + SVG 棋子 + GSAP + Canvas 2D 粒子」的纯 2D 实现，
   游戏逻辑（game-core.js）与渲染逻辑（game.js 的 createBoardCells/renderBoard）
   耦合在一起。为了将来能挂载 3D 渲染模式，这里把「怎么把局面画出来」抽象成
   6 个方法的契约，游戏层只面向契约编程，将来换渲染器不用改逻辑层。

   【零依赖 / 零构建】
   本文件不引入任何 npm 包，直接以 <script> 加载，
   沿用项目既有风格（window.GameCore / window.FxBridge / window.ANIMAL_THEMES）暴露全局。

   ============================================================
   渲染器契约（RENDERER CONTRACT v1）
   ============================================================
   注册方式：window.Renderer.register(id, factory)
     - id      : 字符串，建议用 MODE_2D / MODE_3D
     - factory : 无参函数，返回一个「渲染器实例」对象。
                用 factory 而不是直接存实例，是为了每次切换模式都能拿到干净实例，
                避免上一次 mount 遗留的私有状态污染这一次。
     - 重复注册同一 id 会覆盖旧实现（便于开发期热替换）。

   工厂返回值（渲染器实例）必须实现下面 6 个方法，缺一不可：

   1) mount(container: HTMLElement): void
      语义：把渲染产物挂到 container 上，并开始监听必要的事件。
      调用时机：切换到该渲染模式时调用一次。
      约束【非常重要】：
        - container 由外部传入，**绝不能是 #board**。
          因为 2D 实现挂载时需要把 #board 的 innerHTML 清空再重建 63 个格子，
          如果 container 就是 #board，清空会把自己刚挂上去的东西一起清掉。
        - 实现应当「只往 container 里面塞自己创建的 wrapper」，
          不要假设 container 的 class / 尺寸 / 定位。
        - 允许重复调用 mount：实现要么幂等，要么先 unmount 再 mount。
        - mount 之后必须保证 getCellScreenPos() 可用（至少对所有格子返回矩形）。

   2) unmount(): void
      语义：卸载并清理——解绑所有事件监听、移除自己创建的全部 DOM、复位私有状态。
            卸载后该实例不应再响应任何事件；重复调用应当安全（幂等）。
      调用时机：切走该渲染模式时调用一次。
      注意：unmount 之后调用 getCellScreenPos() 应当返回 null（而不是抛异常或脏矩形）。

   3) render(state): void
      语义：**全量 sync**。读 state 重建/更新视觉，state 就是完整的 gameState：
            {
              board: Piece[][],          // board[row][col] 为棋子或 null
                                           // 棋子形如 { type:'TIGER', owner:'red' }
                                           //   type 取值见 GameCore.PIECE_TYPES 的键
                                           //   owner 为 'red' | 'blue'
              currentPlayer: 'red'|'blue',
              selectedPiece: {row, col} | null,
              validMoves: [{row, col, capture: boolean}],
              gameOver: boolean,
              redPieces: number, bluePieces: number,
              fxPlaying: boolean, history: [], mode, aiSide, onlineSide
            }
            实现只需消费 board / selectedPiece / validMoves 三项。
      调用时机：任何影响棋盘视觉的状态变化之后，由游戏层调用（选中、移动、悔棋、重开、悔改…）。
      约束【非常重要】：
        - **绝对不要缓存 state 的对象引用**。
          因为 game.js 的 restartGame() 会用一个全新的对象整体替换 gameState
          （不是逐字段赋值），缓存旧引用会让重启后的渲染读到已被丢弃的旧状态。
        - 允许在单次 render() 调用内部多次读 state（那是同一次同步读取，安全），
          但不要把它存到闭包 / 实例字段里跨调用使用。
        - render 必须幂等：同一个 state 连续 render 两次，视觉结果应完全一致。

   4) onCellClick(cb: function(row: number, col: number)): void
      语义：注册「玩家点击了某个格子」的回调。传入 cb 即生效；
            传入 null / undefined 视为取消注册。
      调用时机：mount 之后、render 之前，由游戏层注册一次。
      说明：2D 模式下格子是真实 DOM，可以自己绑 click 后直接回调，
            所以 2D 的实现可以是 no-op；
            3D 模式下棋子在 canvas/WebGL 里、没有可点击的 DOM，
            必须靠这个回调把「射线拾取」的结果上报给游戏层。
            —— 这正是抽象层存在的意义：游戏层不关心点击是怎么检测出来的。

   5) getCellScreenPos(row, col): {x, y, width, height} | null
      语义：返回该格子在**视口 CSS 像素坐标系**中的矩形，
            语义与 Element.getBoundingClientRect() **完全一致**：
              - x = 矩形左边到视口左边的距离（等价于 rect.left）
              - y = 矩形上边到视口上边的距离（等价于 rect.top）
              - width / height = 矩形的 CSS 像素宽高（等价于 rect.width / rect.height）
              - 原点在视口左上角，向右为 x 增大、向下为 y 增大
              - 已包含 CSS transform（缩放/旋转/透视）带来的视觉偏移
            取值不存在的格子（越界、未挂载、已卸载）时返回 null。
      调用时机：特效（FX）层播放吃子/移动特效时，由 FX 层取目标格中心点。
      约束【非常重要】：
        - **必须是实时测量，不能缓存**。因为窗口 resize、DPR 变化、
          容器尺寸变化、GSAP 正在播放的 transform 动画，都会让矩形实时改变。
          缓存下来的矩形会让特效飞到旧位置。
          正确做法：每次调用都重新 getBoundingClientRect()。
        - **单位是 CSS 像素，不是设备像素**。
          getBoundingClientRect() 返回的就是 CSS 像素，天然与 DPR 解耦：
          DPR=2 的屏幕上它不会翻倍。FX 层若要落到 canvas 上，
          应自行乘以 devicePixelRatio（或用 canvas 的 CSS 尺寸缩放），
          渲染器不要代替 FX 层做这个换算。
        - 返回值必须是**普通对象**（可安全 JSON 化 / 展开），
          不要直接返回 DOMRect（DOMRect 是只读且带额外方法，
          在部分场景下序列化会丢信息，跨层传递不如普通对象干净）。
        - 允许有非零的旋转/透视：返回的是包围盒（axis-aligned bounding box），
          这与 getBoundingClientRect 的行为一致，FX 层按中心点使用即可。

   6) getPieceAsset(piece): {url, level, name} | null
      语义：纯数据派生——由棋子数据推导出它的贴图地址与元信息，
            返回 { url: 'assets/images/blue/tiger.svg', level: 6, name: '虎' }。
            piece 为 null / 结构不合法 / type 未知时返回 null。
      调用时机：2D 渲染器建棋子节点时用；3D 渲染器建贴图时用；FX 层画粒子时也可能用。
      说明：这是**唯一一个 2D / 3D / FX 三方共用的纯函数**，
            所以它必须完全不依赖 DOM —— 这样 FX 层在 3D 模式下
            也能正确拿到「被吃掉的棋子长什么样」，而不必去查 DOM。

   ------------------------------------------------------------
   【坐标链路（本抽象层的核心价值）】
   FX 层（吃子/移动特效）的落点只有一个来源：getCellScreenPos()。
     - 2D 模式：实现在真实的 .cell DOM 上测量 getBoundingClientRect()。
     - 3D 模式：棋子在 WebGL 里没有 DOM，实现改为把 (row, col, worldPos)
                 投影到屏幕（worldToScreen）后自行组装同形状的矩形。
   两种实现产出的数据形状与坐标系完全一致，
   所以 **FX 层与本契约在 3D 模式下不需要改动一行代码**。
   切换渲染模式不应该让任何特效错位——这就是这套契约要保证的东西。
   ============================================================ */
(function () {
  // 渲染器注册表：id -> factory
  const registry = Object.create(null);

  /**
   * 注册一个渲染器实现
   * @param {string} id 渲染器 id（建议用 MODE_2D / MODE_3D）
   * @param {function(): Object} factory 无参工厂，返回实现了 6 方法契约的实例
   */
  function register(id, factory) {
    if (typeof id !== 'string' || !id) {
      console.error('Renderer.register: id 必须是非空字符串');
      return;
    }
    if (typeof factory !== 'function') {
      console.error(`Renderer.register: "${id}" 的 factory 必须是函数`);
      return;
    }
    registry[id] = factory;
  }

  /**
   * 取渲染器工厂
   * @param {string} id 渲染器 id
   * @returns {function|null} 未注册时返回 null（不抛异常，便于调用方做降级）
   */
  function get(id) {
    return registry[id] || null;
  }

  /**
   * 实例化一个渲染器
   * @param {string} id 渲染器 id
   * @returns {Object|null} 渲染器实例；未注册时返回 null
   */
  function create(id) {
    const factory = get(id);
    if (!factory) return null;
    return factory();
  }

  // 暴露到全局（沿用项目 window.GameCore / window.FxBridge 的风格）
  window.Renderer = {
    register,
    get,
    create,
    MODE_2D: '2d',
    MODE_3D: '3d'
  };
})();
