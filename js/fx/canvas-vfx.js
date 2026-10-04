/* ============================================================
   CanvasVfx · Canvas 2D 高级粒子特效引擎（零依赖）
   参考：
   - drawcall/Proton 的 Emitter+Behaviour 架构（Gravity/Alpha/Scale/RandomDrift）
   - pensacola1989/canvas-confetti 的物理模型（gravity/decay/drift/scalar）
   - pixijs/pixi-particles 的发射器配置模型（speed/spread/life 曲线）
   - 游戏 Juice 惯例：打击瞬间 屏幕震动 + 冲击波 + 加色混合火花

   单一全屏 canvas（fixed），加色混合(lighter)渲染发光粒子，
   空闲时自动移除。坐标一律用 CSS 像素（内部处理 DPR）。
   ============================================================ */
window.CanvasVfx = (function () {
  const hasGsap = () => typeof window.gsap !== 'undefined';

  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let particles = [];   // 运行中的粒子
  let emitters = [];    // 持续发射器（喷泉/烟）
  let rafId = null;
  let lastT = 0;

  /* ---------- 画布生命周期 ---------- */

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10050;';
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    document.body.appendChild(canvas);
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function startLoop() {
    if (rafId) return;
    lastT = performance.now();
    const tick = (t) => {
      const dt = Math.min((t - lastT) / 1000, 0.05); // 秒，防卡顿跳帧
      lastT = t;
      step(dt);
      if (particles.length === 0 && emitters.length === 0) {
        stopLoop();
        if (canvas) { canvas.remove(); canvas = null; ctx = null; }
        window.removeEventListener('resize', resize);
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function step(dt) {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // 持续发射器
    for (let i = emitters.length - 1; i >= 0; i--) {
      const em = emitters[i];
      em.t += dt;
      while (em.t >= em.next) {
        em.t -= em.next;
        em.next = em.interval * (0.7 + Math.random() * 0.6);
        em.spawn();
      }
      if (em.t > em.duration) emitters.splice(i, 1);
    }

    // 粒子更新：重力 / 阻尼 / 随机漂移 / 旋转 / 寿命
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      if (p.smokeT !== undefined) { p.smokeT += dt; }
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += p.g * dt;
      p.vx += (Math.random() - 0.5) * p.drift * dt;
      p.vy += (Math.random() - 0.5) * p.drift * dt;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.rot += p.vr * dt;
    }

    // 渲染：先普通合成（烟），再加色混合（发光）
    for (const p of particles) if (p.shape === 'smoke') drawSmoke(p);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) if (p.shape !== 'smoke') drawGlow(p);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- 绘制各形状 ---------- */

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  function drawGlow(p) {
    const lifeR = p.life / p.maxLife;                    // 1 → 0
    const alpha = p.fadeIn ? Math.min(1, (1 - lifeR) * 6) * Math.pow(lifeR, 0.6) : Math.pow(lifeR, 0.8);
    if (alpha <= 0.01) return;
    const col = Array.isArray(p.color) ? p.color[Math.min(p.color.length - 1, Math.floor((1 - lifeR) * p.color.length))] : p.color;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);

    if (p.shape === 'spark' || p.shape === 'streak') {
      // 沿速度方向的火花线
      const ang = Math.atan2(p.vy, p.vx);
      const sp = Math.hypot(p.vx, p.vy);
      const len = (p.shape === 'streak' ? p.size * 2.2 : p.size) * (0.5 + sp / 14);
      ctx.rotate(ang);
      const grad = ctx.createLinearGradient(-len, 0, len, 0);
      grad.addColorStop(0, rgba(col, 0));
      grad.addColorStop(0.5, rgba(col, alpha));
      grad.addColorStop(1, rgba('#ffffff', alpha * 0.9));
      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, p.size * 0.28 * lifeR);
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len * 0.4, 0);
      ctx.stroke();
    } else if (p.shape === 'ring') {
      // 冲击波环：半径外扩、线宽收窄
      const r = p.r0 + (p.r1 - p.r0) * (1 - lifeR);
      const ease = 1 - Math.pow(1 - (1 - lifeR), 3);
      const rr = p.r0 + (p.r1 - p.r0) * ease;
      ctx.strokeStyle = rgba(col, alpha * 0.9);
      ctx.lineWidth = Math.max(0.5, p.width * lifeR);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
      // 内侧白圈增强亮度
      ctx.strokeStyle = rgba('#ffffff', alpha * 0.5);
      ctx.lineWidth = Math.max(0.5, p.width * lifeR * 0.4);
      ctx.beginPath();
      ctx.arc(0, 0, rr * 0.96, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.shape === 'slash') {
      // 新月斩击弧：宽弧快速掠过、线宽收窄
      const sweep = p.sweep * (1 - lifeR);
      ctx.strokeStyle = rgba(col, alpha);
      ctx.lineCap = 'round';
      ctx.lineWidth = p.width * Math.pow(lifeR, 0.7);
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, -p.arc / 2 + sweep, p.arc / 2 + sweep);
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', alpha * 0.85);
      ctx.lineWidth = Math.max(0.5, p.width * Math.pow(lifeR, 0.7) * 0.35);
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, -p.arc / 2 + sweep, p.arc / 2 + sweep);
      ctx.stroke();
    } else if (p.shape === 'bolt') {
      // 闪电折线
      ctx.strokeStyle = rgba(col, alpha);
      ctx.lineWidth = p.width * lifeR;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const pts = p.pts;
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', alpha * 0.6);
      ctx.lineWidth = Math.max(0.5, p.width * lifeR * 0.35);
      ctx.stroke();
    } else if (p.shape === 'shard') {
      // 碎片三角
      ctx.fillStyle = rgba(col, alpha);
      ctx.strokeStyle = rgba('#ffffff', alpha * 0.5);
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.lineTo(p.size * 0.7, p.size * 0.6);
      ctx.lineTo(-p.size * 0.7, p.size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else { // 'circle'
      const r = p.size * (p.grow ? (2 - lifeR) : lifeR);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(0.5, r));
      grad.addColorStop(0, rgba('#ffffff', alpha * 0.9));
      grad.addColorStop(0.35, rgba(col, alpha));
      grad.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSmoke(p) {
    const lifeR = p.life / p.maxLife;
    const t = p.smokeT || 0;
    const r = p.size * (1 + t * 1.8);
    const alpha = Math.pow(lifeR, 1.5) * 0.28;
    const grad = ctx.createRadialGradient(p.x, p.y - t * 26, 0, p.x, p.y - t * 26, Math.max(1, r));
    grad.addColorStop(0, rgba(p.color, alpha));
    grad.addColorStop(1, rgba(p.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y - t * 26, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------- 粒子工厂 ---------- */

  function add(props) {
    ensureCanvas();
    particles.push(Object.assign({
      x: 0, y: 0, vx: 0, vy: 0,
      g: 0, drag: 0.94, drift: 0,
      size: 6, rot: 0, vr: 0,
      life: 0.6, maxLife: 0.6,
      shape: 'circle', color: '#ffd76a',
      fadeIn: false
    }, props, { maxLife: props.life || 0.6 }));
    startLoop();
  }

  function emitter(props) {
    ensureCanvas();
    emitters.push(Object.assign({ t: 0, next: 0, interval: 0.03, duration: 0.3, spawn: () => {} }, props));
    startLoop();
  }

  /* ---------- 公共 API ---------- */

  /** 径向火花爆发 */
  function burst(x, y, o = {}) {
    const n = o.count || 16;
    const spread = o.spread != null ? o.spread : Math.PI * 2;
    const base = o.angle != null ? o.angle : -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const a = base + (spread === Math.PI * 2 ? (i / n) * Math.PI * 2 : (Math.random() - 0.5) * spread);
      const sp = (o.speed || 7) * (0.4 + Math.random() * 0.9);
      add({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: o.gravity != null ? o.gravity : 0.18,
        drag: o.drag || 0.92,
        size: (o.size || 7) * (0.6 + Math.random() * 0.8),
        life: (o.life || 0.55) * (0.7 + Math.random() * 0.6),
        shape: o.shape || 'spark',
        color: o.color || '#ffd76a',
        drift: 6
      });
    }
  }

  /** 冲击波环 */
  function shockwave(x, y, o = {}) {
    add({
      x, y, shape: 'ring',
      r0: o.r0 != null ? o.r0 : 6,
      r1: o.r1 != null ? o.r1 : 110,
      width: o.width || 10,
      life: o.life || 0.45,
      color: o.color || '#ffd76a'
    });
  }

  /** 新月斩击 */
  function slash(x, y, o = {}) {
    add({
      x, y, shape: 'slash',
      radius: o.radius || 46,
      arc: o.arc || Math.PI * 0.85,
      sweep: o.sweep != null ? o.sweep : 1.2,
      rot: o.angle != null ? o.angle : Math.random() * Math.PI * 2,
      width: o.width || 12,
      life: o.life || 0.3,
      color: o.color || '#ffffff',
      fadeIn: true
    });
  }

  /** 闪电：从 (x,y) 向 angle 方向劈出折线 */
  function bolt(x, y, o = {}) {
    const len = o.len || 90;
    const segs = o.segs || 6;
    const angle = o.angle != null ? o.angle : -Math.PI / 2;
    const pts = [0, 0];
    let px = 0, py = 0;
    for (let i = 1; i <= segs; i++) {
      const d = (len / segs) * i;
      const off = (i === segs) ? 0 : (Math.random() - 0.5) * len * 0.22;
      const a = angle + (i === segs ? 0 : (Math.random() - 0.5) * 0.5);
      px = Math.cos(a) * d + off;
      py = Math.sin(a) * d + (Math.random() - 0.5) * len * 0.1;
      pts.push(px, py);
    }
    add({
      x, y, shape: 'bolt', pts,
      width: o.width || 3.5,
      life: o.life || 0.22,
      color: o.color || '#ffe27a',
      fadeIn: true
    });
  }

  /** 烟雾（普通合成） */
  function smoke(x, y, o = {}) {
    for (let i = 0; i < (o.count || 3); i++) {
      add({
        x: x + (Math.random() - 0.5) * (o.spread || 24),
        y: y + (Math.random() - 0.5) * (o.spread || 24) * 0.5,
        shape: 'smoke',
        size: (o.size || 16) * (0.7 + Math.random() * 0.6),
        life: (o.life || 0.9) * (0.8 + Math.random() * 0.5),
        color: o.color || '#8a7a62'
      });
    }
  }

  /** 碎片飞溅（受重力、旋转） */
  function shards(x, y, o = {}) {
    const n = o.count || 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed || 5) * (0.5 + Math.random());
      add({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 2,
        g: o.gravity != null ? o.gravity : 0.5,
        drag: 0.96,
        size: (o.size || 5) * (0.6 + Math.random() * 0.9),
        vr: (Math.random() - 0.5) * 14,
        life: (o.life || 0.7) * (0.7 + Math.random() * 0.6),
        shape: 'shard',
        color: o.color || '#d4a05a'
      });
    }
  }

  /** 喷泉：持续向上发射粒子（火焰/水花/金屑） */
  function fountain(x, y, o = {}) {
    const n = o.count || 14;
    emitter({
      duration: o.duration || 0.35,
      interval: (o.duration || 0.35) / n,
      spawn: () => {
        const a = (o.angle != null ? o.angle : -Math.PI / 2) + (Math.random() - 0.5) * (o.spread || 0.9);
        const sp = (o.speed || 8) * (0.6 + Math.random() * 0.8);
        add({
          x: x + (Math.random() - 0.5) * (o.width || 30),
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          g: o.gravity != null ? o.gravity : 0.32,
          drag: 0.965,
          size: (o.size || 6) * (0.6 + Math.random() * 0.8),
          life: (o.life || 0.65) * (0.7 + Math.random() * 0.6),
          shape: o.shape || 'circle',
          color: o.color || '#ffb84d',
          drift: 5
        });
      }
    });
  }

  /** 屏幕震动（游戏 Juice 惯例：短促、快衰减） */
  function shake(intensity = 0.4) {
    if (!hasGsap()) return;
    const el = document.querySelector('.app') || document.body;
    const amp = 3 + intensity * 9; // px
    window.gsap.fromTo(el,
      { x: 0, y: 0 },
      {
        x: () => (Math.random() - 0.5) * 2 * amp,
        y: () => (Math.random() - 0.5) * 1.4 * amp,
        duration: 0.045,
        repeat: 5 + Math.round(intensity * 4),
        yoyo: true,
        ease: 'none',
        clearProps: 'x,y'
      }
    );
  }

  /**
   * 打击瞬间通用反馈：冲击波 + 火花环 + 震屏
   * 在攻守碰撞那一帧调用（base.js 阶段 3）
   */
  function impact(x, y, o = {}) {
    const color = o.color || '#ffd76a';
    const strong = !!o.strong;
    shockwave(x, y, { r1: strong ? 150 : 105, color: '#ffffff', width: strong ? 12 : 8, life: 0.35 });
    shockwave(x, y, { r0: 4, r1: strong ? 120 : 82, color, width: 6, life: 0.55 });
    burst(x, y, { count: strong ? 22 : 14, color, speed: 8.5, size: 7, life: 0.5 });
    shake(strong ? 0.7 : 0.4);
  }

  return { burst, shockwave, slash, bolt, smoke, shards, fountain, shake, impact };
})();
