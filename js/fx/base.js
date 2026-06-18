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
   * @param {HTMLElement} layer
   * @param {Object} theme - ANIMAL_THEMES[key]
   * @param {Number} count - 粒子数
   * @param {Number} radius - 散开半径
   * @param {Number} duration - 单粒动画时长
   */
  function radialBurst(layer, theme, count = 8, radius = 60, duration = 0.6) {
    const cx = layer.clientWidth / 2;
    const cy = layer.clientHeight / 2;
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
   - 不依赖棋盘 / 棋格布局，彻底避免被 renderBoard 销毁
   ============================================================ */
function playCaptureSceneAt(targetCellEl, opts) {
  const { gsap } = window;
  const { attackerAnimal, defenderAnimal, attackerColor = 'blue', defenderColor = 'red', scene, releaseFx, theme } = opts || {};

  // 取目标格屏幕中心（fallback 到屏幕中心）
  let cx = window.innerWidth / 2;
  let cy = window.innerHeight / 2;
  if (targetCellEl && targetCellEl.getBoundingClientRect) {
    const r = targetCellEl.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
  }

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

  // 攻方 SVG（强制 inline 尺寸，避免任何 CSS 失效）
  // 关键：left/top 设到棋格中心，配合 xPercent/yPercent:-50% 让元素中心对齐 (cx, cy)
  // （原来 left:0;top:0 + GSAP x:cx-halfW 会让元素左上角跑到 (cx-halfW, cy-halfH) ≈ 屏幕左上方，bug 根源）
  const attacker = document.createElement('img');
  attacker.className = 'fx-piece fx-piece-attacker';
  attacker.src = `assets/images/${attackerColor}/${attackerAnimal}.svg`;
  attacker.style.cssText = `position: fixed !important; left: ${cx}px; top: ${cy}px; width: 120px; height: 120px; object-fit: contain; pointer-events: none; opacity: 0; transform: translate(-50%, -50%); z-index: 10000; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4));`;
  layer.appendChild(attacker);

  // 守方 SVG
  const defender = document.createElement('img');
  defender.className = 'fx-piece fx-piece-defender';
  defender.src = `assets/images/${defenderColor}/${defenderAnimal}.svg`;
  defender.style.cssText = `position: fixed !important; left: ${cx}px; top: ${cy}px; width: 120px; height: 120px; object-fit: contain; pointer-events: none; opacity: 0; transform: translate(-50%, -50%); z-index: 10000; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4));`;
  layer.appendChild(defender);

  // 信息条
  const info = document.createElement('div');
  info.className = 'fx-info';
  info.innerHTML = `<span class="attacker">${attackerAnimal}</span> <span class="arrow">→</span> <span class="defender">${defenderAnimal}</span>`;
  layer.appendChild(info);

  // 2. 用 GSAP 直接定位到 (cx, cy) 屏幕坐标
  // 此时元素已经在 (cx, cy)，只需用 GSAP x/y 偏移动画
  const tl = gsap.timeline();

  // 方向规则：
  //   攻方是红方 → 攻方从**左侧**进入，守方从**右侧**进入
  //   攻方是蓝方 → 攻方从**右侧**进入，守方从**左侧**进入
  // （棋盘红方在下、 蓝方在上：红方在左下角，蓝方在右上角）
  const attackerFromLeft = attackerColor === 'red';
  const attackerStartX = attackerFromLeft ? -window.innerWidth / 2 - 90 : window.innerWidth / 2 + 90;
  const attackerStopX = attackerFromLeft ? -60 : 60;
  const defenderStartX = attackerFromLeft ? window.innerWidth / 2 + 90 : -window.innerWidth / 2 - 90;
  const defenderStopX = attackerFromLeft ? 60 : -60;

  // 阶段 1：攻方从屏幕一侧滑入 (cx, cy)
  // 元素中心已在 (cx, cy)，初始 x 设到屏幕外
  tl.set(attacker, {
    position: 'fixed',
    x: attackerStartX,
    y: 0,
    opacity: 1
  }, 0);
  tl.to(attacker, {
    x: attackerStopX,    // 停在目标格一侧外
    duration: 0.6, ease: 'power2.out'
  }, 0);

  // 阶段 2：守方从屏幕另一侧滑入
  tl.set(defender, {
    position: 'fixed',
    x: defenderStartX,
    y: 0,
    opacity: 1
  }, 0);
  tl.to(defender, {
    x: defenderStopX,     // 停在目标格另一侧外
    duration: 0.6, ease: 'power2.out'
  }, 0.15);

  // 阶段 3：攻方冲撞到目标格中心 + 闪白
  // attacker/defender 已经 center 在 (cx, cy)，所以 x:0,y:0 即冲撞到中心
  // 阶段 3：攻方冲撞到目标格中心（强化为：放大+倾斜+强光阴影 替代白色圆盘）
  // attacker/defender 已经 center 在 (cx, cy)，所以 x:0,y:0 即冲撞到中心
  // 用 filter:drop-shadow 红光制造"冲击"视觉，不再用白圆
  tl.to(attacker, {
    x: 0, y: 0,
    scale: 1.8,
    rotation: 20,
    filter: 'drop-shadow(0 0 30px rgba(255, 80, 60, 1)) drop-shadow(0 0 15px rgba(255, 200, 100, 0.9)) brightness(1.3)',
    duration: 0.15, ease: 'power2.in'
  }, 0.75);

  // 阶段 4：守方淡出（守方中心已经在 (cx, cy)，所以 x:0,y:0）
  tl.to(defender, {
    x: 0, y: 0,
    opacity: 0, scale: 0.2, rotation: 45,
    duration: 0.25, ease: 'power2.in'
  }, 0.75);

  // 阶段 5：攻方缩小让位（让元素从中心释放不被遮挡）
  // 0.95s 反弹到 scale 1 完成后，再快速缩小到 0.3，给元素让出中心
  tl.to(attacker, {
    scale: 1,
    rotation: 0,
    filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))',
    duration: 0.25, ease: 'back.out(2)'
  }, 0.95);

  // 0.95s → 1.05s：攻方快速缩小到 0.3（腾出中心给元素释放）
  tl.to(attacker, {
    scale: 0.3,
    opacity: 0.4,
    duration: 0.15, ease: 'power2.in'
  }, 1.2);

  // 阶段 6：元素释放（攻方已缩小，不再遮挡）
  tl.call(() => {
    if (typeof releaseFx === 'function') releaseFx(layer, theme || ANIMAL_THEMES[attackerAnimal]);
  }, [], 1.25);

  // 阶段 7：攻方在元素释放完成后重新淡入 + 恢复原始大小
  tl.to(attacker, {
    scale: 1,
    opacity: 1,
    duration: 0.3, ease: 'back.out(1.7)'
  }, 2.0);

  // 收尾清理（3.0s 后，确保元素全部消失）
  tl.call(() => {
    [attacker, defender, info].forEach(el => el && el.remove());
    layer.remove();
  }, [], 3.0);

  return tl;
}

