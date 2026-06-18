/* ============================================================
   27 个特效工厂（重写版）
   - 通用 5 阶段由 playCaptureScene() 处理
   - 每个工厂只关心"阶段 5 元素释放"
   - factory 签名: (layer, theme) => void
   - 调用: FxList.playFX(fx) 由 main.js 触发
   ============================================================ */
const FxList = (function () {
  const { gsap } = window;
  const F = FxBase;

  /** 攻方棋子大小适配 */
  const PIECE_SIZE = { elephant: 1.1, lion: 1.0, tiger: 1.0, leopard: 1.0, wolf: 1.0, dog: 1.0, cat: 0.9, rat: 0.8 };
  function pieceClass(animal) {
    return `fx-piece fx-piece-${PIECE_SIZE[animal] >= 1.05 ? 'large' : PIECE_SIZE[animal] <= 0.85 ? 'small' : ''}`.trim();
  }

  // ============== 元素释放函数 ==============

  /** 释放象牙突刺 + 棕尘 */
  function releaseTusks(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    [1, -1].forEach(side => {
      const t = document.createElement('div');
      t.className = 'fx-tusk';
      t.style.height = '40px';
      t.style.left = `${cx}px`;
      t.style.top = `${cy}px`;
      t.style.transform = `translate(-50%, -50%) rotate(${side * 25}deg)`;
      layer.appendChild(t);
      gsap.fromTo(t, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(2)' });
      gsap.to(t, { opacity: 0, duration: 0.3, delay: 0.4, onComplete: () => t.remove() });
    });
    F.radialBurst(layer, theme, 8, 80, 0.5);
  }

  /** 移动·灰尘：5 颗彩色尘粒从底部散开 */
  function releaseMoveDust(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    for (let i = 0; i < 5; i++) {
      const d = document.createElement('div');
      d.className = 'fx-move-dust';
      d.style.background = (theme && theme.color) || '#aaa';
      d.style.width = '6px';
      d.style.height = '6px';
      d.style.borderRadius = '50%';
      d.style.left = `${cx + (Math.random() - 0.5) * 20}px`;
      d.style.top = `${cy + 10}px`;
      layer.appendChild(d);
      gsap.to(d, {
        x: (Math.random() - 0.5) * 30,
        y: 20,
        opacity: 0,
        scale: 0,
        duration: 0.5,
        delay: i * 0.05,
        ease: 'power2.out',
        onComplete: () => d.remove()
      });
    }
  }

  /** 释放鬃毛火焰 */
  function releaseMane(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    for (let i = 0; i < 12; i++) {
      const m = document.createElement('div');
      m.className = 'fx-mane';
      m.style.left = `${cx}px`;
      m.style.top = `${cy}px`;
      m.style.transform = 'translate(-50%, -50%)';
      layer.appendChild(m);
      const angle = (i / 12) * 360;
      gsap.fromTo(m, { x: 0, y: 0, scale: 0, rotate: angle },
        { x: Math.cos(angle * Math.PI / 180) * 80, y: Math.sin(angle * Math.PI / 180) * 80, scale: 1.2, rotate: angle, duration: 0.5, ease: 'power2.out' });
      gsap.to(m, { opacity: 0, duration: 0.3, delay: 0.5, onComplete: () => m.remove() });
    }
  }

  /** 释放王字 + 雷电 */
  function releaseWang(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    const w = document.createElement('div');
    w.className = 'fx-wang';
    w.textContent = '王';
    w.style.fontSize = '70px';
    w.style.width = '70px';
    w.style.height = '70px';
    w.style.lineHeight = '70px';
    w.style.left = `${cx}px`;
    w.style.top = `${cy}px`;
    w.style.transform = 'translate(-50%, -50%) scale(0)';
    w.style.boxShadow = `0 0 20px ${theme.color}`;
    layer.appendChild(w);
    gsap.to(w, { scale: 1, duration: 0.4, ease: 'back.out(1.5)' });
    gsap.to(w, { scale: 0, opacity: 0, duration: 0.3, delay: 0.6, onComplete: () => w.remove() });
    F.radialBurst(layer, theme, 8, 70, 0.4);
  }

  /** 释放豹纹弧线 */
  function releaseLeoStripes(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('div');
      s.className = 'fx-leo-stripe';
      s.style.background = theme.color;
      s.style.width = '40px';
      const angle = i * 45;
      s.style.left = `${cx}px`;
      s.style.top = `${cy}px`;
      s.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
      layer.appendChild(s);
      gsap.fromTo(s, { x: 0, opacity: 0, scaleX: 0 },
        { x: Math.cos(angle * Math.PI / 180) * 80, opacity: 1, scaleX: 1, rotate: angle + 360, duration: 0.4, ease: 'power1.out' });
      gsap.to(s, { opacity: 0, duration: 0.3, delay: 0.3, onComplete: () => s.remove() });
    }
  }

  /** 释放月牙獠牙 */
  function releaseMoonFang(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    const m = document.createElement('div');
    m.className = 'fx-moon';
    m.style.left = `${cx}px`;
    m.style.top = `${cy}px`;
    m.style.transform = 'translate(-50%, -50%) rotate(-45deg) scale(0)';
    layer.appendChild(m);
    gsap.to(m, { scale: 1.6, rotation: '45deg', duration: 0.4, ease: 'back.out(2)' });
    gsap.to(m, { scale: 0, opacity: 0, duration: 0.3, delay: 0.5, onComplete: () => m.remove() });
    [-1, 1].forEach(side => {
      const f = document.createElement('div');
      f.className = 'fx-fang';
      f.style.left = `${cx + side * 14}px`;
      f.style.top = `${cy + 10}px`;
      layer.appendChild(f);
      gsap.fromTo(f, { y: -10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, delay: 0.1 });
      gsap.to(f, { y: 20, opacity: 0, duration: 0.3, delay: 0.4, onComplete: () => f.remove() });
    });
  }

  /** 释放骨爪 */
  function releaseBonePaw(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    const bone = document.createElement('div');
    bone.className = 'fx-bone';
    bone.style.left = `${cx}px`;
    bone.style.top = `${cy}px`;
    bone.style.transform = 'translate(-50%, -50%) scale(0)';
    layer.appendChild(bone);
    gsap.to(bone, { scale: 1.4, rotation: 360, duration: 0.4, ease: 'back.out(2)' });
    gsap.to(bone, { scale: 0, opacity: 0, duration: 0.3, delay: 0.4, onComplete: () => bone.remove() });
    for (let i = 0; i < 4; i++) {
      const p = document.createElement('div');
      p.className = 'fx-paw';
      p.style.color = theme.color;
      const angle = (i / 4) * 360;
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.transform = 'translate(-50%, -50%)';
      layer.appendChild(p);
      gsap.to(p, { x: Math.cos(angle * Math.PI / 180) * 60, y: Math.sin(angle * Math.PI / 180) * 60, opacity: 0, scale: 0.5, duration: 0.5, ease: 'power2.out', onComplete: () => p.remove() });
    }
  }

  /** 释放胡须 */
  function releaseWhiskers(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    for (let i = 0; i < 6; i++) {
      const w = document.createElement('div');
      w.className = 'fx-whisker';
      w.style.left = `${cx}px`;
      w.style.top = `${cy - 8 + (i % 3) * 8}px`;
      w.style.transformOrigin = 'left center';
      layer.appendChild(w);
      const side = i < 3 ? 1 : -1;
      gsap.fromTo(w, { scaleX: 0, opacity: 0 }, { scaleX: 1.2, opacity: 1, duration: 0.2, delay: i * 0.04, x: side * 25 });
      gsap.to(w, { opacity: 0, duration: 0.3, delay: 0.5 + i * 0.04, onComplete: () => w.remove() });
    }
  }

  /** 释放长尾 */
  function releaseTail(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    const tail = document.createElement('div');
    tail.className = 'fx-tail';
    tail.style.background = theme.color;
    tail.style.width = '50px';
    tail.style.left = `${cx}px`;
    tail.style.top = `${cy}px`;
    tail.style.transformOrigin = 'left center';
    layer.appendChild(tail);
    gsap.fromTo(tail, { scaleX: 0, rotate: 0 }, { scaleX: 1, rotate: 720, duration: 0.5, ease: 'power1.out' });
    gsap.to(tail, { scaleX: 0, opacity: 0, duration: 0.2, delay: 0.5, onComplete: () => tail.remove() });
    [-1, 1].forEach(side => {
      const p = document.createElement('div');
      p.className = 'fx-paw';
      p.style.color = theme.color;
      p.style.width = '8px';
      p.style.height = '8px';
      p.style.left = `${cx + side * 12}px`;
      p.style.top = `${cy + 12}px`;
      layer.appendChild(p);
      gsap.to(p, { x: side * 8, y: 8, opacity: 0, duration: 0.4, onComplete: () => p.remove() });
    });
  }

  // ============== 跳河 / 陷阱 / 兽穴 / 反杀 的差异化释放 ==============

  /** 跳河·光柱 */
  function releaseRiverBeam(layer, theme) {
    const w = layer.clientWidth, h = layer.clientHeight;
    for (let i = 0; i < 2; i++) {
      const l = document.createElement('div');
      l.className = 'fx-river-light';
      l.style.background = `linear-gradient(180deg, transparent 0%, ${theme.color} 50%, transparent 100%)`;
      l.style.color = theme.color;
      l.style.width = '10px';
      l.style.height = '80px';
      l.style.left = `-30px`;
      l.style.top = `${h/2 - 40 + (i === 0 ? -10 : 10)}px`;
      layer.appendChild(l);
      gsap.fromTo(l, { x: 0, scaleY: 0.3, opacity: 0 },
        { x: w + 60, scaleY: 1, opacity: 1, duration: 0.6, delay: i * 0.05, ease: 'power2.in' });
      gsap.to(l, { scaleY: 0, opacity: 0, duration: 0.15, delay: 0.6 + i * 0.05, onComplete: () => l.remove() });
    }
    for (let i = 0; i < 3; i++) {
      const r = document.createElement('div');
      r.className = 'fx-ripple';
      const size = 24 + i * 18;
      r.style.width = `${size}px`;
      r.style.height = `${size}px`;
      r.style.left = `${w/2 - size/2}px`;
      r.style.top = `${h/2 - size/2}px`;
      layer.appendChild(r);
      gsap.fromTo(r, { scale: 0, opacity: 0.8 }, { scale: 2, opacity: 0, duration: 0.7, delay: 0.3 + i * 0.1, ease: 'power1.out', onComplete: () => r.remove() });
    }
  }

  /** 跳河·王字光柱 */
  function releaseRiverWang(layer, theme) {
    const w = layer.clientWidth, h = layer.clientHeight;
    const wang = document.createElement('div');
    wang.className = 'fx-wang';
    wang.textContent = '王';
    wang.style.fontSize = '50px';
    wang.style.width = '50px';
    wang.style.height = '50px';
    wang.style.lineHeight = '50px';
    wang.style.left = `-30px`;
    wang.style.top = `${h/2 - 25}px`;
    wang.style.boxShadow = `0 0 20px ${theme.color}`;
    layer.appendChild(wang);
    gsap.to(wang, { x: w + 60, rotation: 360, duration: 0.6, ease: 'power2.in' });
    gsap.to(wang, { opacity: 0, duration: 0.15, delay: 0.6, onComplete: () => wang.remove() });
    for (let i = 0; i < 3; i++) {
      const r = document.createElement('div');
      r.className = 'fx-ripple';
      const size = 24 + i * 18;
      r.style.width = `${size}px`;
      r.style.height = `${size}px`;
      r.style.left = `${w/2 - size/2}px`;
      r.style.top = `${h/2 - size/2}px`;
      layer.appendChild(r);
      gsap.fromTo(r, { scale: 0, opacity: 0.8 }, { scale: 2.2, opacity: 0, duration: 0.7, delay: 0.3 + i * 0.1, ease: 'power1.out', onComplete: () => r.remove() });
    }
  }

  /** 兽穴·大字弹出 */
  function releaseCrown(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    const w = layer.clientWidth, h = layer.clientHeight;
    // 4 道光束
    const dirs = [[-1,-1],[1,-1],[-1,1],[1,1]];
    dirs.forEach(([dx, dy]) => {
      const beam = document.createElement('div');
      beam.style.width = '3px';
      beam.style.height = '50px';
      beam.style.background = `linear-gradient(to end, ${theme.color}, transparent)`;
      beam.style.left = `${cx}px`;
      beam.style.top = `${cy}px`;
      beam.style.transformOrigin = 'top center';
      layer.appendChild(beam);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      gsap.fromTo(beam, { x: 0, y: 0, scaleX: 0, rotate: angle, opacity: 0 },
        { x: dx * w * 0.3, y: dy * h * 0.3, scaleX: 1, opacity: 1, duration: 0.4, ease: 'power2.out' });
      gsap.to(beam, { opacity: 0, duration: 0.3, delay: 0.4, onComplete: () => beam.remove() });
    });
    // 大字
    const text = document.createElement('div');
    text.className = 'fx-victory-text';
    text.textContent = '胜';
    text.style.color = theme.color;
    layer.appendChild(text);
    gsap.fromTo(text, { scale: 0, rotation: -180, opacity: 0 },
      { scale: 1, rotation: 0, opacity: 1, duration: 0.5, delay: 0.2, ease: 'back.out(1.7)' });
    gsap.to(text, { scale: 0.5, opacity: 0, duration: 0.3, delay: 1, onComplete: () => text.remove() });
  }

  /** 反杀·鼠吃象 */
  function releaseReverse(layer, theme) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    // 1. 鼠尾缠绕
    const tail = document.createElement('div');
    tail.className = 'fx-tail';
    tail.style.background = '#9a9590';
    tail.style.width = '60px';
    tail.style.left = `${cx}px`;
    tail.style.top = `${cy}px`;
    tail.style.transformOrigin = 'left center';
    layer.appendChild(tail);
    gsap.fromTo(tail, { scaleX: 0, rotate: 0 }, { scaleX: 1, rotate: 720, duration: 0.5, ease: 'power1.out' });
    // 2. 白线切断
    const line = document.createElement('div');
    line.style.width = '2px';
    line.style.height = '50px';
    line.style.background = '#fff';
    line.style.boxShadow = '0 0 6px #fff';
    line.style.left = `${cx}px`;
    line.style.top = `${cy - 25}px`;
    line.style.transform = 'scaleY(0)';
    layer.appendChild(line);
    gsap.to(line, { scaleY: 1, duration: 0.2, delay: 0.3, ease: 'power2.out' });
    gsap.to(line, { opacity: 0, duration: 0.3, delay: 0.7, onComplete: () => line.remove() });
    // 3. 象轰塌（4 块象牙碎片）
    for (let i = 0; i < 4; i++) {
      const t = document.createElement('div');
      t.className = 'fx-tusk';
      t.style.height = '30px';
      t.style.left = `${cx}px`;
      t.style.top = `${cy}px`;
      const angle = (i / 4) * 360;
      t.style.transform = `rotate(${angle}deg) translateY(-15px)`;
      layer.appendChild(t);
      gsap.to(t, { x: Math.cos(angle * Math.PI / 180) * 70, y: Math.sin(angle * Math.PI / 180) * 70 + 40, opacity: 0, duration: 0.5, delay: 0.5, ease: 'power2.in', onComplete: () => t.remove() });
    }
    // 4. 闪白
    F.flash(layer, 0.3);
  }

  /** 陷阱·通用：身体下陷 + 特征元素 */
  function releaseSink(layer, theme, opts = {}) {
    // 优先从 layer CSS 变量读取目标格中心（由 base.js 注入）
    const cx = parseFloat(layer.style.getPropertyValue('--fx-cx')) || layer.clientWidth / 2;
    const cy = parseFloat(layer.style.getPropertyValue('--fx-cy')) || layer.clientHeight / 2;
    // 身体下沉（用攻方颜色画一个圆代表）
    const body = document.createElement('div');
    body.style.width = '40px';
    body.style.height = '40px';
    body.style.background = theme.color;
    body.style.borderRadius = '50%';
    body.style.left = `${cx}px`;
    body.style.top = `${cy}px`;
    body.style.transform = 'translate(-50%, -50%)';
    layer.appendChild(body);
    gsap.to(body, { y: 40, opacity: 0, scale: 0.4, duration: opts.duration || 0.5, ease: 'power2.in', onComplete: () => body.remove() });
    // 特征元素（如果提供）
    if (opts.extra) opts.extra(layer, theme);
  }

  // ============== 27 个 FX_FACTORIES ==============

  /** 简化生成：普通吃子 = 攻方动物 + 守方动物（随机低级） + 对应释放函数 */
  const ANIMAL_RANK = { elephant: 8, lion: 7, tiger: 6, leopard: 5, wolf: 4, dog: 3, cat: 2, rat: 1 };
  const ANIMALS = ['elephant', 'lion', 'tiger', 'leopard', 'wolf', 'dog', 'cat', 'rat'];

  function pickDefender(attacker) {
    const ar = ANIMAL_RANK[attacker];
    const candidates = ANIMALS.filter(a => ANIMAL_RANK[a] < ar);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const RELEASE = {
    elephant: releaseTusks,
    lion: releaseMane,
    tiger: releaseWang,
    leopard: releaseLeoStripes,
    wolf: releaseMoonFang,
    dog: releaseBonePaw,
    cat: releaseWhiskers,
    rat: releaseTail
  };

  // 27 个工厂条目
  const FX_FACTORIES = [
    // 普通吃子 8 种
    { id: '01', category: '普通吃子', animal: 'elephant', desc: '象牙突刺',     scene: 'burst',   release: RELEASE.elephant },
    { id: '02', category: '普通吃子', animal: 'lion',     desc: '鬃毛火焰',     scene: 'burst',   release: RELEASE.lion },
    { id: '03', category: '普通吃子', animal: 'tiger',    desc: '王字雷印',     scene: 'burst',   release: RELEASE.tiger },
    { id: '04', category: '普通吃子', animal: 'leopard',  desc: '豹纹风刃',     scene: 'burst',   release: RELEASE.leopard },
    { id: '05', category: '普通吃子', animal: 'wolf',     desc: '月牙獠牙',     scene: 'burst',   release: RELEASE.wolf },
    { id: '06', category: '普通吃子', animal: 'dog',      desc: '骨爪飞扑',     scene: 'burst',   release: RELEASE.dog },
    { id: '07', category: '普通吃子', animal: 'cat',      desc: '胡须横扫',     scene: 'burst',   release: RELEASE.cat },
    { id: '08', category: '普通吃子', animal: 'rat',      desc: '尾巴缠绕',     scene: 'burst',   release: RELEASE.rat },
    // 跳河吃子 2 种
    { id: '09', category: '跳河吃子', animal: 'lion',     desc: '金色光柱过河', scene: 'stream',  release: releaseRiverBeam },
    { id: '10', category: '跳河吃子', animal: 'tiger',    desc: '王字青光过河', scene: 'stream',  release: releaseRiverWang },
    // 陷阱吃子 8 种
    { id: '11', category: '陷阱吃子', animal: 'elephant', desc: '象牙先沉',     scene: 'sink',    release: (l, t) => releaseSink(l, t, { duration: 0.7, extra: (ll, tt) => RELEASE.elephant(ll, tt) }) },
    { id: '12', category: '陷阱吃子', animal: 'lion',     desc: '鬃毛没入',     scene: 'sink',    release: (l, t) => releaseSink(l, t, { duration: 0.6, extra: RELEASE.lion }) },
    { id: '13', category: '陷阱吃子', animal: 'tiger',    desc: '虎纹扭曲',     scene: 'sink',    release: (l, t) => releaseSink(l, t, { duration: 0.5, extra: RELEASE.tiger }) },
    { id: '14', category: '陷阱吃子', animal: 'leopard',  desc: '豹纹旋转',     scene: 'sink',    release: (l, t) => releaseSink(l, t, { duration: 0.4, extra: RELEASE.leopard }) },
    { id: '15', category: '陷阱吃子', animal: 'wolf',     desc: '月牙没入',     scene: 'sink',    release: (l, t) => releaseSink(l, t, { duration: 0.5, extra: RELEASE.wolf }) },
    { id: '16', category: '陷阱吃子', animal: 'dog',      desc: '爪子刨土',     scene: 'sink',    release: (l, t) => releaseSink(l, t, { duration: 0.5, extra: RELEASE.dog }) },
    { id: '17', category: '陷阱吃子', animal: 'cat',      desc: '胡须颤抖',     scene: 'sink',    release: (l, t) => releaseSink(l, t, { duration: 0.5, extra: RELEASE.cat }) },
    { id: '18', category: '陷阱吃子', animal: 'rat',      desc: '尾巴一卷',     scene: 'sink',    release: (l, t) => releaseSink(l, t, { duration: 0.2, extra: RELEASE.rat }) },
    // 兽穴获胜 8 种
    { id: '19', category: '兽穴获胜', animal: 'elephant', desc: '象牙冲穴',     scene: 'crown',   release: (l, t) => { RELEASE.elephant(l, t); releaseCrown(l, t); } },
    { id: '20', category: '兽穴获胜', animal: 'lion',     desc: '鬃毛炸开',     scene: 'crown',   release: (l, t) => { RELEASE.lion(l, t); releaseCrown(l, t); } },
    { id: '21', category: '兽穴获胜', animal: 'tiger',    desc: '王字盖印',     scene: 'crown',   release: (l, t) => { RELEASE.tiger(l, t); releaseCrown(l, t); } },
    { id: '22', category: '兽穴获胜', animal: 'leopard',  desc: '豹纹冲刺',     scene: 'crown',   release: (l, t) => { RELEASE.leopard(l, t); releaseCrown(l, t); } },
    { id: '23', category: '兽穴获胜', animal: 'wolf',     desc: '长嚎破空',     scene: 'crown',   release: (l, t) => { RELEASE.wolf(l, t); releaseCrown(l, t); } },
    { id: '24', category: '兽穴获胜', animal: 'dog',      desc: '欢快摇尾',     scene: 'crown',   release: (l, t) => { RELEASE.dog(l, t); releaseCrown(l, t); } },
    { id: '25', category: '兽穴获胜', animal: 'cat',      desc: '优雅漫步',     scene: 'crown',   release: (l, t) => { RELEASE.cat(l, t); releaseCrown(l, t); } },
    { id: '26', category: '兽穴获胜', animal: 'rat',      desc: '鬼影穿穴',     scene: 'crown',   release: (l, t) => { RELEASE.rat(l, t); releaseCrown(l, t); } },
    // 反杀特化
    { id: '27', category: '反杀特化', animal: 'rat',      desc: '鼠吃象·以小搏大', scene: 'reverse', release: releaseReverse },
    // 移动 1 种
    { id: '28', category: '移动',     animal: 'dog',      desc: '行军·扬尘',       scene: 'move',    release: releaseMoveDust }
  ];

  // 补全 theme
  FX_FACTORIES.forEach(fx => { fx.theme = ANIMAL_THEMES[fx.animal]; });

  /**
   * 播放单个 FX（main.js 调用）
   * @param {Object} fx FX_FACTORIES 中一项
   * @param {Object} opts 覆盖选项 { attackerColor, defenderColor, soundOn }
   */
  function playFX(fx, opts = {}) {
    const attackerColor = opts.attackerColor || 'blue';
    const defenderColor = opts.defenderColor || 'red';
    // 普通吃子 → 守方选一个低级
    let defender = opts.defender;
    if (!defender) {
      if (fx.category === '反杀特化') defender = 'elephant';
      else if (fx.category === '跳河吃子') defender = 'rat';
      else if (fx.category === '陷阱吃子') defender = pickDefender(fx.animal) || 'rat';
      else if (fx.category === '兽穴获胜') defender = 'rat';
      else defender = pickDefender(fx.animal) || 'rat';
    }
    // 播放音效
    if (opts.soundOn !== false) {
      FxSound.play(fx.animal, fx.scene);
    }
    // 目标格：默认演示页 #fxCell，游戏可指定棋盘格
    const targetCell = opts.targetCell || document.getElementById('fxCell');
    return playCaptureSceneAt(targetCell, {
      attackerAnimal: fx.animal,
      defenderAnimal: defender,
      attackerColor, defenderColor,
      scene: fx.scene,
      theme: fx.theme,
      releaseFx: fx.release
    });
  }

  return { FX_FACTORIES, playFX };
})();

// 暴露到全局
window.FxList = FxList;
