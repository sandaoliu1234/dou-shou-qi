/* ============================================================
   AssetTexture：棋子 SVG → Three.js 纹理
   ------------------------------------------------------------
   为什么需要这个模块：
   项目里的 16 张棋子 SVG（assets/images/{blue,red}/*.svg）**根标签上没有
   width/height 属性**，只有 viewBox。这带来两个问题：

   1) THREE.TextureLoader 直接加载 SVG 不可靠
      2025 年起，无显式 width/height 的 SVG 在 WebGL 里会渲染成全黑块。
      虽然实测 Chrome 的 img.naturalWidth 会按 viewBox 比例算出内在尺寸
      （tiger = 111×150），Firefox 下仍可能返回 0。
      → 所以走「canvas 光栅化 → CanvasTexture」这条路，行为可控且跨浏览器一致。

   2) 必须逐图定尺寸，不能用统一值
      16 张图的 viewBox 宽高比跨度 0.701 ~ 0.792（±6.5%）。
      若统一按某一个 viewBox 计算 canvas 尺寸，最扁的会被纵向拉伸 13%。
      → 尺寸表来自 piece-svg-size.js（实测数据），本模块只读取，不重复定义。

   角标烧录：
   2D 模式下棋子右下角有个.level-badge 数字角标（DOM 元素）。
   3D 里没有 DOM，但「等级」是棋子 type 的函数，16 张图已按 type 唯一化，
   所以直接把角标画进 canvas 是无损且最干净的做法——
   比在 3D 里再叠一个 sprite 或重建一套数字几何体都简单。

   显存权衡：
   RASTER_SCALE=4 时，16 张纹理约占 16 × (496×672×4B) ≈ 20MB。
   降到 3 约 11MB。本项目 3D 模式只在切换时启用，且格子尺寸不大，
   4 倍率的清晰度收益值得这个显存。
   ============================================================ */
