/* ============================================================
   FX 基础调度器
   - createFxLayer(stageCell): 创建 fx 层
   - addFxElement(layer, className, props): 添加临时元素
   - removeFxLayer(layer): 自动清理
   - 4 骨架工厂: burstBurst / streamRiver / sinkTrap / crownDen
   ============================================================ */

const FxBase = (function () {
  const { gsap } = window;

  /**
   * 创建 FX 层
   * @param {HTMLElement} cell
   * @returns {HTMLElement}
   */
  function createFxLayer(cell) {
    // 清理旧的
    const old = cell.querySelector('.fx-layer');
    if (old) old.remove();

    // 兜底：cell 尺寸为 0（如 grid 还没布局完成）→ 用 .board-frame 作为 host
    let host = cell;
    if (!host || host.clientWidth < 20 || host.clientHeight < 20) {
      const frame = document.querySelector('.board-frame') || document.body;
      // 先清掉旧的绝对定位 fx-layer
      const oldFrame = frame.querySelector('.fx-layer');
      if (oldFrame) oldFrame.remove();
      host = frame;
    }

    const layer = document.createElement('div');
    layer.className = 'fx-layer';
    host.appendChild(layer);
    return layer;
  }

  /**
   * 通用：N 颗粒子径向散开
   * 中心取层上注入的 --fx-cx/--fx-cy（目标格中心），全屏层时不再是屏幕中心
   */
  function radialBurst(layer, theme, count = 8, radius = 60, duration = 0.6) {
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    const els = [];
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'fx-particle';
      p.style.background = theme.color;
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.width = `${6 * theme.size}px`;
      p.style.height = `${6 * theme.size}px`;
      layer.appendChild(p);
      els.push(p);
    }
    gsap.to(els, {
      x: (i) => Math.cos((i / count) * Math.PI * 2) * radius,
      y: (i) => Math.sin((i / count) * Math.PI * 2) * radius,
      scale: 0,
      opacity: 0,
      duration: duration * theme.speed,
      ease: 'power2.out',
      stagger: 0.02,
      onComplete: () => els.forEach(e => e.remove())
    });
  }

  /**
   * 通用：白色闪屏
   */
  function flash(layer, duration = 0.2) {
    // 优先从 layer CSS 变量读取目标格中心（由 playCaptureSceneAt 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    const f = document.createElement('div');
    f.className = 'fx-flash';
    // 改为"金色冲击光环"：径向渐变（中心透明 + 边缘金色），不再遮挡卡片
    f.style.cssText = `
      position: fixed;
      left: ${cx}px;
      top: ${cy}px;
      right: auto;
      bottom: auto;
      width: 200px;
      height: 200px;
      margin-left: -100px;
      margin-top: -100px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255, 240, 180, 0) 0%, rgba(255, 200, 80, 0.55) 50%, rgba(255, 240, 180, 0) 75%);
      box-shadow: 0 0 32px 8px rgba(255, 200, 80, 0.6);
      pointer-events: none;
    `;
    layer.appendChild(f);
    gsap.fromTo(f, { opacity: 0.9, scale: 0.5 }, {
      opacity: 0,
      scale: 1.3,
      duration: duration,
      ease: 'power1.out',
      onComplete: () => f.remove()
    });
  }

  /**
   * 创建动物特征元素
   */
  function makeAnimalEl(theme) {
    const el = document.createElement('div');
    el.className = theme.elClass;
    if (theme.elClass === 'fx-paw') el.style.color = theme.color;
    return el;
  }

  /**
   * 骨架 1：Burst — 普通吃子
   * 闪白 + 径向散开粒子
   */
  function burstSkeleton(layer, theme) {
    flash(layer, 0.18);
    radialBurst(layer, theme, theme.particles, 70, 0.6);
  }

  /**
   * 骨架 2：Stream — 跳河吃子
   * 一根光柱从左到右穿过 + 涟漪
   */
  function streamSkeleton(layer, theme) {
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    // 光柱
    const light = document.createElement('div');
    light.className = 'fx-river-light';
    light.style.background = `linear-gradient(180deg, transparent 0%, ${theme.color} 50%, transparent 100%)`;
    light.style.color = theme.color;
    light.style.left = `-20px`;
    light.style.top = `${h/2 - 40}px`;
    layer.appendChild(light);
    gsap.fromTo(light,
      { x: 0, scaleY: 0.5, opacity: 0 },
      {
        x: w + 40, scaleY: 1, opacity: 1,
        duration: 0.4, ease: 'power2.in',
        onComplete: () => gsap.to(light, { scaleY: 0, opacity: 0, duration: 0.15, onComplete: () => light.remove() })
      }
    );
    // 涟漪（3 圈）
    for (let i = 0; i < 3; i++) {
      const r = document.createElement('div');
      r.className = 'fx-ripple';
      const size = 20 + i * 20;
      r.style.width = `${size}px`;
      r.style.height = `${size}px`;
      r.style.left = `${w/2 - size/2}px`;
      r.style.top = `${h/2 - size/2}px`;
      layer.appendChild(r);
      gsap.fromTo(r,
        { scale: 0, opacity: 0.8 },
        { scale: 2, opacity: 0, duration: 0.6, delay: 0.2 + i * 0.1, ease: 'power1.out', onComplete: () => r.remove() }
      );
    }
  }

  /**
   * 骨架 3：Sink — 陷阱吃子
   * 元素下沉 + 阴影收缩
   */
  function sinkSkeleton(layer, theme) {
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    const el = makeAnimalEl(theme);
    el.style.left = `${w/2}px`;
    el.style.top = `${h/2 - 10}px`;
    el.style.transform = 'translate(-50%, -50%)';
    layer.appendChild(el);
    gsap.to(el, {
      y: 30, opacity: 0, scale: 0.5, rotate: 15,
      duration: 0.6 * theme.speed, ease: 'power2.in',
      onComplete: () => el.remove()
    });
  }

  /**
   * 骨架 4：Crown — 攻入兽穴获胜
   * 4 道光束汇聚 + 大字弹出
   */
  function crownSkeleton(layer, theme) {
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    // 4 道光束
    const dirs = [
      { x: -w/2, y: -h/2 },
      { x:  w/2, y: -h/2 },
      { x: -w/2, y:  h/2 },
      { x:  w/2, y:  h/2 }
    ];
    dirs.forEach(d => {
      const beam = document.createElement('div');
      beam.style.width = '3px';
      beam.style.height = '40px';
      beam.style.background = `linear-gradient(to end, ${theme.color}, transparent)`;
      beam.style.left = `${w/2}px`;
      beam.style.top = `${h/2}px`;
      beam.style.transformOrigin = 'top center';
      layer.appendChild(beam);
      const angle = Math.atan2(d.y, d.x) * 180 / Math.PI;
      gsap.fromTo(beam,
        { x: 0, y: 0, scaleX: 0, rotate: angle, opacity: 0 },
        {
          x: d.x * 0.6, y: d.y * 0.6, scaleX: 1, opacity: 1,
          duration: 0.4, ease: 'power2.out', delay: 0.1,
          onComplete: () => gsap.to(beam, { opacity: 0, duration: 0.3, onComplete: () => beam.remove() })
        }
      );
    });
    // 大字
    const text = document.createElement('div');
    text.className = 'fx-victory-text';
    text.textContent = '胜';
    text.style.color = theme.color;
    layer.appendChild(text);
    gsap.fromTo(text,
      { scale: 0, rotation: -180, opacity: 0 },
      { scale: 1, rotation: 0, opacity: 1, duration: 0.5, delay: 0.2, ease: 'back.out(1.7)' }
    );
    // 自身收尾
    gsap.to(text, { scale: 0.5, opacity: 0, duration: 0.3, delay: 1.5, onComplete: () => text.remove() });
  }

  return {
    createFxLayer,
    burstSkeleton,
    streamSkeleton,
    sinkSkeleton,
    crownSkeleton,
    flash,
    radialBurst,
    makeAnimalEl,
    playCaptureSceneAt,
    playCaptureScene,
    playMoveFx
  };
})();

