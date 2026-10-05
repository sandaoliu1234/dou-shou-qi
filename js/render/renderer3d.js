/* ============================================================
   Renderer3D：Three.js / WebGL 渲染器
   ------------------------------------------------------------
   本文件实现 js/render/renderer.js 定义的 6 方法契约，用 WebGL 表现棋盘。
   与 Renderer2D 的关系：两者读同一份 gameState，产出同一形状的坐标数据，
   所以游戏层与特效层（2538 行）完全不需要感知当前是哪个后端。

   ============================================================
   关键设计决策
   ============================================================

   【1. 棋子用贴图平面，不用3D 模型】
   项目美术是手绘卡片风：css/style.css 的 .piece 是 border-radius:14% 的
   圆角方卡 + box-shadow + linear-gradient 纸底，16 张 SVG 是带边框/牌面/
   动物插画/汉字的完整卡片。引低模动物会与手绘插画风严重冲突。
   → 棋子 = 贴图平面 + 一层很薄的几何体给深色侧壁，做出「有厚度」的感觉，
     但本质仍是那张手绘卡。这与 2D 模式的视觉语言是连续的。

   【2. 坐标系与格心布局】
   棋盘 7 行 × 9 列，格边长 1 世界单位。格心：
       x = col - (COLS-1)/2 = col - 4
       z = row - (ROWS-1)/2 = row - 3
   所以棋盘总宽 9、总深 7，中心在原点。
   y 轴向上，格子的厚度沿 y 方向。

   【3. getCellScreenPos 用四角投影取包围盒】
   相机是俯视略带倾角，所以格子在屏幕上不是正方形。
   契约要求返回的矩形语义等同 getBoundingClientRect()，而后者对
   旋转过的元素返回的是**轴对齐包围盒**。所以必须投影四个角再取 min/max，
   不能直接用格边长换算——那样会丢掉透视缩短，FX 特效就会偏移。

   【4. 动态 import three.js】
   three.module.js 648KB + three.core.js 1.4MB ≈ 2MB。
   2D 用户不该为用不到的 3D 下载它，所以只在挂载 3D 时才动态 import。

   【5. 共享资源的所有权】
   纹理由 AssetTexture 统一管理（跨2D/3D 共享），所以 unmount 时
   **不销毁纹理**，只销毁自己创建的 geometry / material。
   纹理销毁只在应用退出时由 AssetTexture.dispose() 负责。
   ============================================================ */