window.AssetTexture = (function () {
  /** 光栅化倍率：viewBox 尺寸 × 此值 = canvas 像素尺寸 */
  const RASTER_SCALE = 4;

  /** 16 张图的 viewBox 实测尺寸表（由 piece-svg-size.js 提供） */
  const SIZE_TABLE = () => window.PIECE_SVG_SIZE || null;

  /** 逻辑层的等级数据，用于烧录角标 */
  const pieceTypes = () => (window.GameCore || {}).PIECE_TYPES || null;

  /** 缓存：key = `${owner}/${animal}`，value = Promise<THREE.CanvasTexture> */
  const texCache = new Map();
  /** 已创建纹理的引用，供 dispose 遍历 */
  const created = new Set();
  /** 当前 WebGLRenderer，用于取 maxAnisotropy（斜视时贴图才清晰） */
  let currentRenderer = null;

  /**
   * 加载 three.js 并挂到全局
   *
   * 为什么用动态 import 而不是在 <script> 里静态引入：
   * three.module.js 有 648KB（加上它依赖的 three.core.js 1.4MB，共约 2MB）。
   * 2D 用户不该为用不到的 3D 能力付费。动态 import 让它只在用户点「3D」时下载。
   *
   * 为什么不用 import map / three/addons：
   * three.module.js 用相对路径 import './three.core.js'，浏览器可正常解析，
   * 不需要 import map。而 addons（如 OrbitControls）需要裸标识符 'three'，
   * 才必须配 import map——本项目用不到 addons。
   *
   * @returns {Promise<Object>} THREE 命名空间
   */
  async function ensureThree() {
    if (window.THREE) return window.THREE;
    const mod = await import('/node_modules/three/build/three.module.js');
    window.THREE = mod;
    return mod;
  }

  /**
   * 注册当前 WebGLRenderer
   *
   * 必须在渲染器创建后调用，否则拿不到 maxAnisotropy。
   * 未注册时用默认各向异性 1，功能正常只是斜视时略微模糊。
   *
   * @param {Object|null} renderer THREE.WebGLRenderer
   */
  function setRenderer(renderer) {
    currentRenderer = renderer;
    // 已缓存的纹理需要补设 anisotropy（因为注册晚于部分纹理的创建）
    created.forEach(tex => {
      if (renderer && renderer.capabilities) {
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;
      }
    });
  }

  /**
   * 绘制等级角标到 canvas
   *
   * 视觉对齐 2D 的 .level-badge：右下角一个小圆底 + 白字数字。
   * 所有尺寸都按 RASTER_SCALE 线性缩放，因为 canvas 是放大后的高分辨率画布。
   *
   * @param {CanvasRenderingContext2D} ctx canvas 2D 上下文
   * @param {number} w canvas 宽（像素）
   * @param {number} h canvas 高（像素）
   * @param {number|string} level 等级（PIECE_TYPES 里是数字，这里统一当字符串画）
   * @param {string} owner 阵营，决定角标配色（红方/蓝方）
   */
  function drawLevelBadge(ctx, w, h, level, owner) {
    if (level === undefined || level === null || level === '') return;

    // ---- 尺寸基准：按 canvas 宽度比例，保证不同 viewBox 下视觉大小一致 ----
    const R = w * 0.19;              // 圆半径
    const cx = w - R * 1.05;         // 圆心 x（右下角）
    const cy = h - R * 1.05;         // 圆心 y
    const fontPx = R * 1.25;         // 字号

    // ---- 圆底 ----
    // 配色跟随阵营：红方用红系、蓝方用蓝系，与 2D 的 owner 语义一致
    const base = owner === 'red' ? [178, 59, 46] : [47, 93, 138];
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.92)`;
    ctx.fill();

    // 外描边：浅色，让角标在深色棋子图上也能看清
    ctx.lineWidth = Math.max(1, R * 0.12);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();

    // ---- 数字 ----
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${fontPx}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 垂直方向微调：Canvas 的 textBaseline='middle' 对数字略偏上，往下压一点
    ctx.fillText(String(level), cx, cy + fontPx * 0.06);
  }

  /**
   * 单张 SVG → CanvasTexture（核心）
   *
   * 流程：new Image() 加载 SVG → drawImage 到按 viewBox×倍率 计算的 canvas
   *      → 烧录角标 → new THREE.CanvasTexture(canvas)
   *
   * @param {string} owner 'blue' | 'red'
   * @param {string} animal 动物 key，如 'tiger'
   * @returns {Promise<THREE.CanvasTexture|null>} 失败返回 null（调用方需降级）
   */
  async function buildTexture(owner, animal) {
    const table = SIZE_TABLE();
    const types = pieceTypes();
    if (!table) {
      console.warn('[AssetTexture] 缺少 window.PIECE_SVG_SIZE（piece-svg-size.js 未加载？）');
      return null;
    }
    const size = table[owner] && table[owner][animal];
    if (!size) {
      console.warn(`[AssetTexture] 尺寸表里没有 ${owner}/${animal}`);
      return null;
    }

    const THREE = await ensureThree();

    // ---- canvas 尺寸：逐图按 viewBox 算，不能用统一值 ----
    const cw = Math.round(size.w * RASTER_SCALE);
    const ch = Math.round(size.h * RASTER_SCALE);

    // ---- 加载 SVG ----
    const url = `assets/images/${owner}/${animal}.svg`;
    let img;
    try {
      img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('SVG 加载失败: ' + url));
        im.src = url;
      });
    } catch (e) {
      console.warn('[AssetTexture] 加载失败:', e.message);
      return null;
    }

    // ---- 光栅化 ----
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const ctx = cv.getContext('2d');
    // 显式给 drawImage 宽高：这一步是让无 width 属性的 SVG 正确铺满的关键
    ctx.drawImage(img, 0, 0, cw, ch);

    // ---- 烧录等级角标 ----
    // level 是棋子 type 的函数；但 buildTexture 只知道 animal（小写英文），
    // 而 PIECE_TYPES 的键是大写英文（如 'TIGER'），所以用大写形式去查
    const typeKey = String(animal).toUpperCase();
    const info = types ? types[typeKey] : null;
    if (info) drawLevelBadge(ctx, cw, ch, info.level, owner);

    // ---- 包装成纹理 ----
    const tex = new THREE.CanvasTexture(cv);
    // r152+ 必须显式设色彩空间，否则颜色发灰
    tex.colorSpace = THREE.SRGBColorSpace;
    // 各向异性：斜视 18° 时贴图才不糊
    if (currentRenderer && currentRenderer.capabilities) {
      tex.anisotropy = currentRenderer.capabilities.getMaxAnisotropy();
    }
    // 高质量缩放：格子在屏幕上会被缩放采样，双线性 + mipmap 减少闪烁
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;

    created.add(tex);
    return tex;
  }

  /**
   * 取得（或创建并缓存）某张棋子的纹理
   *
   * 同一张图只光栅化一次，重复调用返回同一个 Promise。
   * ⚠️ 首次调用会触发 three.js 的动态下载（约 2MB，未压缩）。
   *
   * @param {string} owner 'blue' | 'red'
   * @param {string} animal 动物 key
   * @returns {Promise<THREE.CanvasTexture|null>}
   */
  function get(owner, animal) {
    const key = `${owner}/${animal}`;
    if (texCache.has(key)) return texCache.get(key);

    // 先把 Promise 存进缓存，避免并发调用时重复光栅化
    const p = buildTexture(owner, animal).catch(e => {
      console.warn('[AssetTexture] 构建失败:', e);
      return null;
    });
    texCache.set(key, p);
    return p;
  }

  /**
   * 预热一批纹理，避免首次进入 3D 时卡顿
   * @param {Array<{owner:string,animal:string}>} list 要预热的清单
   * @param {Function} [onProgress] 进度回调 (done, total)
   * @returns {Promise<void>}
   */
  async function prewarm(list, onProgress) {
    const items = list || [];
    let done = 0;
    for (const it of items) {
      await get(it.owner, it.animal);
      done++;
      if (typeof onProgress === 'function') onProgress(done, items.length);
    }
  }

  /**
   * 释放所有纹理与缓存
   * ⚠️ 纹理是跨 2D/3D 共享的资产，只应在应用退出时调用，
   *    不要在渲染器 unmount 里调用（那会导致切回 2D 后再进 3D 纹理全丢）。
   */
  function dispose() {
    created.forEach(tex => {
      try { tex.dispose(); } catch (e) { /* 已被释放则忽略 */ }
    });
    created.clear();
    texCache.clear();
  }

  return {
    get,
    prewarm,
    dispose,
    setRenderer,
    ensureThree,
    RASTER_SCALE
  };
})();