// 暴露到全局
window.FxBase = FxBase;

/* ============================================================
   通用吃子场景：5 阶段（参数化目标格）
   - 特效层始终挂到 <body>，使用 position: fixed 定位到目标格中心
   - 不依赖棋盘 /棋格布局，彻底避免被 renderBoard 销毁

   【渲染无关约定】targetPos 为"视口坐标矩形"，结构与
   Element.getBoundingClientRect() 的返回值完全一致：
     { x, y, width, height }  全部为 viewport CSS 像素
   FX 层只认这4 个数字，不持有任何棋格 DOM 引用。
   2D 渲染器由棋格元素实测getBoundingClientRect() 传入；
   未来 3D 渲染器可直接由相机投影算出同一套视口坐标，
   两边共用同一份 FX 逻辑，无需改动本文件。
   ============================================================ */
function playCaptureSceneAt(targetPos, opts) {
  const { gsap } = window;
  const { attackerAnimal, defenderAnimal, attackerColor = 'blue', defenderColor = 'red', scene, releaseFx, theme } = opts || {};

  // 取目标格屏幕中心（fallback 到屏幕中心）
  // 用视口坐标对象替代 DOM 元素：本函数不再触碰任何棋格节点，
  // 特效锚点纯粹由外部传入的坐标决定，渲染器可以自由切换 2D/3D。
  const cx = targetPos ? targetPos.x + targetPos.width / 2 : window.innerWidth / 2;
  const cy = targetPos ? targetPos.y + targetPos.height / 2 : window.innerHeight / 2;

  // 1. 直接在 body 顶层创建 fixed 定位的特效层
  const old = document.querySelector('body > .fx-layer');
  if (old) old.remove();

  const layer = document.createElement('div');
  layer.className = 'fx-layer fx-layer-fixed';
  layer.style.cssText = `
    position: fixed;
    left: 0; top: 0;
    width: 100vw; height: 100vh;
    pointer-events: none;
    z-index: 9999;
    overflow: visible;
  `;
  // 把目标格中心写到 CSS 变量，供 list.js 释放函数读取
  layer.style.setProperty('--fx-cx', cx + 'px');
  layer.style.setProperty('--fx-cy', cy + 'px');
  document.body.appendChild(layer);

  // 攻守方棋子尺寸：按动物主题 size 分级（象大、鼠猫小），克制屏幕占用
  const theme_ = theme || ANIMAL_THEMES[attackerAnimal] || {};
  const atkW = Math.round(Math.max(84, Math.min(140, 104 * (theme_.size || 1))));
  const defW = Math.round(atkW * 0.92);

  // 攻方 SVG（inline 尺寸，中心对齐 (cx, cy)）
  const attacker = document.createElement('img');
  attacker.className = 'fx-piece fx-piece-attacker';
  attacker.src = `assets/images/${attackerColor}/${attackerAnimal}.svg`;
  attacker.style.cssText = `position: fixed !important; left: ${cx}px; top: ${cy}px; width: ${atkW}px; height: ${atkW}px; object-fit: contain; pointer-events: none; opacity: 0; transform: translate(-50%, -50%); z-index: 10000; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4));`;
  layer.appendChild(attacker);

  // 守方 SVG
  const defender = document.createElement('img');
  defender.className = 'fx-piece fx-piece-defender';
  defender.src = `assets/images/${defenderColor}/${defenderAnimal}.svg`;
  defender.style.cssText = `position: fixed !important; left: ${cx}px; top: ${cy}px; width: ${defW}px; height: ${defW}px; object-fit: contain; pointer-events: none; opacity: 0; transform: translate(-50%, -50%); z-index: 10000; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4));`;
  layer.appendChild(defender);

  // 信息条（中文动物名，锚定目标格下方）
  const nameOf = (k) => (window.ANIMAL_THEMES && window.ANIMAL_THEMES[k] && window.ANIMAL_THEMES[k].name) || k;
  const info = document.createElement('div');
  info.className = 'fx-info';
  info.innerHTML = `<span class="attacker">${nameOf(attackerAnimal)}</span> <span class="arrow">→</span> <span class="defender">${nameOf(defenderAnimal)}</span>`;
  layer.appendChild(info);

  // 2. 用 GSAP 直接定位到 (cx, cy) 屏幕坐标
  const tl = gsap.timeline();

  // 方向规则：攻方红 → 从左入，攻方蓝 → 从右入
  // 滑入距离收紧到 ~200px（原半屏宽度太散，前 0.6s 观感空洞）
  const attackerFromLeft = attackerColor === 'red';
  const attackerStartX = attackerFromLeft ? -220 : 220;
  const attackerStopX = attackerFromLeft ? -52 : 52;
  const defenderStartX = attackerFromLeft ? 200 : -200;
  const defenderStopX = attackerFromLeft ? 52 : -52;

  // 阶段 1：攻方滑入
  tl.set(attacker, {
    position: 'fixed',
    x: attackerStartX,
    y: 0,
    opacity: 1
  }, 0);
  tl.to(attacker, {
    x: attackerStopX,
    duration: 0.45, ease: 'power2.out'
  }, 0);

  // 阶段 2：守方滑入
  tl.set(defender, {
    position: 'fixed',
    x: defenderStartX,
    y: 0,
    opacity: 1
  }, 0);
  tl.to(defender, {
    x: defenderStopX,
    duration: 0.45, ease: 'power2.out'
  }, 0.1);

  // 阶段 3：攻方冲撞到目标格中心（放大+倾斜+红光冲击）
  tl.to(attacker, {
    x: 0, y: 0,
    scale: 1.65,
    rotation: 16,
    filter: 'drop-shadow(0 0 26px rgba(255, 80, 60, 0.95)) drop-shadow(0 0 12px rgba(255, 200, 100, 0.9)) brightness(1.25)',
    duration: 0.14, ease: 'power2.in'
  }, 0.56);

  // 打击瞬间通用反馈：冲击波 + 火花 + 震屏 + 撞击音（CanvasVfx 参考游戏 Juice 惯例）
  tl.call(() => {
    const theme_ = theme || ANIMAL_THEMES[attackerAnimal] || {};
    if (window.CanvasVfx) {
      window.CanvasVfx.impact(cx, cy, { color: theme_.color || '#ffd76a' });
    }
    if (window.FxSound && typeof window.FxSound.impact === 'function') {
      window.FxSound.impact();
    }
  }, [], 0.56);

  // 阶段 4：守方被击溃淡出
  tl.to(defender, {
    x: 0, y: 0,
    opacity: 0, scale: 0.2, rotation: 45,
    duration: 0.22, ease: 'power2.in'
  }, 0.56);

  // 阶段 5：攻方反弹回位
  tl.to(attacker, {
    scale: 1,
    rotation: 0,
    filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))',
    duration: 0.2, ease: 'back.out(2)'
  }, 0.74);

  // 0.94s：攻方缩小让位（给元素释放腾出中心）
  tl.to(attacker, {
    scale: 0.3,
    opacity: 0.4,
    duration: 0.14, ease: 'power2.in'
  }, 0.94);

  // 阶段 6：元素释放
  tl.call(() => {
    if (typeof releaseFx === 'function') releaseFx(layer, theme_ || ANIMAL_THEMES[attackerAnimal]);
  }, [], 1.04);

  // 阶段 7：攻方淡入回位
  tl.to(attacker, {
    scale: 1,
    opacity: 1,
    duration: 0.28, ease: 'back.out(1.7)'
  }, 1.5);

  // 收尾清理（释放元素寿命最长 ~1.5s，2.55s 时全部结束）
  tl.call(() => {
    [attacker, defender, info].forEach(el => el && el.remove());
    layer.remove();
  }, [], 2.55);

  return tl;
}