(function () {
  const Core = window.GameCore || {};

  /* ---------- 世界布局常量 ---------- */
  const CELL = 1.0;                        // 格子边长（世界单位）
  const CELL_H = 0.08;                     // 格子厚度
  const HALF_COLS = (Core.COLS - 1) / 2;   // = 4
  const HALF_ROWS = (Core.ROWS - 1) / 2;   // = 3
  /**
   * 棋子竖直方向的两个基准高度（面片与侧壁共用）。
   * 放成模块级常量而不是在 setPiece 里算，因为 updatePieceHighlight 每帧都要用，
   * 两者若各算一遍很容易不一致——实测就因为侧壁基准偏高 0.04
   * 导致贴图面片被完全遮住，棋子渲染成深色方块。
   * 关系：SIDE_TOP_Y = FACE_Y - SIDE_GAP，必须严格小于 FACE_Y。
   */
  const SIDE_H = 0.10;                // 侧壁长方体高度
  const FACE_Y = CELL_H / 2 + SIDE_H / 2 + 0.004;   // 贴图面片高度
  const SIDE_GAP = 0.004;             // 面片与侧壁顶面的间隙
  const SIDE_CENTER_Y = FACE_Y - SIDE_GAP - SIDE_H / 2;
  /**
   * 相机俯视倾角。
   * 18° 实测太躺了，格子看起来像侧视的长条，读不出棋盘结构。
   * 42° 是"能看清立体感 + 格子仍近似正方"的折中：
   * 深度方向被 cos(42°)≈0.74 压缩，7 行仍能分辨。
   */
  const CAM_ANGLE = 42 * Math.PI / 180;
  const CAM_FOV = 34;                      // 透视相机视场角（度）

  /* ---------- 相机摆动（拖动转视角）常量 ---------- */
  /**
   * 可摆动的最大方位角（±15°）。
   * 为什么不给更大的范围：斗兽棋是"看格选子"的游戏，斜视过度会让
   * 远处格子被近处格子遮挡、格子被压成细长条，可读性反而下降。
   * ±15° 足够看出立体纵深，又不影响任何一格的可辨认性。
   */
  const CAM_SWING_MAX = 15 * Math.PI / 180;
  /**
   * 拖动灵敏度：每水平像素对应的方位角（弧度）。
   * 0.004 意味着走完 ±15°（约 0.524 rad）需要约 131px 水平拖动，
   * 手感不拖沓也不过敏（鼠标、触屏都合适）。
   */
  const CAM_SWING_SENSITIVITY = 0.004;
  /**
   * 「这是拖动而非点击」的位移判定阈值（CSS 像素）。
   * 低于阈值 → 当作点击，走射线拾取选子；高于 → 当作摆动视角，不触发选子。
   * 取 6px：能容忍手抖与触屏的自然偏移，又不至于把轻拖误判成点击。
   */
  const DRAG_THRESHOLD = 6;
  /* ---------- 材质配色（取自 css/style.css 实测值） ---------- */
  const COLORS = {
    cell:0xfff8ec,       // 普通格 rgba(255,250,238,.55) 的不透明近似
    cellEdge: 0xdcc9a8,   // --color-border
    river: 0x4a8ab5,      // --color-river
    trapRed: 0xb23b2e,    // --color-red
    trapBlue: 0x2f5d8a,   // --color-blue
    denRed: 0xb23b2e,
    denBlue: 0x2f5d8a,
    boardBase: 0x8a6a44,  // --color-wood
    boardDeep: 0x5c4426,  // --color-wood-dark
    moveRing: 0xc9a227,   // --color-gold
    captureRing: 0xb23b2e
  };

  /**
   * 加载 three.js
   * @returns {Promise<Object>} THREE 命名空间；失败时调用方需降级
   */
  async function ensureThree() {
    if (window.THREE) return window.THREE;
    const mod = await import('/node_modules/three/build/three.module.js');
    window.THREE = mod;
    return mod;
  }

  /**
   * 取得某格的世界坐标中心
   * @param {number} row 行 0..ROWS-1
   * @param {number} col 列 0..COLS-1
   * @returns {{x:number, y:number, z:number}} y 恒为 0（棋盘平面高度）
   */
  function cellWorld(row, col) {
    return {
      x: col - HALF_COLS,
      y: 0,
      z: row - HALF_ROWS
    };
  }

  /**
   * 最近一次创建的渲染器实例。
   * 单独用模块级变量存，而不是挂在 Renderer3D 上——
   * 因为 createRenderer3D 内部就要写它，而 Renderer3D 的 const 声明在函数之后，
   * 直接引用会踩 TDZ（暂时性死区）。
   * 仅供排查使用（instance.__debug 可读scene / pieceSlots 内部状态）。
   */
  let lastInstance = null;

  /**
   * 创建 3D 渲染器实例
   * @returns {Object} 实现契约 6 方法的实例
   */
  function createRenderer3D() {
    // 记录最近创建的实例，供控制台/自动化排查（通过 __debug 访问场景内部）。
    // 必须在工厂内部记录：注册表持有的是本函数本身，从外部包装 create 是没用的。
    const instance = (function () {
    /* ---- 生命周期相关私有状态 ---- */
    let containerEl = null;      // 传入的容器
    let canvasEl = null;         // WebGL canvas
    let wrapperEl = null;        // 我们自己的 wrapper div
    let renderer = null;         // THREE.WebGLRenderer
    let scene = null;
    let camera = null;
    let rafId = 0;
    let ready = false;           // three 加载与场景搭建是否完成
    let failed = false;          // 是否已确认加载失败（降级）
    let disposed = false;        // unmount 是否已执行

    /* ---- 场景对象 ---- */
    let boardGroup = null;       // 棋盘根Group
    let cellMeshes = [];         // 63 个格子，索引 = row*COLS+col
    let cellMaterials = [];      // 每格独立材质（高亮态要单独改）
    let riverMaterials = [];     // 水面格材质（共享水纹纹理，逐帧滚动 offset）
    let denMaterials = { red: null, blue: null };  // 兽穴材质（脉冲发光）
    let denSprites = {};         // 兽穴"穴"字浮标
    let selRing = null;          // 选中光环（共享单个 mesh）
    let movableCells = new Set();// 当前可走格（呼吸脉冲）
    let prevKeys = [];           // 上一帧棋子键位快照（供 render 差分出移动/吃子动画）
    let pieceGroup = null;       // 棋子根 Group
    let pieceSlots = [];         // 63 个槽位：{ root, cardFace, cardSide, key, pending }
    let pickPlane = null;        // 用于 Raycaster 求交的不可见平面
    let fxGroup = null;          // 攻击特效的临时物体容器（统一清理）
    let recentFx = { moves: new Set(), captures: new Set(), time: 0 };  // 已原生演出的事件（防 render 差分重复触发）
    let fxBusyUntil = 0;         // 剧场演出中：抑制选中棋子浮动循环，避免打架
    let resizeObserver = null;

    /* ---- 交互 ---- */
    let cellClickCb = null;
    let boundPointerHandler = null;

    /* ---- 相机摆动 ---- */
    /** 当前方位角偏移（弧度）。0 = 正前方，正值向一侧转，钳制在 ±CAM_SWING_MAX */
    let camAzimuth = 0;
    /**
     * 相机到棋盘中心的距离。由 updateCameraFrustum 依容器尺寸算出，
     * 存成状态是因为「拖动摆角」时要复用它重算相机位置，
     * 不能每次都重跑整段视锥计算。
     */
    let camDist = 0;
    /**
     * 拖动会话状态；null 表示当前没有按下。
     * { pointerId, startX, startY, startAz, moved }
     * 用 pointerId 匹配是因为触屏上可能有多指，只认第一个按下的手指。
     */
    let dragState = null;
    /** 拖动事件监听引用，unmount 时要逐个解绑 */
    let boundMoveHandler = null;
    let boundUpHandler = null;
    /**
     * ready 之前收到的 render 请求暂存在这里。
     * mount() 同步返回但场景异步搭建，调用方随后的 render() 会被 !ready 挡住；
     * 就绪后必须补上这一次，否则棋子永远不会被创建（实测踩过这个坑）。
     */
    let pendingState = null;

    /* ---- 复用的临时对象，避免每帧 new ---- */
    const tmpVec = { x: 0, y: 0, z: 0 };
    const ndcVec = { x: 0, y: 0, z: 0 };

    /**
     * 用 worldToScreen 的数学把世界坐标投到视口 CSS 像素
     *
     * 与 three 的 Vector3.project(camera) 完全等价：视图矩阵 × 投影矩阵，
     * 再做透视除法（正交相机 w 恒为 1，透视相机 w = -vz，两种都兼容）。
     * 不用 Vector3.project() 是为了不在每帧投影路径上分配对象。
     *
     * @param {number} wx 世界 x
     * @param {number} wy 世界 y
     * @param {number} wz 世界 z
     * @param {DOMRect} rect 容器视口矩形
     * @param {Object} out 输出对象，写入 {x, y}
     */
    function worldToScreen(wx, wy, wz, rect, out) {
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

      // 1) 视图变换：world → camera space
      const e = camera.matrixWorldInverse.elements;
      const vx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const vy = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const vz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];

      // 2) 投影变换：camera space → clip space（完整 4 分量）
      const p = camera.projectionMatrix.elements;
      const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
      const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
      const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
      // 透视除法：正交相机 cw=1，透视相机 cw = -vz（>0，因为相机看向 -z）
      const ndcX = cx / cw;
      const ndcY = cy / cw;
      ndcVec.x = ndcX;
      ndcVec.y = ndcY;

      // 3) NDC（-1..1）→ 视口 CSS 像素（y 轴翻转）
      out.x = rect.left + (ndcX * 0.5 + 0.5) * rect.width;
      out.y = rect.top + (-ndcY * 0.5 + 0.5) * rect.height;
    }

    /**
     * 按当前「距离 + 俯仰角 + 方位角」摆放相机
     *
     * 抽成独立函数的原因：距离只在容器尺寸变化时重算，
     * 而方位角在拖动时每帧都变。拖动只需要重摆姿势，不必重跑整段视锥计算。
     *
     * 相机在球面上：俯仰角固定 CAM_ANGLE，方位角 = camAzimuth（可拖动）
     *      水平半径 r = dist · cos(俯仰)
     *      x = sin(方位) · r ,  y = dist · sin(俯仰) ,  z = cos(方位) · r
     */
    function applyCameraPose() {
      if (!camera || !camDist) return;
      const r = camDist * Math.cos(CAM_ANGLE);
      camera.position.set(
        Math.sin(camAzimuth) * r,
        camDist * Math.sin(CAM_ANGLE),
        Math.cos(camAzimuth) * r
      );
      // 始终看向棋盘中心，摆动时棋盘保持居中不漂移
      camera.lookAt(0, 0, 0);
      // 立即刷新世界矩阵：getCellScreenPos 与射线拾取都依赖它，
      // 若等到渲染时才更新，拖动后的第一帧坐标会用到旧矩阵。
      camera.updateMatrixWorld();
    }

    /**
     * 更新透视相机的位置与视锥
     *
     * 思路：按棋盘在相机空间里需要的半宽/半高，反算「能装下棋盘」的
     * 最小相机距离，两个方向取较大值再留余量。距离随容器宽高比变化：
     * 容器越扁，相机越远。
     *
     * @param {number} w 容器 CSS 宽
     * @param {number} h 容器 CSS 高
     */
    function updateCameraFrustum(w, h) {
      if (!camera) return;
      const aspect = w / h;

      // 棋盘在相机空间里的投影范围（倾角下深度被 cos 压缩）
      //
      // 半宽按**摆动到最大角度时**的最坏情况算：
      // 棋盘 9 宽 × 7 深绕 Y 轴转 ±15° 后，投影包围盒宽度
      //   = COLS·cos(15°) + ROWS·sin(15°) ≈ 10.51，比正前方的 9 宽了 17%。
      // 若只按正前方算，摆到最大角时棋盘两侧会被裁掉。
      //
      // 这样做的代价实测为零：当前容器宽高比 ~1.97 时受限项是**高度**
      // （halfHD/tanHalf 主导），宽度本就有富余，按最坏情况放大半宽
      // 算出的距离与按正前方算完全相同。而窄屏（手机）下它正好防住裁切。
      const azMax = Math.abs(CAM_SWING_MAX);
      const halfW = (Core.COLS * Math.cos(azMax) + Core.ROWS * Math.sin(azMax)) / 2 + 0.6;
      const halfHD = (Core.ROWS * CELL) * Math.cos(CAM_ANGLE) / 2 + 0.7;

      const tanHalf = Math.tan(CAM_FOV * Math.PI / 360);
      camDist = Math.max(
        halfW / (tanHalf * aspect),
        halfHD / tanHalf
      ) * 1.12;

      camera.aspect = aspect;
      applyCameraPose();
      camera.updateProjectionMatrix();
    }

    /**
     * 搭建场景（three 加载完成后调用一次）
     * @param {Object} THREE three 命名空间
     */
    function buildScene(THREE) {
      // ---- renderer ----
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const rect0 = containerEl.getBoundingClientRect();
      renderer.setSize(rect0.width || 800, rect0.height || 600, false);
      // 实时阴影：棋子投在棋盘上的软影是"立体感"的最大来源
      // （three 0.186 移除了 PCFSoftShadowMap，用 PCFShadowMap + 大分辨率贴图近似软影）
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      canvasEl = renderer.domElement;
      canvasEl.style.width = '100%';
      canvasEl.style.height = '100%';
      canvasEl.style.display = 'block';
      // 承接点击：占位实现是 pointer-events:none，真 3D 需要接收指针事件
      canvasEl.style.pointerEvents = 'auto';
      wrapperEl.appendChild(canvasEl);

      // 让贴图管线拿到 renderer 以设置各向异性
      if (window.AssetTexture && window.AssetTexture.setRenderer) {
        window.AssetTexture.setRenderer(renderer);
      }

      // ---- scene ----
      scene = new THREE.Scene();
      scene.background = null;   // 透明，让 CSS 氛围背景透出来

      // ---- 透视相机：俯视带倾角（透视缩短让纵深可读） ----
      camera = new THREE.PerspectiveCamera(CAM_FOV, 1.5, 0.1, 200);
      camera.position.set(0, 16, 18);
      camera.lookAt(0, 0, 0);
      updateCameraFrustum(rect0.width || 800, rect0.height || 600);

      // ---- 光照 ----
      // 半球光：天光暖白 + 地面反光暖棕，比纯 Ambient 层次更自然
      scene.add(new THREE.HemisphereLight(0xfff6e0, 0x6b5232, 0.85));
      // 主方向光产生立体感：从左上前方打下来，投射实时阴影
      const dir = new THREE.DirectionalLight(0xfff1d8, 1.05);
      dir.position.set(-6, 11, 6);
      dir.castShadow = true;
      dir.shadow.mapSize.set(2048, 2048);
      dir.shadow.camera.left = -8; dir.shadow.camera.right = 8;
      dir.shadow.camera.top = 8; dir.shadow.camera.bottom = -8;
      dir.shadow.camera.near = 2; dir.shadow.camera.far = 40;
      dir.shadow.bias = -0.0005;
      scene.add(dir);
      // 补光，避免右侧过暗
      const fill = new THREE.DirectionalLight(0xffe8c8, 0.3);
      fill.position.set(6, 4, -5);
      scene.add(fill);

      buildBoard(THREE);
      buildPickPlane(THREE);
      bindEvents();

      // 攻击特效的临时物体统一挂这里，便于整体清理
      fxGroup = new THREE.Group();
      scene.add(fxGroup);

      ready = true;
    }

    /* ============================================================
       程序化纹理（canvas 生成，零外部资源）
       ============================================================ */

    function makeCanvasTexture(size, draw) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      draw(cv.getContext('2d'), size);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer && renderer.capabilities
        ? renderer.capabilities.getMaxAnisotropy() : 4;
      tex.needsUpdate = true;
      return tex;
    }

    /** 暖米色纸纹格子（普通格） */
    function cellTexture() {
      return makeCanvasTexture(128, (c, s) => {
        c.fillStyle = '#f7efdc';
        c.fillRect(0, 0, s, s);
        // 纸纹：随机淡色短横线
        c.strokeStyle = 'rgba(180,155,110,0.18)';
        c.lineWidth = 1;
        for (let i = 0; i < 22; i++) {
          const y = Math.random() * s;
          const x = Math.random() * s * 0.6;
          const len = 6 + Math.random() * 22;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y + (Math.random() - 0.5) * 3); c.stroke();
        }
        // 边缘微暗，做出内嵌感
        const grad = c.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.72);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(120,90,50,0.14)');
        c.fillStyle = grad;
        c.fillRect(0, 0, s, s);
      });
    }

    /** 深木纹（底座/边框） */
    function woodTexture() {
      return makeCanvasTexture(256, (c, s) => {
        c.fillStyle = '#7a5a35';
        c.fillRect(0, 0, s, s);
        for (let i = 0; i < 46; i++) {
          const y = Math.random() * s;
          const alpha = 0.06 + Math.random() * 0.1;
          c.strokeStyle = Math.random() > 0.5
            ? `rgba(58,40,20,${alpha})` : `rgba(190,150,100,${alpha})`;
          c.lineWidth = 1 + Math.random() * 2.4;
          c.beginPath();
          c.moveTo(0, y);
          c.bezierCurveTo(s * 0.3, y + (Math.random() - 0.5) * 14,
            s * 0.7, y + (Math.random() - 0.5) * 14, s, y + (Math.random() - 0.5) * 10);
          c.stroke();
        }
      });
    }

    /** 水面波纹（共享一张纹理，offset 每帧滚动） */
    function waterTexture() {
      const tex = makeCanvasTexture(256, (c, s) => {
        const grad = c.createLinearGradient(0, 0, 0, s);
        grad.addColorStop(0, '#4a8ab5');
        grad.addColorStop(0.5, '#5b9bd5');
        grad.addColorStop(1, '#3d7ab8');
        c.fillStyle = grad;
        c.fillRect(0, 0, s, s);
        // 波光椭圆
        for (let i = 0; i < 26; i++) {
          const x = Math.random() * s, y = Math.random() * s;
          const w = 10 + Math.random() * 26, h = 2 + Math.random() * 3.5;
          c.fillStyle = `rgba(255,255,255,${0.10 + Math.random() * 0.22})`;
          c.beginPath(); c.ellipse(x, y, w, h, 0, 0, Math.PI * 2); c.fill();
        }
      });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    }

    /** 陷阱斜纹（红/蓝两版） */
    function trapTexture(teamColor, darkColor) {
      return makeCanvasTexture(128, (c, s) => {
        c.fillStyle = teamColor;
        c.fillRect(0, 0, s, s);
        c.strokeStyle = darkColor;
        c.lineWidth = 9;
        for (let i = -s; i < s * 2; i += 24) {
          c.beginPath(); c.moveTo(i, 0); c.lineTo(i + s, s); c.stroke();
        }
        // 内凹阴影
        const grad = c.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s * 0.72);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.3)');
        c.fillStyle = grad;
        c.fillRect(0, 0, s, s);
      });
    }

    /** 兽穴径向渐变（红/蓝两版） */
    function denTexture(lightColor, deepColor) {
      return makeCanvasTexture(128, (c, s) => {
        const grad = c.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
        grad.addColorStop(0, lightColor);
        grad.addColorStop(1, deepColor);
        c.fillStyle = grad;
        c.fillRect(0, 0, s, s);
      });
    }

    /** 搭建 7×9 棋盘 */
    function buildBoard(THREE) {
      boardGroup = new THREE.Group();
      scene.add(boardGroup);

      // ---- 棋盘底座：厚木台 + 外框，木纹贴图 ----
      const wood = woodTexture();
      wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
      const baseGeo = new THREE.BoxGeometry(
        Core.COLS * CELL + 0.62,
        0.26,
        Core.ROWS * CELL + 0.62
      );
      const baseMat = new THREE.MeshStandardMaterial({
        map: wood, color: 0xb98d58, roughness: 0.8, metalness: 0.04
      });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = -CELL_H / 2 - 0.13;
      base.receiveShadow = true;
      boardGroup.add(base);

      // 内衬深色框线（格子与外框之间的过渡），做出"镶嵌"感
      const inlayGeo = new THREE.BoxGeometry(
        Core.COLS * CELL + 0.14, 0.03, Core.ROWS * CELL + 0.14
      );
      const inlayMat = new THREE.MeshStandardMaterial({
        color: 0x4a3520, roughness: 0.85
      });
      const inlay = new THREE.Mesh(inlayGeo, inlayMat);
      inlay.position.y = -CELL_H / 2 - 0.008;
      inlay.receiveShadow = true;
      boardGroup.add(inlay);

      // ---- 63 个格子：普通=纸纹，河=滚动水面，陷阱=斜纹凹格，兽穴=径向+脉冲 ----
      const geo = new THREE.BoxGeometry(CELL * 0.94, CELL_H, CELL * 0.94);
      cellMeshes = [];
      cellMaterials = [];
      riverMaterials = [];
      denMaterials = { red: null, blue: null };
      denSprites = {};

      const texCell = cellTexture();
      const texWater = waterTexture();
      const texTrapR = trapTexture('#c9917d', '#8a4a38');
      const texTrapB = trapTexture('#aab7cd', '#4d6788');
      const texDenR = denTexture('#e8a08e', '#8f2f24');
      const texDenB = denTexture('#9ec3e8', '#1f4468');

      for (let row = 0; row < Core.ROWS; row++) {
        for (let col = 0; col < Core.COLS; col++) {
          let material;
          let meshY = 0;

          if (row === Core.RED_DEN.row && col === Core.RED_DEN.col) {
            material = new THREE.MeshStandardMaterial({
              map: texDenR, roughness: 0.5, metalness: 0.05,
              emissive: 0xb23b2e, emissiveIntensity: 0.22
            });
            denMaterials.red = material;
          } else if (row === Core.BLUE_DEN.row && col === Core.BLUE_DEN.col) {
            material = new THREE.MeshStandardMaterial({
              map: texDenB, roughness: 0.5, metalness: 0.05,
              emissive: 0x2f5d8a, emissiveIntensity: 0.22
            });
            denMaterials.blue = material;
          } else if (Core.RED_TRAPS.some(t => t.row === row && t.col === col)) {
            material = new THREE.MeshStandardMaterial({ map: texTrapR, roughness: 0.65 });
            meshY = -0.012;   // 微微下沉，做出陷阱"凹槽"
          } else if (Core.BLUE_TRAPS.some(t => t.row === row && t.col === col)) {
            material = new THREE.MeshStandardMaterial({ map: texTrapB, roughness: 0.65 });
            meshY = -0.012;
          } else if (Core.isRiver(row, col)) {
            material = new THREE.MeshStandardMaterial({
              map: texWater, roughness: 0.25, metalness: 0.12
            });
            riverMaterials.push(material);
            meshY = -0.018;   // 水面下沉
          } else {
            material = new THREE.MeshStandardMaterial({ map: texCell, roughness: 0.72, metalness: 0.02 });
          }

          const mesh = new THREE.Mesh(geo, material);
          const w = cellWorld(row, col);
          mesh.position.set(w.x, meshY, w.z);
          mesh.receiveShadow = true;
          mesh.userData.row = row;
          mesh.userData.col = col;
          boardGroup.add(mesh);
          cellMeshes.push(mesh);
          cellMaterials.push(material);
        }
      }

      // ---- 兽穴"穴"字浮标（billboard sprite，随脉冲轻微浮动） ----
      const denInfo = [
        { key: 'red', den: Core.RED_DEN, color: '#ffd0c4' },
        { key: 'blue', den: Core.BLUE_DEN, color: '#cfe4fa' }
      ];
      for (const d of denInfo) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 128;
        const c = cv.getContext('2d');
        c.font = '700 96px "STKaiti", "KaiTi", "Noto Serif SC", serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        // 白字 + 深色描边：在红/蓝两种底色上都有足够对比度
        c.strokeStyle = 'rgba(40, 24, 10, 0.85)';
        c.lineWidth = 10;
        c.strokeText('穴', 64, 70);
        c.fillStyle = '#fff8ea';
        c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 8;
        c.fillText('穴', 64, 70);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, transparent: true, opacity: 0.92, depthWrite: false
        }));
        spr.scale.set(0.5, 0.5, 1);
        const w = cellWorld(d.den.row, d.den.col);
        spr.position.set(w.x, 0.52, w.z);
        boardGroup.add(spr);
        denSprites[d.key] = spr;
      }

      // ---- 选中光环（共享一个，跟随选中棋子） ----
      const ringGeo = new THREE.RingGeometry(0.36, 0.46, 36);
      const ringMat = new THREE.MeshBasicMaterial({
        color: COLORS.moveRing, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false
      });
      selRing = new THREE.Mesh(ringGeo, ringMat);
      selRing.rotation.x = -Math.PI / 2;
      selRing.position.y = CELL_H / 2 + 0.012;
      selRing.visible = false;
      scene.add(selRing);

      // ---- 棋子容器 ----
      pieceGroup = new THREE.Group();
      scene.add(pieceGroup);
      pieceSlots = [];
      for (let i = 0; i < Core.COLS * Core.ROWS; i++) {
        pieceSlots.push({ root: null, cardFace: null, cardSide: null, key: null, pending: null });
      }
    }

    /**
     * Raycaster 拾取用的不可见平面
     *
     * 用一个覆盖整个棋盘的平面而不是 63 个格子几何体：
     * 平面的求交是纯数学计算，稳定且不受「格子是否被棋子遮挡」
     * 「材质是否 transparent」「是否有高亮环叠加」影响。
     *
     * @param {Object} THREE
     */
    function buildPickPlane(THREE) {
      const geo = new THREE.PlaneGeometry(Core.COLS * CELL, Core.ROWS * CELL);
      const mat = new THREE.MeshBasicMaterial({ visible: false });
      pickPlane = new THREE.Mesh(geo, mat);
      // PlaneGeometry 默认在 XY 平面，绕 X 转 -90° 让它平铺到 XZ 平面
      pickPlane.rotation.x = -Math.PI / 2;
      pickPlane.position.y = 0.01;   // 略高于格子顶面，避免与几何体求交歧义
      scene.add(pickPlane);
    }

    /**
     * 绑定事件（仅在 unmount 时解绑一次）
     *
     * 指针事件分三件：down 只记录起点，move 决定是拖动还是点击，up 结算。
     * 不能像以前那样在 down 里直接拾取——加了摆动之后，"按下"既可能是
     * 选子、也可能是开始拖视角，必须等抬起时按位移量区分。
     */
    function bindEvents() {
      if (!canvasEl) return;
      boundPointerHandler = (e) => handlePointerDown(e);
      boundMoveHandler = (e) => handlePointerMove(e);
      boundUpHandler = (e) => handlePointerUp(e);
      canvasEl.addEventListener('pointerdown', boundPointerHandler);
      canvasEl.addEventListener('pointermove', boundMoveHandler);
      // up / cancel 都绑在 window 上：指针可能在画布外抬起
      // （拖到棋盘外松手），只绑 canvas 会漏掉这次抬起，
      // dragState 卡住不释放，之后所有点击都被当成拖动。
      window.addEventListener('pointerup', boundUpHandler);
      window.addEventListener('pointercancel', boundUpHandler);

      // 拖动时禁止浏览器把水平滑动解释成"后退/前进"手势（触屏）
      canvasEl.style.touchAction = 'none';

      // ResizeObserver 比 window.resize 更准：能捕捉到容器尺寸变化
      // （比如侧栏展开导致 board-area 变窄），而不只是窗口变化
      if (window.ResizeObserver && containerEl) {
        resizeObserver = new ResizeObserver(() => handleResize());
        resizeObserver.observe(containerEl);
      }
    }

    /**
     * 容器尺寸变化时的处理
     * 必须在 resize 时同步 canvas 尺寸与相机视锥，否则画面会被拉伸或裁掉
     */
    function handleResize() {
      if (!renderer || !containerEl || disposed) return;
      const rect = containerEl.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      renderer.setSize(w, h, false);
      updateCameraFrustum(w, h);
    }

    /**
     * 指针按下：只记录起点，不下结论
     *
     * 这次按下究竟是"选子"还是"拖视角"，要等 pointermove 的位移量才知道，
     * 所以这里仅建立拖动会话。
     *
     * @param {PointerEvent} e
     */
    function handlePointerDown(e) {
      if (!ready || disposed) return;
      // 只认主键/触摸，忽略右键与中键（避免右键菜单/滚轮按下误触发）
      if (e.button !== undefined && e.button !== 0) return;
      // 已有会话时忽略后续指针（多指触屏只认第一根手指）
      if (dragState) return;

      dragState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startAz: camAzimuth,
        moved: false
      };

      // 拖动会与剧场的镜头震动抢 camera.position 的写权。
      // 按下即杀掉震动的补间，让摆动独占相机位置。
      if (window.gsap && camera) window.gsap.killTweensOf(camera.position);
    }

    /**
     * 指针移动：超过阈值就进入"摆视角"模式
     *
     * 只有"已被判定为拖动"之后才真的转动相机。
     * 一旦转过，本次交互就锁定为拖动，抬起时不再触发选子。
     *
     * @param {PointerEvent} e
     */
    function handlePointerMove(e) {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      if (disposed || !camera) return;

      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;

      // 首次越过阈值 → 正式进入拖动模式（并把当前位移一次性吃掉）
      if (!dragState.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragState.moved = true;
      }

      // 方位角 = 起始角 + 水平位移 × 灵敏度，钳制在 ±CAM_SWING_MAX
      // 注意用"起始角 + 总位移"而不是"累加每帧位移"：
      // 后者在钳制时会丢信息，反向拖回来手感断裂（像被卡住）。
      const next = dragState.startAz + dx * CAM_SWING_SENSITIVITY;
      camAzimuth = Math.max(-CAM_SWING_MAX, Math.min(CAM_SWING_MAX, next));
      applyCameraPose();
    }

    /**
     * 指针抬起：结算——是拖动就结束摆动，不是就按点击走射线拾取
     *
     * @param {PointerEvent} e
     */
    function handlePointerUp(e) {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      const wasDrag = dragState.moved;
      dragState = null;
      // 拖动结束：不选子。语义上"我在转视角"，不该顺带选中一个棋子。
      if (wasDrag) return;
      // 未拖动 → 当作点击，执行射线拾取
      pickAt(e);
    }

    /**
     * 射线拾取：把屏幕坐标换算成格子行列并上报
     *
     * 命中测试对象是覆盖整盘的不可见平面，而不是逐格几何体——
     * 平面的求交是纯数学计算，不受"格子是否被棋子遮挡"
     * "材质是否 transparent""高亮环是否叠加"影响，稳定且更快。
     *
     * @param {PointerEvent} e
     */
    function pickAt(e) {
      if (!ready || !camera || !pickPlane || !cellClickCb) return;
      const THREE = window.THREE;
      if (!THREE) return;

      const rect = canvasEl.getBoundingClientRect();
      // 像素坐标 → NDC
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: ndcX, y: ndcY }, camera);
      const hits = ray.intersectObject(pickPlane, false);
      if (!hits.length) return;

      // 交点世界坐标 → 反算格子行列
      const p = hits[0].point;
      const col = Math.round(p.x + HALF_COLS);
      const row = Math.round(p.z + HALF_ROWS);
      // 越界说明点在棋盘外
      if (row < 0 || row >= Core.ROWS || col < 0 || col >= Core.COLS) return;
      cellClickCb(row, col);
    }

    /**
     * 渲染循环
     *
     * 常驻 rAF：除静态渲染外，还驱动「水波滚动 / 兽穴脉冲 / 可走格呼吸 /
     * 选中棋子浮动」这类连续动画。场景静态时 WebGL 负担极小。
     */
    let lastLoopT = performance.now();
    function loop() {
      if (disposed) return;
      rafId = requestAnimationFrame(loop);
      if (!ready || !renderer) return;

      const now = performance.now();
      const dt = Math.min((now - lastLoopT) / 1000, 0.05);
      lastLoopT = now;
      const t = now / 1000;

      // 水面波纹滚动（纹理共享，改一次 offset 全部河格生效）
      if (riverMaterials.length && riverMaterials[0].map) {
        riverMaterials[0].map.offset.x = (t * 0.045) % 1;
        riverMaterials[0].map.offset.y = (t * 0.028) % 1;
      }
      // 兽穴发光脉冲 + 浮标呼吸
      const pulse = 0.24 + Math.sin(t * 2.6) * 0.14;
      if (denMaterials.red) denMaterials.red.emissiveIntensity = pulse;
      if (denMaterials.blue) denMaterials.blue.emissiveIntensity = pulse;
      for (const k of Object.keys(denSprites)) {
        const spr = denSprites[k];
        if (spr) spr.position.y = 0.52 + Math.sin(t * 2.6 + (k === 'red' ? 0 : Math.PI)) * 0.04;
      }
      // 可走格呼吸
      for (const idx of movableCells) {
        const m = cellMaterials[idx];
        if (m && m.emissive) {
          const base = m.__baseIntensity || 0.28;
          m.emissiveIntensity = base * (0.75 + Math.sin(t * 4.2) * 0.3);
        }
      }
      // 选中光环：缩放呼吸
      if (selRing && selRing.visible) {
        const s = 1 + Math.sin(t * 3.4) * 0.06;
        selRing.scale.setScalar(s);
      }
      // 选中棋子：上下浮动（剧场演出期间不干扰——剧场接管攻方位置）
      if (selSlotIdx >= 0 && performance.now() > fxBusyUntil && pieceSlots[selSlotIdx] && pieceSlots[selSlotIdx].root) {
        const root = pieceSlots[selSlotIdx].root;
        const baseY = pieceSlots[selSlotIdx].baseY || 0;
        if (!isTweening(root.position)) {
          root.position.y = baseY + 0.06 + Math.sin(t * 3.1) * 0.03;
        }
      }

      renderer.render(scene, camera);
    }

    /** 该 position 上是否有活跃的 gsap 补间（有则不让浮动动画打架） */
    function isTweening(posObj) {
      return window.gsap && window.gsap.isTweening(posObj);
    }

    /* ============================================================
       棋子管理
       ============================================================ */

    /**
     * 为某格创建/更新棋子
     *
     * 纹理是异步的：先放一个浅色占位平面，纹理到了再替换材质 map。
     * 不因为纹理加载慢而卡住整个 render。
     *
     * @param {Object} THREE
     * @param {number} idx 槽位索引 = row*COLS+col
     * @param {Object} piece { type, owner }
     */
    function setPiece(THREE, idx, piece) {
      const slot = pieceSlots[idx];
      if (!slot) return;
      const row = Math.floor(idx / Core.COLS);
      const col = idx % Core.COLS;
      const w = cellWorld(row, col);
      const key = piece ? `${piece.owner}/${piece.type}` : null;

      // 无棋子：清空该槽位
      if (!piece) {
        if (slot.root || slot.cardFace) clearSlotMesh(slot);
        slot.root = null; slot.cardFace = null; slot.cardSide = null;
        slot.key = null; slot.pending = null; slot.baseY = 0;
        return;
      }

      // 同一颗棋子：只更新高亮态，不重建
      if (slot.key === key && (slot.root || slot.cardFace)) {
        updatePieceHighlight(idx, piece);
        return;
      }

      // 换棋子：清掉旧的（并停掉在飞的补间，防止补间复活已释放对象）
      if (slot.root || slot.cardFace) clearSlotMesh(slot);
      slot.key = key;
      slot.pending = key;
      slot.baseY = CELL_H / 2;

      const typeKey = piece.type.toLowerCase();
      const use3d = window.Animals3D && window.Animals3D.supports(typeKey);

      if (use3d) {
        const root = window.Animals3D.build(THREE, piece.owner, typeKey);
        if (root) {
          // 模型面朝 +z：红方（z 小的一侧）朝 +z 正对蓝方；蓝方转 PI
          root.rotation.y = piece.owner === 'blue' ? Math.PI : 0;
          root.position.set(w.x, slot.baseY, w.z);
          root.traverse(o => { if (o.isMesh) o.castShadow = true; });
          root.userData.slot = idx;
          pieceGroup.add(root);
          slot.root = root;
          updatePieceHighlight(idx, piece);
          return;
        }
        // Animals3D.build 失败 → 落到下方卡片路径
      }

      // ---- 降级路径：贴图卡片平面（原实现保留，视觉与 2D 连续） ----
      const sizeTable = window.PIECE_SVG_SIZE;
      const sizeInfo = sizeTable && sizeTable[piece.owner] && sizeTable[piece.owner][typeKey];
      const ar = sizeInfo ? (sizeInfo.w / sizeInfo.h) : 0.72;
      const planeH = CELL * 0.86;
      const planeW = planeH * ar;

      const faceGeo = new THREE.PlaneGeometry(planeW, planeH);
      const faceMat = new THREE.MeshStandardMaterial({
        color: 0xf5efe2, roughness: 0.62, metalness: 0.0, transparent: false
      });
      const face = new THREE.Mesh(faceGeo, faceMat);
      face.rotation.x = -Math.PI / 2;
      // 面片必须高于侧壁顶面（见常量区注释），否则 42° 斜视下被侧壁遮挡
      face.position.set(w.x, FACE_Y, w.z);
      face.castShadow = true;
      face.userData.slot = idx;
      pieceGroup.add(face);
      slot.cardFace = face;

      const sideGeo = new THREE.BoxGeometry(planeW * 0.94, SIDE_H, planeH * 0.96);
      const sideMat = new THREE.MeshStandardMaterial({
        color: COLORS.boardDeep, roughness: 0.8, metalness: 0.05
      });
      const side = new THREE.Mesh(sideGeo, sideMat);
      side.position.set(w.x, SIDE_CENTER_Y, w.z);
      pieceGroup.add(side);
      slot.cardSide = side;

      loadPieceTexture(piece, faceMat);
      updatePieceHighlight(idx, piece);
    }

    /** 移除槽位里的视觉对象并释放 geometry/material */
    function clearSlotMesh(slot) {
      const kill = (obj) => {
        if (!obj) return;
        pieceGroup.remove(obj);
        obj.traverse && obj.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => { m.__disposed = true; m.dispose(); });
            else { o.material.__disposed = true; o.material.dispose(); }
          }
        });
      };
      if (slot.root) {
        if (window.gsap) window.gsap.killTweensOf(slot.root.position);
        kill(slot.root); slot.root = null;
      }
      if (slot.cardFace) { kill(slot.cardFace); slot.cardFace = null; }
      if (slot.cardSide) { kill(slot.cardSide); slot.cardSide = null; }
    }

    /* ============================================================
       3D 原生动画：由前后两次局面差分推断
       - 移动：棋子沿抛物线跳到目标格（gsap 时间线）
       - 吃子：被吃方位置喷出主题色碎屑 + 扩散光环，本体直接移除
       差分失败（重开/多子同时变动）时静默跳过，只做静态同步。
       ============================================================ */

    /**
     * 比对两次棋子键位快照
     * @returns {{moves: Array<{fromIdx,toIdx,key}>, captures: Array<{idx,key}>}|null}
     *          变动过多（>4 格，重开/批量悔棋）时返回 null
     */
    function diffBoard(prev, next) {
      if (!prev || prev.length !== next.length) return null;
      const changed = [];
      for (let i = 0; i < next.length; i++) {
        if (prev[i] !== next[i]) changed.push(i);
        if (changed.length > 4) return null;   // 大变动 → 放弃动画
      }
      const moves = [];
      const captures = [];
      for (const to of changed) {
        const nowKey = next[to];
        const prevKey = prev[to];
        if (nowKey && !prevKey) {
          // 出现棋子：找同键棋子从哪来（上一个局面里有、这个局面里没了/换了的格子）
          const sources = changed.filter(i => prev[i] === nowKey && i !== to);
          if (sources.length === 1) moves.push({ fromIdx: sources[0], toIdx: to, key: nowKey });
        } else if (nowKey && prevKey && nowKey !== prevKey) {
          // 有棋子顶替了另一个棋子 → 被顶掉的吃子事件
          captures.push({ idx: to, key: prevKey });
        }
      }
      return { moves, captures };
    }

    /** 播放差分动画：跳移动 + 吃子爆发（已由 playAttack3D 原生演出的跳过） */
    function playDiffs(anims) {
      const THREE = window.THREE;
      if (!window.gsap) return;
      const fresh = (performance.now() - recentFx.time) < 3500;
      for (const cap of anims.captures) {
        if (fresh && recentFx.captures.has(cap.idx)) continue;
        spawnCaptureBurst(THREE, cap.idx, cap.key);
      }
      for (const mv of anims.moves) {
        if (fresh && recentFx.moves.has(mv.toIdx)) continue;
        const slot = pieceSlots[mv.toIdx];
        if (!slot || !slot.root) continue;   // 卡片降级路径不跳（视觉是平面，跳了奇怪）
        const from = cellWorld(Math.floor(mv.fromIdx / Core.COLS), mv.fromIdx % Core.COLS);
        const to = cellWorld(Math.floor(mv.toIdx / Core.COLS), mv.toIdx % Core.COLS);
        const baseY = slot.baseY || CELL_H / 2;
        const pos = slot.root.position;
        window.gsap.killTweensOf(pos);
        // 【关键】把新对象搬回**来源格**再补间。
        // setPiece 是按当前局面建的，这个 root 一出生就站在目标格上；
        // 若直接 to(x: to.x, z: to.z)，就是"从目标格走到目标格"的原地补间，
        // 视觉上等于瞬移（只剩一个原地弹跳）。
        // 先 set 到 from，补间到 to，才真的有"跳过去"的过程。
        pos.set(from.x, baseY, from.z);
        const tl = window.gsap.timeline();
        tl.to(pos, { x: to.x, z: to.z, duration: 0.38, ease: 'power1.inOut' }, 0);
        tl.to(pos, { y: baseY + 0.42, duration: 0.19, ease: 'power2.out' }, 0);
        tl.to(pos, { y: baseY, duration: 0.19, ease: 'power2.in' }, 0.19);
        // 落地小压扁回弹
        tl.to(slot.root.scale, { y: 0.86, duration: 0.07, ease: 'power2.out' }, 0.38);
        tl.to(slot.root.scale, { y: 1, duration: 0.12, ease: 'power2.in' }, 0.45);
      }
    }

    /** 吃子爆发：主题色碎屑 + 扩散光环 + 尘雾小烟（挂在被吃格子上方） */
    function spawnCaptureBurst(THREE, idx, key) {
      if (!window.gsap) return;
      const row = Math.floor(idx / Core.COLS);
      const col = idx % Core.COLS;
      const w = cellWorld(row, col);
      const y0 = CELL_H / 2 + 0.08;
      const typeKey = (key.split('/')[1] || 'dog').toLowerCase();
      const theme = (window.ANIMAL_THEMES || {})[typeKey] || {};
      const color = new THREE.Color(theme.color || '#c9a227');

      // 碎屑：12 个小四面体沿抛物线散开
      const debrisGeo = new THREE.TetrahedronGeometry(0.05);
      for (let i = 0; i < 12; i++) {
        const m = new THREE.Mesh(debrisGeo, new THREE.MeshStandardMaterial({
          color: color, roughness: 0.5, transparent: true, emissive: color, emissiveIntensity: 0.35
        }));
        const a = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 0.5 + Math.random() * 0.55;
        m.position.set(w.x, y0, w.z);
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        pieceGroup.add(m);
        const gx = w.x + Math.cos(a) * dist;
        const gz = w.z + Math.sin(a) * dist;
        const gy = y0 + 0.35 + Math.random() * 0.3;
        window.gsap.to(m.position, {
          x: gx, z: gz, duration: 0.5, ease: 'power2.out',
          onUpdate: null
        });
        // y 单独走抛物线：升→落
        window.gsap.to(m.position, { y: gy, duration: 0.2, ease: 'power2.out' });
        window.gsap.to(m.position, { y: y0 - 0.05, duration: 0.32, ease: 'power2.in', delay: 0.2 });
        window.gsap.to(m.rotation, { x: m.rotation.x + 5, z: m.rotation.z + 4, duration: 0.5 });
        window.gsap.to(m.material, { opacity: 0, duration: 0.22, delay: 0.3, onComplete: () => {
          pieceGroup.remove(m);
          m.geometry.dispose(); m.material.dispose();
        }});
      }

      // 扩散光环（贴地圆环）
      const ringGeo = new THREE.RingGeometry(0.2, 0.3, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(w.x, CELL_H / 2 + 0.015, w.z);
      scene.add(ring);
      window.gsap.to(ring.scale, { x: 2.6, y: 2.6, z: 1, duration: 0.45, ease: 'power2.out' });
      window.gsap.to(ring.material, { opacity: 0, duration: 0.45, ease: 'power2.out', onComplete: () => {
        scene.remove(ring);
        ring.geometry.dispose(); ring.material.dispose();
      }});

      // 落点小震屏（复用 CanvasVfx 的震屏，若无则跳过）
      if (window.CanvasVfx && window.CanvasVfx.shake) {
        window.CanvasVfx.shake(0.3);
      }
    }

    /* ============================================================
       3D 原生攻击特效（playAttack3D）
       ------------------------------------------------------------
       由 FxBridge 在 3D 模式下调用，替代 2D 卡片覆盖层。
       时间线（约 1.7s，比 2D 版 2.55s 更干脆）：
         0.00-0.14  攻方蓄力下蹲
         0.14-0.44  抛物线冲锋扑向目标格
         0.44       撞击：点光爆闪 + 冲击波环 + 碎屑 + 镜头震动 + 守方被击倒
         0.55-1.4   逐动物签名特效（象牙突刺/火焰喷泉/闪电王印/新月斩…）
         1.7        收尾（攻方回正、临时物体统一清理）
       ============================================================ */

    /** 临时网格：挂 fxGroup，生命到期自动释放 */
    function fxMesh(geo, mat, pos, ttl) {
      const m = new THREE.Mesh(geo, mat);
      if (pos) m.position.set(pos.x, pos.y, pos.z);
      fxGroup.add(m);
      if (ttl && window.gsap) {
        window.gsap.delayedCall(ttl, () => {
          fxGroup.remove(m);
          geo.dispose();
          mat.dispose();
        });
      }
      return m;
    }

    /** 扩散冲击环 */
    function fxRing(w, colorHex, opts = {}) {
      const geo = new THREE.RingGeometry(0.18, 0.3, 36);
      const material = new THREE.MeshBasicMaterial({
        color: colorHex, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false
      });
      const ring = new THREE.Mesh(geo, material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(w.x, CELL_H / 2 + 0.02, w.z);
      fxGroup.add(ring);
      window.gsap.to(ring.scale, { x: opts.r1 || 2.8, y: opts.r1 || 2.8, z: 1, duration: opts.life || 0.5, ease: 'power2.out' });
      window.gsap.to(material, { opacity: 0, duration: opts.life || 0.5, ease: 'power1.out', onComplete: () => {
        fxGroup.remove(ring); geo.dispose(); material.dispose();
      }});
    }

    /** 碎屑抛洒 */
    function fxBurst(w, colorHex, opts = {}) {
      const n = opts.count || 12;
      const geo = new THREE.TetrahedronGeometry(opts.size || 0.05);
      for (let i = 0; i < n; i++) {
        const material = new THREE.MeshStandardMaterial({
          color: colorHex, roughness: 0.5, transparent: true,
          emissive: colorHex, emissiveIntensity: 0.4
        });
        const m = new THREE.Mesh(geo, material);
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const dist = (opts.dist || 0.55) * (0.6 + Math.random() * 0.8);
        m.position.set(w.x, w.y, w.z);
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        fxGroup.add(m);
        window.gsap.to(m.position, { x: w.x + Math.cos(a) * dist, z: w.z + Math.sin(a) * dist, duration: 0.5, ease: 'power2.out' });
        window.gsap.to(m.position, { y: w.y + 0.3 + Math.random() * 0.3, duration: 0.2, ease: 'power2.out' });
        window.gsap.to(m.position, { y: w.y - 0.06, duration: 0.32, ease: 'power2.in', delay: 0.2 });
        window.gsap.to(m.rotation, { x: m.rotation.x + 5, z: m.rotation.z + 4, duration: 0.5 });
        window.gsap.to(material, { opacity: 0, duration: 0.22, delay: 0.3, onComplete: () => {
          fxGroup.remove(m); material.dispose();
        }});
      }
      // 共享几何体在最后一片消失时释放
      window.gsap.delayedCall(0.9, () => geo.dispose());
    }

    /** 上升火光/水花喷泉 */
    function fxFountain(w, colors, opts = {}) {
      const n = opts.count || 14;
      const geo = new THREE.SphereGeometry(opts.size || 0.045, 8, 6);
      for (let i = 0; i < n; i++) {
        const colorHex = colors[i % colors.length];
        const material = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95 });
        const m = new THREE.Mesh(geo, material);
        const a = (i / n) * Math.PI * 2;
        const spread = opts.spread || 0.4;
        m.position.set(w.x + Math.cos(a) * 0.06, w.y, w.z + Math.sin(a) * 0.06);
        fxGroup.add(m);
        const up = (opts.height || 0.7) * (0.7 + Math.random() * 0.6);
        const out = spread * (0.5 + Math.random() * 0.8);
        window.gsap.to(m.position, { y: w.y + up, duration: 0.28, ease: 'power2.out' });
        window.gsap.to(m.position, { x: m.position.x + Math.cos(a) * out, z: m.position.z + Math.sin(a) * out, duration: 0.55, ease: 'power1.out' });
        window.gsap.to(m.position, { y: w.y - 0.05, duration: 0.3, ease: 'power2.in', delay: 0.28 });
        window.gsap.to(material, { opacity: 0, duration: 0.25, delay: 0.35, onComplete: () => {
          fxGroup.remove(m); material.dispose();
        }});
      }
      window.gsap.delayedCall(0.85, () => geo.dispose());
    }

    /** 新月斩击弧（局部圆环，旋转掠过 + 淡出） */
    function fxSlash(w, angle, colorHex, opts = {}) {
      const radius = opts.radius || 0.42;
      const arcLen = opts.arc || Math.PI * 0.85;
      const geo = new THREE.TorusGeometry(radius, opts.thickness || 0.05, 8, 28, arcLen);
      const material = new THREE.MeshBasicMaterial({
        color: colorHex, transparent: true, opacity: 1,
        side: THREE.DoubleSide, depthWrite: false
      });
      const m = new THREE.Mesh(geo, material);
      m.position.set(w.x, w.y + 0.08, w.z);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = angle || 0;
      fxGroup.add(m);
      window.gsap.fromTo(m.scale, { x: 0.4, y: 0.4, z: 0.4 }, { x: 1.35, y: 1.35, z: 1.35, duration: opts.life || 0.3, ease: 'power2.out' });
      window.gsap.to(m.rotation, { z: (angle || 0) + (opts.sweep || 0.9), duration: opts.life || 0.3, ease: 'power2.out' });
      window.gsap.to(material, { opacity: 0, duration: 0.18, delay: (opts.life || 0.3) * 0.55, onComplete: () => {
        fxGroup.remove(m); geo.dispose(); material.dispose();
      }});
    }

    /** 撞击地面闪光：加色混合的亮片快速放大淡出（比点光更醒目） */
    function fxImpactFlash(w, colorHex, opts = {}) {
      const size = opts.size || 0.85;
      const geo = new THREE.PlaneGeometry(size, size);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const c = cv.getContext('2d');
      const grad = c.createRadialGradient(64, 64, 4, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, colorHex);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = grad;
      c.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(w.x, CELL_H / 2 + 0.03, w.z);
      fxGroup.add(m);
      const life = opts.life || 0.35;
      window.gsap.fromTo(m.scale, { x: 0.5, y: 0.5, z: 1 }, { x: 2.1, y: 2.1, z: 1, duration: life, ease: 'power2.out' });
      window.gsap.to(mat, { opacity: 0, duration: life, ease: 'power1.out', onComplete: () => {
        fxGroup.remove(m); geo.dispose(); mat.map.dispose(); mat.dispose();
      }});
    }

    /** 闪电折线 */
    function fxBolt(w, angle, colorHex, opts = {}) {
      const len = opts.len || 0.9;
      const segs = 6;
      const pts = [new THREE.Vector3(0, 0, 0)];
      for (let i = 1; i <= segs; i++) {
        const d = (len / segs) * i;
        const jitter = (i === segs) ? 0 : (Math.random() - 0.5) * len * 0.2;
        pts.push(new THREE.Vector3(
          Math.cos(angle) * d + jitter,
          opts.vertical === false ? 0.05 : 0.05 + i * 0.015,
          Math.sin(angle) * d + (Math.random() - 0.5) * len * 0.1
        ));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const material = new THREE.LineBasicMaterial({
        color: colorHex, transparent: true, opacity: 1
      });
      const line = new THREE.Line(geo, material);
      line.position.set(w.x, w.y + 0.05, w.z);
      fxGroup.add(line);
      window.gsap.to(material, { opacity: 0, duration: opts.life || 0.25, delay: 0.06, onComplete: () => {
        fxGroup.remove(line); geo.dispose(); material.dispose();
      }});
    }

    /** 尘雾（半透明膨胀球） */
    function fxSmoke(w, colorHex, opts = {}) {
      const n = opts.count || 4;
      for (let i = 0; i < n; i++) {
        const geo = new THREE.SphereGeometry((opts.size || 0.14) * (0.7 + Math.random() * 0.6), 10, 8);
        const material = new THREE.MeshStandardMaterial({
          color: colorHex, transparent: true, opacity: 0.3, roughness: 1, depthWrite: false
        });
        const m = new THREE.Mesh(geo, material);
        m.position.set(w.x + (Math.random() - 0.5) * 0.3, w.y + 0.06, w.z + (Math.random() - 0.5) * 0.3);
        fxGroup.add(m);
        window.gsap.to(m.scale, { x: 2.1, y: 1.5, z: 2.1, duration: 0.8, ease: 'power1.out' });
        window.gsap.to(m.position, { y: m.position.y + 0.22, duration: 0.8, ease: 'power1.out' });
        window.gsap.to(material, { opacity: 0, duration: 0.7, ease: 'power1.out', onComplete: () => {
          fxGroup.remove(m); geo.dispose(); material.dispose();
        }});
      }
    }

    /** 撞击点光爆闪 */
    function fxFlashLight(w, colorHex, intensity = 5) {
      const light = new THREE.PointLight(colorHex, intensity, 4.5, 2);
      light.position.set(w.x, w.y + 0.4, w.z);
      fxGroup.add(light);
      window.gsap.to(light, { intensity: 0, duration: 0.32, ease: 'power2.out', onComplete: () => {
        fxGroup.remove(light);
      }});
    }

    /** 镜头震动（短促随机偏移后精确复位） */
    function shakeCamera(strength = 0.5) {
      if (!window.gsap || !camera) return;
      const base = camera.position.clone();
      const amp = 0.04 + strength * 0.1;
      const tl = window.gsap.timeline({
        onComplete: () => camera.position.set(base.x, base.y, base.z)
      });
      const steps = 4 + Math.round(strength * 4);
      for (let i = 0; i < steps; i++) {
        tl.to(camera.position, {
          x: base.x + (Math.random() - 0.5) * 2 * amp,
          y: base.y + (Math.random() - 0.5) * amp,
          duration: 0.04, ease: 'none'
        });
      }
      tl.to(camera.position, { x: base.x, y: base.y, z: base.z, duration: 0.05, ease: 'power1.out' });
    }

    /* ============================================================
       AttackFx · 攻击剧场创作 API
       ------------------------------------------------------------
       暴露给 js/render/cinematics/<动物>.js 的受控接口。
       剧场模块只允许通过这组 API 触碰场景，不直接持有 scene/camera。
       所有 fx 原语都自带生命周期（生成 → 动画 → 自动销毁）。
       ============================================================ */
    const AttackFx = {
      ring: fxRing,               // (w, colorHex, {r0,r1,width,life})
      burst: fxBurst,             // (w, colorHex, {count,size,dist,gravity?})
      fountain: fxFountain,       // (w, colors[], {count,height,spread,size,duration?})
      slash: fxSlash,             // (w, angle, colorHex, {radius,arc,sweep,width?:thickness,life})
      bolt: fxBolt,               // (w, angle, colorHex, {len,width,life})
      smoke: fxSmoke,             // (w, colorHex, {count,size})
      flashLight: fxFlashLight,   // (w, colorHex, intensity)
      impactFlash: fxImpactFlash, // (w, colorHex, {size,life})
      shakeCamera,                // (strength 0~1)
      world: cellWorld,           // (row, col) → {x,y,z} 格心世界坐标
      cellTopY: () => CELL_H / 2,
      sound: () => window.FxSound || null,
      /** 剧场期间隐藏选中光环（否则金环滞留在攻方已离开的格子上） */
      hideSelRing() { if (selRing) selRing.visible = false; },
      /** 临时对象挂到特效层；ttl 秒后自动移除（不自动 dispose） */
      add(obj, ttl) {
        if (!fxGroup || !obj) return;
        fxGroup.add(obj);
        if (ttl && window.gsap) {
          window.gsap.delayedCall(ttl, () => {
            if (obj.parent) obj.parent.remove(obj);
          });
        }
      },
      remove(obj) { if (fxGroup && obj) fxGroup.remove(obj); },
      /** 递归释放 geometry / material / map（不留 GPU 垃圾） */
      disposeTree(obj) {
        obj.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
          }
        });
      },
      /** 组装剧场 ctx；攻守任一方不是 3D 模型（卡片降级）时返回 null */
      buildCtx(fromRow, fromCol, toRow, toCol) {
        const a = pieceSlots[fromRow * Core.COLS + fromCol];
        const d = pieceSlots[toRow * Core.COLS + toCol];
        if (!a || !d || !a.root || !d.root) return null;
        return {
          attacker: { root: a.root, baseY: a.baseY || CELL_H / 2, from: cellWorld(fromRow, fromCol) },
          defender: { root: d.root, baseY: d.baseY || CELL_H / 2, to: cellWorld(toRow, toCol) },
          theme: null, animal: null, defenderAnimal: null, scene: null
        };
      }
    };
    window.AttackFx = AttackFx;
    // 剧场注册表：cinematics/<动物>.js 各自往里挂 window.AttackCinematics.<animal>
    window.AttackCinematics = window.AttackCinematics || {};

    /** 逐动物签名特效（普通吃子 scene=burst） */
    function releaseAnimal3D(animal, w, theme) {
      const col = new THREE.Color(theme.color || '#c9a227');
      const y = CELL_H / 2 + 0.05;
      const P = { x: w.x, y, z: w.z };
      switch (animal) {
        case 'elephant': {
          // 象牙突刺：3 根白锥从地里弹出
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + 0.5;
            const geo = new THREE.ConeGeometry(0.05, 0.34, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0xf3ede0, roughness: 0.35, emissive: 0xfff2cf, emissiveIntensity: 0.35 });
            const m = fxMesh(geo, mat, { x: w.x + Math.cos(a) * 0.3, y: y - 0.1, z: w.z + Math.sin(a) * 0.3 }, 0.9);
            m.rotation.x = Math.PI;
            window.gsap.fromTo(m.scale, { y: 0.01 }, { y: 1, duration: 0.2, ease: 'back.out(2.4)' });
            window.gsap.to(m.position, { y: y + 0.12, duration: 0.2, ease: 'back.out(2)' });
            window.gsap.to(m.scale, { y: 0.01, duration: 0.2, delay: 0.55 });
          }
          fxSmoke(P, 0x9a7a52, { count: 4, size: 0.16 });
          break;
        }
        case 'lion': {
          fxFountain(P, [0xffb84d, 0xff8a3d, 0xffd76a], { count: 16, height: 0.85, spread: 0.45, size: 0.05 });
          fxSmoke(P, 0x6d5233, { count: 3, size: 0.15 });
          break;
        }
        case 'tiger': {
          // 王字蓝印弹出 + 双闪电
          const cv = document.createElement('canvas');
          cv.width = cv.height = 128;
          const c = cv.getContext('2d');
          c.fillStyle = 'rgba(91,109,184,0.92)';
          c.beginPath(); c.roundRect(14, 14, 100, 100, 18); c.fill();
          c.fillStyle = '#fff'; c.font = '700 78px "STKaiti","KaiTi",serif';
          c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText('王', 64, 70);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
          spr.scale.set(0.72, 0.72, 1);
          spr.position.set(w.x, y + 0.42, w.z);
          fxGroup.add(spr);
          window.gsap.fromTo(spr.scale, { x: 0.1, y: 0.1 }, { x: 0.72, y: 0.72, duration: 0.3, ease: 'back.out(1.8)' });
          window.gsap.to(spr.position, { y: y + 0.62, duration: 0.6, ease: 'power1.out' });
          window.gsap.to(spr.material, { opacity: 0, duration: 0.25, delay: 0.72, onComplete: () => {
            fxGroup.remove(spr); spr.material.map.dispose(); spr.material.dispose();
          }});
          fxBolt(P, -Math.PI / 2 - 0.5, 0xffe27a, { len: 0.9 });
          fxBolt(P, -Math.PI / 2 + 0.5, 0xffe27a, { len: 0.9 });
          fxBurst(P, 0xffe27a, { count: 10, size: 0.04 });
          break;
        }
        case 'leopard': {
          const base = -Math.PI / 2 + (Math.random() - 0.5);
          [-0.5, 0, 0.5].forEach((off, i) => {
            window.gsap.delayedCall(i * 0.07, () => fxSlash(P, base + off, 0xfff3c4, { radius: 0.4 + i * 0.09, arc: Math.PI * 0.8, sweep: 1.0, life: 0.3 }));
          });
          fxBurst(P, 0xd4c04a, { count: 8, size: 0.035, dist: 0.7 });
          break;
        }
        case 'wolf': {
          // 冰晶锥爆
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const geo = new THREE.ConeGeometry(0.045, 0.2, 6);
            const mat = new THREE.MeshStandardMaterial({ color: 0xbcd4ec, roughness: 0.25, emissive: 0x7a8fb0, emissiveIntensity: 0.4, transparent: true });
            const m = fxMesh(geo, mat, { x: w.x, y: y + 0.1, z: w.z }, 0.8);
            m.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.6, 0, a);
            window.gsap.to(m.position, { x: w.x + Math.cos(a) * 0.6, z: w.z + Math.sin(a) * 0.6, y: y + 0.2, duration: 0.4, ease: 'power2.out' });
            window.gsap.to(mat, { opacity: 0, duration: 0.2, delay: 0.42 });
          }
          fxRing(P, 0x7a8fb0, { r1: 2.2, life: 0.45 });
          break;
        }
        case 'dog': {
          fxBurst(P, 0xffd76a, { count: 12, size: 0.045 });
          fxSmoke({ x: w.x, y: y, z: w.z }, 0xa68b64, { count: 3, size: 0.13 });
          break;
        }
        case 'cat': {
          fxSlash(P, -0.5, 0xf5d5de, { radius: 0.38, arc: Math.PI * 0.7, sweep: 0.8, life: 0.26 });
          fxSlash(P, Math.PI - 0.5, 0xf5d5de, { radius: 0.44, arc: Math.PI * 0.7, sweep: 0.8, life: 0.3 });
          fxBurst(P, 0xe8a8b8, { count: 8, size: 0.035, dist: 0.5 });
          break;
        }
        case 'rat': {
          fxSmoke(P, 0x8f8a84, { count: 5, size: 0.15 });
          fxBurst(P, 0xc9c2ba, { count: 8, size: 0.035, dist: 0.45 });
          break;
        }
        default:
          fxBurst(P, theme.color || 0xc9a227, { count: 10 });
      }
    }

    /**
     * 3D 原生攻击特效主入口（渲染器扩展方法，不属于六方法契约）
     * @param {Object} eventInfo FxBridge.categorizeMove 的结果
     * @param {Object} ctx { fromRow, fromCol, toRow, toCol, attacker, defender }
     * @returns {Promise} 动画完成后 resolve
     */
    function playAttack3D(eventInfo, ctx) {
      return new Promise((resolve) => {
        if (!ready || !window.gsap || !window.THREE) { resolve(); return; }
        const { fromRow, fromCol, toRow, toCol, attacker, defender } = ctx;
        const scene_ = eventInfo.scene || 'burst';
        const animal = eventInfo.animal || 'dog';
        const theme = (window.ANIMAL_THEMES || {})[animal] || {};
        const fromW = cellWorld(fromRow, fromCol);
        const toW = cellWorld(toRow, toCol);
        const impactP = { x: toW.x, y: CELL_H / 2 + 0.06, z: toW.z };

        const fromIdx = fromRow * Core.COLS + fromCol;
        const toIdx = toRow * Core.COLS + toCol;
        // 记录已原生演出的事件：render() 差分时跳过，避免重复 hop/burst
        recentFx = {
          moves: new Set([toIdx]),
          captures: defender ? new Set([toIdx]) : new Set(),
          time: performance.now()
        };

        const atkSlot = pieceSlots[fromIdx];
        const defSlot = pieceSlots[toIdx];
        const atk = atkSlot && atkSlot.root;
        const def = defSlot && defSlot.root;

        // ---- 反杀·鼠吃象：专属剧场版（钻鼻 → 抬脚挣扎 → 痛苦 → 摔倒） ----
        if (scene_ === 'reverse' && def) {
          fxBusyUntil = performance.now() + 4200;
          if (window.AttackFx) window.AttackFx.hideSelRing();
          // 注意：执行器里的 return 无效，必须显式桥接 resolve
          playReverseCinematic(ctx).then(resolve, resolve);
          return;
        }

        // ---- 普通吃子/跳河/陷阱：优先专属剧场（cinematics/<动物>.js 注册） ----
        if ((scene_ === 'burst' || scene_ === 'stream' || scene_ === 'sink') && atk && def) {
          const cineFn = window.AttackCinematics && window.AttackCinematics[animal];
          if (typeof cineFn === 'function') {
            const cctx = window.AttackFx.buildCtx(fromRow, fromCol, toRow, toCol);
            if (cctx) {
              cctx.theme = theme;
              cctx.animal = animal;
              cctx.defenderAnimal = eventInfo.defenderAnimal || null;
              cctx.scene = scene_;
              fxBusyUntil = performance.now() + 4600;
              if (window.AttackFx) window.AttackFx.hideSelRing();
              cineFn(cctx).then(resolve, resolve);
              return;
            }
          }
        }

        // finish 只允许生效一次：动画时间线完成 / 兜底定时器，先到先得
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        window.gsap.delayedCall(2.8, finish);   // 兜底

        const tl = window.gsap.timeline({ onComplete: () => finish() });

        // ---- 攻方：蓄力 → 冲锋扑击 ----
        if (atk) {
          const baseY = atkSlot.baseY || CELL_H / 2;
          const pos = atk.position;
          window.gsap.killTweensOf(pos);
          tl.to(atk.scale, { y: 0.84, duration: 0.10, ease: 'power2.out' }, 0);
          tl.to(atk.scale, { y: 1.0, duration: 0.10, ease: 'power2.in' }, 0.10);
          tl.to(pos, { x: toW.x, z: toW.z, duration: 0.30, ease: 'power2.in' }, 0.14);
          tl.to(pos, { y: baseY + 0.48, duration: 0.15, ease: 'power2.out' }, 0.14);
          tl.to(pos, { y: baseY, duration: 0.15, ease: 'power2.in' }, 0.29);
          // 撞击落定微弹
          tl.to(atk.scale, { y: 0.9, duration: 0.06, ease: 'power2.out' }, 0.44);
          tl.to(atk.scale, { y: 1, duration: 0.14, ease: 'back.out(2.2)' }, 0.50);
        }

        // ---- 撞击帧 ----
        tl.call(() => {
          const strong = scene_ === 'reverse' || scene_ === 'crown';
          fxImpactFlash(impactP, strong ? 'rgba(255,220,160,0.95)' : 'rgba(255,190,150,0.85)',
            { size: strong ? 1.15 : 0.85, life: strong ? 0.45 : 0.32 });
          fxFlashLight(impactP, scene_ === 'crown' ? 0xffd76a : 0xffb0a0, strong ? 8 : 5);
          fxRing(impactP, scene_ === 'crown' ? 0xffd76a : 0xffffff, { r1: strong ? 3.4 : 2.6, life: 0.5 });
          if (scene_ !== 'sink') {
            fxBurst(impactP, theme.color || '#c9a227', { count: strong ? 18 : 10, size: strong ? 0.07 : 0.045 });
          }
          shakeCamera(strong ? 0.85 : 0.5);
          if (window.FxSound) window.FxSound.impact();

          // 守方被击倒（反向倾倒 + 缩没），陷阱场景改为直沉
          if (def) {
            const dirX = Math.sign(toW.x - fromW.x);
            const dirZ = Math.sign(toW.z - fromW.z);
            window.gsap.killTweensOf(def.position);
            if (scene_ === 'sink' || scene_ === 'stream') {
              window.gsap.to(def.position, { y: defSlot.baseY - 0.22, duration: 0.5, ease: 'power2.in' });
              window.gsap.to(def.rotation, { z: (Math.random() - 0.5) * 0.8, duration: 0.5 });
            } else {
              window.gsap.to(def.position, {
                x: toW.x + dirX * 0.3, z: toW.z + dirZ * 0.3,
                duration: 0.32, ease: 'power2.out'
              });
              window.gsap.to(def.rotation, { x: dirZ * 1.15, z: -dirX * 1.15, duration: 0.3, ease: 'power2.out' });
            }
            window.gsap.to(def.scale, { x: 0.05, y: 0.05, z: 0.05, duration: 0.34, ease: 'power2.in', delay: 0.16, onComplete: () => { def.visible = false; } });
          }
        }, [], 0.44);

        // ---- 场景签名 ----
        tl.call(() => {
          const y = CELL_H / 2 + 0.05;
          const P = { x: toW.x, y, z: toW.z };
          if (scene_ === 'crown') {
            // 兽穴获胜：金屑喷泉 + 双重冲击 + 强震
            fxFountain(P, [0xffd76a, 0xffe9b8, 0xe8a535], { count: 24, height: 1.1, spread: 0.6, size: 0.055 });
            fxRing(P, 0xffd76a, { r1: 4.2, life: 0.7 });
            fxBurst(P, 0xf0c75e, { count: 12, size: 0.05, dist: 0.8 });
            shakeCamera(0.95);
          } else if (scene_ === 'stream') {
            // 跳河吃子：大水花
            fxFountain(P, [0x7db8e8, 0xa8d0f0, 0x4a8ab5], { count: 20, height: 0.95, spread: 0.55, size: 0.05 });
            fxRing(P, 0x7db8e8, { r1: 2.6, life: 0.55 });
            fxSmoke(P, 0xb8d8ee, { count: 3, size: 0.16 });
          } else if (scene_ === 'sink') {
            // 陷阱吃子：尘土下陷
            fxSmoke(P, 0xa68b64, { count: 5, size: 0.17 });
            fxBurst(P, 0x8a6a44, { count: 8, size: 0.04, dist: 0.4 });
          } else if (scene_ === 'reverse') {
            // 反杀·鼠吃象：X 斩 + 大爆发
            [0.7, Math.PI - 0.7, -0.7, Math.PI + 0.7].forEach(a => fxSlash(P, a, 0xffffff, { radius: 0.58, arc: Math.PI * 0.9, sweep: 1.0, life: 0.4, thickness: 0.06 }));
            fxBurst(P, 0xd4a05a, { count: 18, size: 0.08, dist: 0.85 });
            fxImpactFlash(P, 'rgba(255,240,220,0.95)', { size: 1.3, life: 0.5 });
            fxFlashLight(P, 0xffffff, 9);
            shakeCamera(1.0);
          } else {
            // 普通吃子：逐动物签名
            releaseAnimal3D(animal, toW, theme);
          }
        }, [], 0.55);

        // ---- 收尾：攻方精确落位 ----
        tl.call(() => {
          if (atk && atkSlot) {
            window.gsap.killTweensOf(atk.position);
            atk.position.set(toW.x, atkSlot.baseY || CELL_H / 2, toW.z);
            atk.scale.set(1, 1, 1);
            atk.visible = true;
          }
        }, [], 1.7);
        // fxGroup 里可能有长尾对象，2.6s 后全部清场
        tl.call(() => {
          while (fxGroup.children.length) {
            const o = fxGroup.children[0];
            fxGroup.remove(o);
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              if (o.material.map) o.material.map.dispose();
              o.material.dispose();
            }
          }
        }, [], 2.4);
      });
    }

    /**
     * 反杀·鼠吃象 · 专属剧场版
     * ------------------------------------------------------------
     * 分镜（约 3.0s）：
     *   0.00  大象受惊小跳 + 转身侧对镜头（露出象鼻），老鼠同时出发
     *   0.34  老鼠爬上象头
     *   0.56  老鼠钻进象鼻（奔向鼻尖 → 缩小消失）+ 尘雾
     *   0.80  大象惊跳，💢 怒气符号弹出，痛苦泛红开始
     *   0.95  抬起前脚直立（绕自身横轴，YXZ 顺序保证与朝向无关）
     *   1.26  挣扎：俯仰抖动 + 左右扭动 + 脚下扬尘
     *   1.62  底座淡出（脱掉底座倒下才自然）
     *   1.75  仰面摔倒（前冲方向倒下），落地尘土 + 强震 + 闷响
     *   2.18  老鼠从象身钻出、跳回格心、胜利摇摆 + 金光
     *   2.55  大象彻底淡出，清场
     * 技术点：
     *   - rotation.order 改 'YXZ'：先偏航再俯仰，"抬前脚/摔倒"永远绕自身横轴
     *   - 象鼻尖端用 ele.localToWorld 反算世界坐标，老鼠钻入/钻出都瞄准它
     *   - 大象材质预先转 transparent，收尾整体淡出
     */
    function playReverseCinematic(ctx) {
      return new Promise((resolve) => {
        if (!ready || !window.gsap || !window.THREE) { resolve(); return; }
        const { fromRow, fromCol, toRow, toCol } = ctx;
        const fromW = cellWorld(fromRow, fromCol);
        const toW = cellWorld(toRow, toCol);
        const atkSlot = pieceSlots[fromRow * Core.COLS + fromCol];
        const defSlot = pieceSlots[toRow * Core.COLS + toCol];
        const rat = atkSlot && atkSlot.root;
        const ele = defSlot && defSlot.root;
        if (!ele) { resolve(); return; }

        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        window.gsap.delayedCall(4.5, finish);   // 兜底
        const tl = window.gsap.timeline({ onComplete: () => finish() });

        const eleBaseY = defSlot.baseY || CELL_H / 2;
        const ratBaseY = (atkSlot && atkSlot.baseY) || CELL_H / 2;

        // 大象材质转透明（收尾淡出），收集待淡出材质
        const eleMats = [];
        ele.traverse(o => {
          if (o.isMesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(m => { m.transparent = true; m.needsUpdate = true; eleMats.push(m); });
          }
        });
        // 剧场旋转顺序：先偏航后俯仰
        ele.rotation.order = 'YXZ';
        // 收起选中光环（老鼠的格子光环会残留干扰剧场画面）
        if (selRing) selRing.visible = false;

        // 💢 怒气符号（挂大象组，跟随起立；Sprite 永远面向镜头）
        const anger = (() => {
          const cv = document.createElement('canvas');
          cv.width = cv.height = 128;
          const c = cv.getContext('2d');
          c.font = '700 96px "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
          c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText('💢', 64, 68);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          const spr = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, opacity: 0, depthWrite: false
          }));
          spr.scale.set(0.5, 0.5, 1);
          spr.position.set(0, 1.05, 0);
          ele.add(spr);
          return spr;
        })();

        // ---- 0.00-0.30 大象受惊转身，老鼠冲向象头 ----
        tl.to(ele.position, { y: eleBaseY + 0.13, duration: 0.10, ease: 'power2.out' }, 0);
        tl.to(ele.position, { y: eleBaseY, duration: 0.12, ease: 'power2.in' }, 0.10);
        tl.to(ele.rotation, { y: ele.rotation.y + 1.25, duration: 0.30, ease: 'power2.inOut' }, 0.02);
        if (rat) {
          const rPos = rat.position;
          window.gsap.killTweensOf(rPos);
          tl.to(rPos, { x: toW.x + 0.16, z: toW.z - 0.26, duration: 0.26, ease: 'power1.in' }, 0.04);
          tl.to(rPos, { y: ratBaseY + 0.3, duration: 0.13, ease: 'power2.out' }, 0.04);
          tl.to(rPos, { y: ratBaseY, duration: 0.13, ease: 'power2.in' }, 0.17);
          // 爬上象头
          tl.to(rPos, { x: toW.x, z: toW.z - 0.10, y: eleBaseY + 0.56, duration: 0.22, ease: 'power2.out' }, 0.34);
        }

        // ---- 0.56 钻进象鼻：奔向鼻尖、缩小消失 ----
        tl.call(() => {
          const tip = ele.localToWorld(new THREE.Vector3(0, 0.10, 0.52));
          if (rat) {
            const rp = rat.position;
            window.gsap.killTweensOf(rp);
            window.gsap.to(rp, { x: tip.x, y: tip.y + 0.05, z: tip.z, duration: 0.22, ease: 'power2.in' });
            window.gsap.to(rat.scale, { x: 0.06, y: 0.06, z: 0.06, duration: 0.20, ease: 'power2.in', onComplete: () => { rat.visible = false; } });
          }
          fxSmoke({ x: tip.x, y: tip.y, z: tip.z }, 0x9a8a76, { count: 2, size: 0.08 });
        }, [], 0.56);

        // ---- 0.80 大象惊跳 + 怒气符号 + 痛苦泛红 ----
        tl.call(() => {
          window.gsap.fromTo(anger.scale, { x: 0.05, y: 0.05, z: 0.05 },
            { x: 0.5, y: 0.5, z: 0.5, duration: 0.3, ease: 'back.out(2.2)' });
          window.gsap.to(anger.material, { opacity: 0.95, duration: 0.15 });
          window.gsap.to(anger.position, { x: 0.12, duration: 0.08, yoyo: true, repeat: 5, ease: 'sine.inOut' });
          eleMats.forEach(m => { if (m.emissive) { m.emissive.setHex(0x7a1f14); } });
          if (window.FxSound) window.FxSound.play('elephant', 'burst');
          fxSmoke({ x: toW.x, y: CELL_H / 2 + 0.05, z: toW.z }, 0xa68b64, { count: 3, size: 0.13 });
        }, [], 0.80);

        // ---- 0.95-1.60 抬起前脚 + 挣扎 ----
        tl.to(ele.rotation, { x: -0.55, duration: 0.30, ease: 'power2.out' }, 0.92);
        tl.to(ele.position, { y: eleBaseY + 0.16, duration: 0.30, ease: 'power2.out' }, 0.92);
        tl.to(ele.rotation, { x: -0.38, duration: 0.13, ease: 'sine.inOut' }, 1.24);
        tl.to(ele.rotation, { x: -0.58, duration: 0.13, ease: 'sine.inOut' }, 1.37);
        tl.to(ele.rotation, { x: -0.44, duration: 0.12, ease: 'sine.inOut' }, 1.50);
        tl.to(ele.rotation, { z: 0.10, duration: 0.13, ease: 'sine.inOut' }, 1.24);
        tl.to(ele.rotation, { z: -0.10, duration: 0.13, ease: 'sine.inOut' }, 1.37);
        tl.to(ele.rotation, { z: 0, duration: 0.12, ease: 'sine.inOut' }, 1.50);
        tl.call(() => {
          // 挣扎扬尘 + 闷哼
          fxSmoke({ x: toW.x, y: CELL_H / 2 + 0.02, z: toW.z + 0.3 }, 0xa68b64, { count: 3, size: 0.15 });
          shakeCamera(0.4);
          if (window.FxSound) window.FxSound.impact();
        }, [], 1.00);
        tl.call(() => {
          eleMats.forEach(m => { if (m.emissive) m.emissiveIntensity = 0.45; });
        }, [], 1.30);
        tl.call(() => {
          eleMats.forEach(m => { if (m.emissive) m.emissiveIntensity = 0.12; });
        }, [], 1.55);

        // ---- 1.62 底座淡出（脱掉底座倒下才自然） ----
        tl.call(() => {
          const baseMesh = ele.children && ele.children[0];
          if (baseMesh && baseMesh.isMesh) {
            const mats = Array.isArray(baseMesh.material) ? baseMesh.material : [baseMesh.material];
            mats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.28 }));
          }
        }, [], 1.62);

        // ---- 1.78-2.12 后仰摔倒（四脚朝天）----
        // 挣扎时已后仰 -0.44，继续向后翻越竖直点 → 仰面倒地
        // y 同步抬高，让躺平的身体贴在棋盘面上而不是陷进去
        tl.to(ele.rotation, { x: -1.42, duration: 0.40, ease: 'power2.in' }, 1.78);
        tl.to(ele.position, { y: eleBaseY + 0.20, duration: 0.40, ease: 'power1.in' }, 1.78);
        tl.call(() => {
          // 落地：尘土大爆发 + 强震 + 闷响
          fxSmoke({ x: toW.x, y: CELL_H / 2 + 0.05, z: toW.z }, 0xa68b64, { count: 6, size: 0.2 });
          fxBurst({ x: toW.x, y: CELL_H / 2 + 0.06, z: toW.z }, 0x9a8a76, { count: 10, size: 0.05, dist: 0.7 });
          fxRing({ x: toW.x, y: CELL_H / 2 + 0.02, z: toW.z }, 0xffffff, { r1: 2.8, life: 0.5 });
          shakeCamera(1.0);
          if (window.FxSound) window.FxSound.impact();
        }, [], 2.16);
        tl.to(ele.position, { y: eleBaseY + 0.14, duration: 0.12, ease: 'power1.out' }, 2.18);

        // ---- 2.18 老鼠钻出 + 胜利 ----
        tl.call(() => {
          const tip = ele.localToWorld(new THREE.Vector3(0, 0.35, 0.28));
          if (rat) {
            rat.visible = true;
            rat.position.set(tip.x, tip.y + 0.05, tip.z);
            rat.scale.set(0.06, 0.06, 0.06);
            const rp = rat.position;
            window.gsap.to(rat.scale, { x: 1, y: 1, z: 1, duration: 0.24, ease: 'back.out(2)' });
            window.gsap.to(rp, { x: toW.x, z: toW.z, y: ratBaseY, duration: 0.3, ease: 'power1.out', delay: 0.08 });
            // 胜利摇摆
            window.gsap.to(rat.rotation, { y: rat.rotation.y + 0.55, duration: 0.16, yoyo: true, repeat: 3, delay: 0.4, ease: 'sine.inOut' });
            if (window.FxSound) window.FxSound.play('rat', 'burst');
          }
          fxBurst({ x: toW.x, y: CELL_H / 2 + 0.35, z: toW.z }, 0xffd76a, { count: 12, size: 0.045, dist: 0.55 });
          fxRing({ x: toW.x, y: CELL_H / 2 + 0.02, z: toW.z }, 0xffd76a, { r1: 2.0, life: 0.5 });
          // 怒气符号退场
          window.gsap.to(anger.material, { opacity: 0, duration: 0.25, onComplete: () => {
            ele.remove(anger);
            anger.material.map.dispose();
            anger.material.dispose();
          }});
        }, [], 2.18);

        // ---- 2.55 大象彻底淡出 + 攻方精确落位 ----
        tl.call(() => {
          eleMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.4 }));
        }, [], 2.55);
        tl.call(() => {
          ele.visible = false;
          if (rat && atkSlot) {
            window.gsap.killTweensOf(rat.position);
            rat.position.set(toW.x, ratBaseY, toW.z);
            rat.scale.set(1, 1, 1);
            rat.visible = true;
          }
        }, [], 2.95);
      });
    }

    /**
     * 加载棋子贴图（双路径）
     *
     * 优先用 AssetTexture（它已处理 canvas 光栅化、逐图尺寸、角标烧录）；
     * 若该模块不存在（加载顺序问题），退化为自建 canvas 光栅化。
     *
     * @param {Object} piece { type, owner }
     * @param {Object} faceMat 棋子正面材质
     */
    function loadPieceTexture(piece, faceMat) {
      const apply = (tex) => {
        if (!tex) return;
        // 材质可能已因切换模式被丢弃，dispose 前不要再改
        if (faceMat.__disposed) return;
        faceMat.map = tex;
        faceMat.color.set(0xffffff);   // 有贴图后恢复为白色，让贴图原色显示
        faceMat.needsUpdate = true;
      };

      if (window.AssetTexture && window.AssetTexture.get) {
        window.AssetTexture.get(piece.owner, piece.type.toLowerCase()).then(apply).catch(() => {});
        return;
      }
      // 兜底：自建光栅化（AssetTexture 不可用时的降级路径）
      rasterizeSelf(piece).then(apply).catch(() => {});
    }

    /**
     * 自建 SVG → CanvasTexture 的兜底光栅化
     *
     * 存在的原因：AssetTexture 是并行开发的独立模块，可能因加载顺序或
     * 资源缺失而不可用。没有它3D 棋子会全是占位色块，功能不可用。
     *
     * 复用了AssetTexture 的两个关键处理：
     *  1. 不走 TextureLoader（SVG 无 width/height → 黑块），而走 canvas
     *  2. 逐图按 viewBox 定canvas 尺寸（否则拉伸 13%）
     *
     * @param {Object} piece { type, owner }
     * @returns {Promise<THREE.CanvasTexture|null>}
     */
    async function rasterizeSelf(piece) {
      const THREE = await ensureThree();
      const table = window.PIECE_SVG_SIZE;
      const size = table && table[piece.owner] && table[piece.owner][piece.type.toLowerCase()];
      if (!size) return null;

      const SCALE = 3;   // 兜底路径显存敏感，用较低倍率
      const cw = Math.round(size.w * SCALE);
      const ch = Math.round(size.h * SCALE);

      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('SVG 加载失败'));
        i.src = `assets/images/${piece.owner}/${piece.type.toLowerCase()}.svg`;
      });

      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, 0, cw, ch);

      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer && renderer.capabilities
        ? renderer.capabilities.getMaxAnisotropy() : 1;
      tex.needsUpdate = true;
      return tex;
    }

    /**
     * 更新棋子的高亮表现（选中 / 可走 / 可吃）
     *
     * 3D 动物路径：选中 = 金色光环（selRing 移到该格）+ 上下浮动（loop 驱动），
     * 卡片降级路径：沿用「抬高 + 放大」的插值。
     *
     * @param {number} idx 槽位索引
     * @param {Object} piece
     */
    function updatePieceHighlight(idx, piece) {
      const slot = pieceSlots[idx];
      if (!slot || (!slot.root && !slot.cardFace)) return;
      const row = Math.floor(idx / Core.COLS);
      const col = idx % Core.COLS;
      const sel = (typeof currentState === 'object' && currentState)
        ? currentState : null;
      const isSelected = !!(sel && sel.selectedPiece &&
        sel.selectedPiece.row === row && sel.selectedPiece.col === col);

      if (isSelected) selSlotIdx = idx;
      else if (selSlotIdx === idx) selSlotIdx = -1;

      if (slot.root) {
        if (isSelected) {
          if (selRing) {
            selRing.visible = true;
            selRing.position.x = slot.root.position.x;
            selRing.position.z = slot.root.position.z;
          }
        }
        return;
      }

      // ---- 卡片降级路径：抬高 + 放大 ----
      const targetY = isSelected ? FACE_Y + 0.14 : FACE_Y;
      const targetScale = isSelected ? 1.1 : 1;
      slot.cardFace.position.y += (targetY - slot.cardFace.position.y) * 0.25;
      slot.cardFace.scale.setScalar(slot.cardFace.scale.x + (targetScale - slot.cardFace.scale.x) * 0.25);
      if (slot.cardSide) {
        const sideTarget = isSelected ? SIDE_CENTER_Y + 0.14 : SIDE_CENTER_Y;
        slot.cardSide.position.y += (sideTarget - slot.cardSide.position.y) * 0.25;
        slot.cardSide.scale.setScalar(slot.cardFace.scale.x);
      }
    }

    /** currentState / 选中槽位：render() 写入，供高亮与浮动动画读取 */
    let currentState = null;
    let selSlotIdx = -1;

    /* ============================================================
       契约方法实现
       ============================================================ */

    return {
      /**
       * 挂载 3D 渲染
       *
       * 契约要求同步语义，但 three 的动态 import 是异步的。
       * 处理方式：同步创建容器与占位，异步完成 three 加载与场景搭建。
       * 这样 mount 返回后 getCellScreenPos 立即可用（ready 前返回 null）。
       *
       * @param {HTMLElement} container 传入的容器（#board3d）
       */
      mount(container) {
        containerEl = container;
        if (!container) {
          console.error('[Renderer3D] mount 需要容器元素');
          return;
        }
        container.innerHTML = '';

        // 自己的 wrapper：便于整体移除，也避免污染容器
        wrapperEl = document.createElement('div');
        wrapperEl.className = 'render3d-canvas-wrap';
        wrapperEl.style.cssText = 'position:absolute;inset:0;';
        container.appendChild(wrapperEl);

        disposed = false;
        ready = false;
        failed = false;
        currentState = null;
        pieceSlots = [];
        prevKeys = [];
        movableCells = new Set();
        selSlotIdx = -1;

        // 异步初始化。失败时只标记 failed，不抛异常——
        // 让游戏保持可玩（游戏层有 activeRenderer 守卫，
        // 且此时 getCellScreenPos 返回 null，特效会回退到屏幕中心）
        ensureThree()
          .then(THREE => {
            if (disposed) return;   // 挂载期间已被卸载
            buildScene(THREE);
            rafId = requestAnimationFrame(loop);
            // 【关键】场景就绪后必须补一次渲染。
            // 原因：mount() 是同步返回的，而 buildScene 依赖异步的 three
            // 动态 import，所以调用方在 mount 之后立刻调用的 render() 会因为
            // ready 仍为 false 而被跳过 —— 那样棋子就永远不会被创建。
            // 这里用 pendingState 记住那次被跳过的状态，就绪后补上。
            if (pendingState) {
              const s = pendingState;
              pendingState = null;
              this.render(s);
            }
          })
          .catch(e => {
            failed = true;
            console.error('[Renderer3D] three.js 加载失败，3D 模式不可用:', e && e.message);
          });
      },

      /**
       * 卸载并释放全部 GPU 资源
       * 幂等：重复调用安全
       */
      unmount() {
        disposed = true;
        ready = false;
        currentState = null;
        pendingState = null;   // 丢弃未渲染的状态，避免下次 mount 后补出过期局面
        prevKeys = [];
        movableCells = new Set();
        selSlotIdx = -1;

        // 停循环
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

        // 解绑事件
        if (canvasEl && boundPointerHandler) {
          canvasEl.removeEventListener('pointerdown', boundPointerHandler);
          boundPointerHandler = null;
        }
        if (canvasEl && boundMoveHandler) {
          canvasEl.removeEventListener('pointermove', boundMoveHandler);
          boundMoveHandler = null;
        }
        // up / cancel 绑在 window 上，这里要成对解绑，否则切回 2D 后
        // 旧的 up 处理器仍会跑（虽然 disposed 守卫会挡住，但留着是泄漏）
        if (boundUpHandler) {
          window.removeEventListener('pointerup', boundUpHandler);
          window.removeEventListener('pointercancel', boundUpHandler);
          boundUpHandler = null;
        }
        // 相机复位：下次 mount 时相机是新对象，但保持语义干净
        camAzimuth = 0;
        camDist = 0;
        dragState = null;
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        }

        // 释放 geometry / material
        // ⚠️ 纹理是 AssetTexture 统一管理的共享资源，这里不销毁——
        //否则切回 2D 再进 3D 时所有纹理都要重新光栅化。
        for (let i = 0; i < pieceSlots.length; i++) {
          const slot = pieceSlots[i];
          if (slot && (slot.root || slot.cardFace || slot.cardSide)) {
            clearSlotMesh(slot);
            pieceSlots[i] = { root: null, cardFace: null, cardSide: null, key: null, pending: null, baseY: 0 };
          }
        }
        if (boardGroup) {
          boardGroup.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              // 格子材质是每格独立的，逐个释放（sprite 的 map 纹理一并释放）
              if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
              else {
                if (o.material.map && o.isSprite) o.material.map.dispose();
                o.material.dispose();
              }
            }
          });
        }
        if (selRing) {
          scene && scene.remove(selRing);
          selRing.geometry.dispose();
          selRing.material.dispose();
          selRing = null;
        }
        if (pickPlane) {
          pickPlane.geometry.dispose();
          pickPlane.material.dispose();
        }
        if (fxGroup) {
          while (fxGroup.children.length) {
            const o = fxGroup.children[0];
            fxGroup.remove(o);
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              if (o.material.map) o.material.map.dispose();
              o.material.dispose();
            }
          }
          scene && scene.remove(fxGroup);
          fxGroup = null;
        }
        if (renderer) {
          renderer.dispose();
          renderer.forceContextLoss && renderer.forceContextLoss();
          renderer = null;
        }

        // 清空引用
        scene = null; camera = null; pickPlane = null;
        boardGroup = null; cellMeshes = []; cellMaterials = [];
        riverMaterials = []; denMaterials = { red: null, blue: null };
        denSprites = {}; movableCells = new Set(); prevKeys = [];

        // 移除 DOM
        if (wrapperEl && wrapperEl.parentNode) {
          wrapperEl.parentNode.removeChild(wrapperEl);
        }
        wrapperEl = null; canvasEl = null; containerEl = null;
      },

      /**
       * 全量 sync
       * @param {Object} state gameState
       */
      render(state) {
        if (!state) return;
        // 场景还没就绪（three 仍在下载 / WebGL 未起来）→ 暂存这一次状态，
        // 等 buildScene 完成后补渲染。不这么做的话棋子会永远缺席。
        if (!ready || failed) { pendingState = state; return; }
        if (pendingState) pendingState = null;
        // 只存本次调用的引用用于高亮计算，不跨调用缓存棋局对象
        currentState = state;

        const THREE = window.THREE;

        // ---- 格子高亮态 ----
        movableCells = new Set();
        for (let row = 0; row < Core.ROWS; row++) {
          for (let col = 0; col < Core.COLS; col++) {
            const idx = row * Core.COLS + col;
            const mat = cellMaterials[idx];
            if (!mat) continue;

            const isSelected = state.selectedPiece &&
              state.selectedPiece.row === row && state.selectedPiece.col === col;
            const move = (state.validMoves || []).find(m => m.row === row && m.col === col);

            // 用 emissive 表达高亮：选中=金色，可走=浅金（呼吸），可吃=红
            let emissive = 0x000000;
            let intensity = 1;
            if (isSelected) { emissive = COLORS.moveRing; intensity = 0.55; }
            else if (move && move.capture) { emissive = COLORS.captureRing; intensity = 0.45; }
            else if (move) {
              emissive = COLORS.moveRing; intensity = 0.28;
              movableCells.add(idx);
              mat.__baseIntensity = 0.28;
            }

            mat.emissive.setHex(emissive);
            mat.emissiveIntensity = intensity;
          }
        }

        // ---- 选中光环显隐（浮动由 loop 驱动） ----
        if (selRing) {
          const sel = state.selectedPiece;
          if (sel && selSlotIdx >= 0 && pieceSlots[sel.row * Core.COLS + sel.col]?.root) {
            const w = cellWorld(sel.row, sel.col);
            selRing.visible = true;
            selRing.position.x = w.x;
            selRing.position.z = w.z;
          } else {
            selRing.visible = false;
            selSlotIdx = -1;
          }
        }

        // ---- 差分：与上一次局面比对，推断移动/吃子并触发 3D 原生动画 ----
        const newKeys = [];
        for (let row = 0; row < Core.ROWS; row++) {
          for (let col = 0; col < Core.COLS; col++) {
            const p = state.board[row][col];
            newKeys.push(p ? `${p.owner}/${p.type}` : null);
          }
        }
        const anims = diffBoard(prevKeys, newKeys);
        prevKeys = newKeys;

        // ---- 棋子 ----
        for (let row = 0; row < Core.ROWS; row++) {
          for (let col = 0; col < Core.COLS; col++) {
            setPiece(THREE, row * Core.COLS + col, state.board[row][col]);
          }
        }

        // 播放推断出的动画（在 setPiece 建好新棋子后起跳/爆发）
        if (anims && (anims.moves.length || anims.captures.length)) {
          playDiffs(anims);
        }
      },

      /**
       * 注册格子点击回调（Raycaster 拾取后触发）
       * @param {function(number,number): void} cb
       */
      onCellClick(cb) {
        cellClickCb = typeof cb === 'function' ? cb : null;
      },

      /**
       * 取得某格在视口 CSS 像素中的矩形
       *
       * 契约：语义等同 getBoundingClientRect()，即**轴对齐包围盒**。
       * 因为相机是斜视的，格子在屏幕上不是正方形，所以必须投影四个角取 min/max，
       * 不能用格边长直接换算——那样会丢掉透视缩短，FX 特效就会偏移。
       *
       * 实时计算，不缓存（相机会动、窗口会 resize）。
       */
      getCellScreenPos(row, col) {
        if (!ready || !camera || !containerEl) return null;
        const rect = containerEl.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return null;

        // 格子四角（世界坐标）。半边长与 buildBoard 里的格子几何体宽度保持一致
        // （CELL * 0.96 / 2），否则投影出来的框会比可见格子大一圈/小一圈，
        // 特效落点就会偏。
        const w = cellWorld(row, col);
        const h = CELL * 0.48;   // 半个格边长
        const y = 0;             // 棋盘平面高度
        const corners = [
          [w.x - h, y, w.z - h],
          [w.x + h, y, w.z - h],
          [w.x + h, y, w.z + h],
          [w.x - h, y, w.z + h]
        ];

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of corners) {
          worldToScreen(c[0], c[1], c[2], rect, tmpVec);
          if (tmpVec.x < minX) minX = tmpVec.x;
          if (tmpVec.x > maxX) maxX = tmpVec.x;
          if (tmpVec.y < minY) minY = tmpVec.y;
          if (tmpVec.y > maxY) maxY = tmpVec.y;
        }

        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        };
      },

      /**
       * 棋子资产描述（与 2D 渲染器同源，保证三方拿到同一份数据）
       * @param {Object} piece { type, owner }
       */
      getPieceAsset(piece) {
        if (!piece || !piece.type || !piece.owner) return null;
        const info = Core.PIECE_TYPES[piece.type];
        if (!info) return null;
        return {
          url: `assets/images/${piece.owner}/${info.image}`,
          level: info.level,
          name: info.name
        };
      },

      /**
       * 3D 原生攻击特效（渲染器扩展方法，非六方法契约）
       * FxBridge 在 3D 模式下调用，替代 2D 卡片覆盖层
       * @param {Object} eventInfo categorizeMove 的结果
       * @param {Object} ctx { fromRow, fromCol, toRow, toCol, attacker, defender }
       * @returns {Promise} 演出完成后 resolve
       */
      playAttack3D(eventInfo, ctx) {
        return playAttack3D(eventInfo, ctx);
      },

      /**
       * 调试钩子（不属于契约，仅供排查问题）
       *
       * scene / camera / pieceSlots 都是闭包私有的，外部拿不到。
       * 而「棋子为什么看不见」「贴图有没有真的贴上」这类问题必须能查到
       * mesh 的实际材质与位置，只能从内部暴露只读视图。
       * 不参与任何渲染逻辑。
       */
      __debug: {
        get scene() { return scene; },
        get camera() { return camera; },
        get pieceSlots() { return pieceSlots; },
        get renderer() { return renderer; },
        get ready() { return ready; },
        get failed() { return failed; },
        /** 当前相机方位角（弧度），0 = 正前方；用于验证拖动摆动 */
        get camAzimuth() { return camAzimuth; },
        /** 相机到棋盘中心的距离，用于验证视锥自适应 */
        get camDist() { return camDist; }
      }
    };
    })();
    // 记录最近实例，供排查（__debug 能看到 scene / pieceSlots 内部状态）
    lastInstance = instance;
    return instance;
  }

  const Renderer3D = {
    create: createRenderer3D,
    /**
     * 最近一次 create 出来的实例。
     * 供控制台/自动化排查使用（通过 instance.__debug 访问场景内部）。
     * 正常游戏流程不依赖它。
     */
    get last() { return lastInstance; }
  };

  window.Renderer3D = Renderer3D;

  // 注册到渲染器表（需先加载 renderer.js）
  if (window.Renderer) {
    window.Renderer.register(window.Renderer.MODE_3D, createRenderer3D);
  } else {
    console.error('Renderer3D: 依赖 window.Renderer，请先加载 js/render/renderer.js');
  }
})();