// 向后兼容别名（fx-demo.html 仍可能引用旧名）
function playCaptureScene(opts) {
  return playCaptureSceneAt(document.getElementById('fxCell'), opts);
}

/* ============================================================
   移动特效：从 fromCell 滑向 toCell + 灰尘
   - 用于普通移动（非吃子）
   - 返回 Promise，动画结束后 resolve
   ============================================================ */
function playMoveFx(opts) {
  return new Promise((resolve) => {
    const { fromCellEl, toCellEl, animal = 'dog', color = 'blue' } = opts || {};
    if (!fromCellEl || !toCellEl) { resolve(); return; }

    const { gsap } = window;
    if (!gsap) { resolve(); return; }

    // 1. 克隆 fromCell 中的 img
    const fromImg = fromCellEl.querySelector('.piece img');
    if (!fromImg) { resolve(); return; }
    const ghost = fromImg.cloneNode();

    // 2. 计算位移
    const fromRect = fromCellEl.getBoundingClientRect();
    const toRect = toCellEl.getBoundingClientRect();
    const startX = fromRect.left + fromRect.width / 2;
    const startY = fromRect.top + fromRect.height / 2;
    const endX = toRect.left + toRect.width / 2;
    const endY = toRect.top + toRect.height / 2;
    // 3. ghost 位置：top/left 设到屏幕左上角，transform translate() 定位
    // GSAP 的 fromVars/toVars 都是绝对值，不读 inline left/top
    ghost.style.position = 'fixed';
    ghost.style.left = '0';
    ghost.style.top = '0';
    ghost.style.width = '60px';
    ghost.style.height = '60px';
    ghost.style.zIndex = '9999';
    ghost.style.pointerEvents = 'none';
    ghost.style.transformOrigin = '50% 50%';
    document.body.appendChild(ghost);

    // 4. 滑动 + 轻微弹跳：起点 (startX, startY)，终点 (endX, endY)
    gsap.fromTo(ghost, {
      x: startX - 30, y: startY - 30, scale: 0.5, rotation: 0, opacity: 0
    }, {
      duration: 0.32,
      x: endX - 30,
      y: endY - 30,
      scale: 1,
      rotation: 0,
      opacity: 1,
      ease: 'power1.inOut',
      onComplete: () => {
        // 短暂停留后消失
        gsap.to(ghost, { opacity: 0, scale: 0.6, duration: 0.12, ease: 'power1.in', onComplete: () => ghost.remove() });
      }
    });

    // 4. 灰尘粒子
    const theme = (window.ANIMAL_THEMES || {})[animal] || { color: '#aaa' };
    for (let i = 0; i < 5; i++) {
      const dust = document.createElement('div');
      dust.className = 'fx-move-dust';
      dust.style.background = theme.color;
      dust.style.position = 'fixed';
      dust.style.left = `${endX + 30}px`;
      dust.style.top = `${endY + 30}px`;
      dust.style.width = '6px';
      dust.style.height = '6px';
      dust.style.borderRadius = '50%';
      dust.style.pointerEvents = 'none';
      dust.style.zIndex = '9998';
      document.body.appendChild(dust);
      gsap.to(dust, {
        x: (Math.random() - 0.5) * 40,
        y: 20 + Math.random() * 20,
        opacity: 0,
        scale: 0,
        duration: 0.5,
        delay: 0.3 + i * 0.05,
        ease: 'power2.out',
        onComplete: () => dust.remove()
      });
    }

    // 5. 0.8s 后 resolve
    setTimeout(resolve, 800);
  });
}