// 向后兼容别名：旧调用点（无坐标信息）退化为屏幕中心锚点
function playCaptureScene(opts) {
  return playCaptureSceneAt(null, opts);
}

/* ============================================================
   移动特效：从起点滑向终点 + 灰尘
   - 用于普通移动（非吃子）
   - 返回 Promise，动画结束后 resolve

   【渲染无关约定】
   - fromPos / toPos：视口坐标矩形 { x, y, width, height }（viewport CSS 像素），
     语义与 getBoundingClientRect() 返回值一致，详见 playCaptureSceneAt 上方说明
   - asset：可选资产描述 { url, level, name }。传入则优先用其 url，
     用于让 2D / 3D 渲染器共用同一份资产解析结果；缺省时按 color/animal 兜底拼 URL
   ============================================================ */
function playMoveFx(opts) {
  return new Promise((resolve) => {
    const { fromPos, toPos, animal = 'dog', color = 'blue', asset = null } = opts || {};
    if (!fromPos || !toPos) { resolve(); return; }

    const { gsap } = window;
    if (!gsap) { resolve(); return; }

    // 1. 自建ghost img（原先是克隆棋格内的 .piece img）
    // 改为自建的原因：本函数只需要棋子图片，而 animal + color 已在参数里，
    // 无需依赖棋盘 DOM 结构；自建也顺带避免了克隆带来的样式/层级副作用。
    const ghost = document.createElement('img');
    ghost.src = (asset && asset.url) ? asset.url : `assets/images/${color}/${animal}.svg`;
    ghost.alt = (asset && asset.name) || animal;

    // 2. 计算位移（全部基于视口坐标，不读DOM）
    const startX = fromPos.x + fromPos.width / 2;
    const startY = fromPos.y + fromPos.height / 2;
    const endX = toPos.x + toPos.width / 2;
    const endY = toPos.y + toPos.height / 2;
    // ghost 尺寸跟随落点格（原写死 60px，棋盘格子 ~90px 时明显偏小）
    const gsize = Math.round(Math.min(toPos.width, toPos.height) * 0.8);
    const half = gsize / 2;
    // 3. ghost 位置：top/left 设到屏幕左上角，transform translate() 定位
    ghost.style.position = 'fixed';
    ghost.style.left = '0';
    ghost.style.top = '0';
    ghost.style.width = `${gsize}px`;
    ghost.style.height = `${gsize}px`;
    ghost.style.zIndex = '9999';
    ghost.style.pointerEvents = 'none';
    ghost.style.transformOrigin = '50% 50%';
    document.body.appendChild(ghost);

    // 4. 滑动：起点 (startX, startY)，终点 (endX, endY)
    gsap.fromTo(ghost, {
      x: startX - half, y: startY - half, scale: 0.6, rotation: 0, opacity: 0
    }, {
      duration: 0.3,
      x: endX - half,
      y: endY - half,
      scale: 1,
      rotation: 0,
      opacity: 1,
      ease: 'power1.inOut',
      onComplete: () => {
        // 短暂停留后消失
        gsap.to(ghost, { opacity: 0, scale: 0.6, duration: 0.12, ease: 'power1.in', onComplete: () => ghost.remove() });
      }
    });

    // 5. 灰尘粒子：在落点格内散开
    const theme = (window.ANIMAL_THEMES || {})[animal] || { color: '#aaa' };
    for (let i = 0; i < 6; i++) {
      const dust = document.createElement('div');
      dust.className = 'fx-move-dust';
      dust.style.background = theme.color;
      dust.style.position = 'fixed';
      dust.style.left = `${endX + (Math.random() - 0.5) * toPos.width * 0.5}px`;
      dust.style.top = `${endY + toPos.height * 0.28}px`;
      dust.style.width = '6px';
      dust.style.height = '6px';
      dust.style.borderRadius = '50%';
      dust.style.pointerEvents = 'none';
      dust.style.zIndex = '9998';
      document.body.appendChild(dust);
      gsap.to(dust, {
        x: (Math.random() - 0.5) * 36,
        y: 10 + Math.random() * 14,
        opacity: 0,
        scale: 0,
        duration: 0.5,
        delay: 0.26 + i * 0.05,
        ease: 'power2.out',
        onComplete: () => dust.remove()
      });
    }

    // 6. 0.7s 后 resolve（滑动 0.3 + 停留消散）
    setTimeout(resolve, 700);
  });
}
