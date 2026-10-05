/* ============================================================
   Animals3D · 程序化低多边形动物构建器
   ------------------------------------------------------------
   技术路线参考（用户提供的资源清单）：
   - github.com/echoscarrie-lab/miso-3d-cat（纯 Three.js 几何体拼卡通猫）
   - github.com/georgiakt/3d-dog-model（圆柱身体+球头+圆锥耳）
   - CSDN 裸眼 3D 小狗教程（摇尾巴动画思路）

   为什么不用 Poly Pizza / Sketchfab 的 .glb：
   - 各模型风格不统一（69% CC-BY 还要逐个署名），且 Blender 导出管线
     在本机不可用；程序化拼装能保证 8 只动物同一套卡通语言、
     面数可控（每只 < 1k 三角）、零下载零版权负担。

   约定：
   - 每只动物面朝 +z（红方默认朝向，蓝方由渲染器 rotation.y = PI 转过去）
   - 站在 y=0 的底座上，总高 0.4~0.62（格边长 1.0）
   - build() 每次返回新 Group（内部几何体/材质走缓存，clone 共享）
   ============================================================ */
(function () {
  const cache = new Map();   // typeKey -> { group, geos, mats }

  /* ---------- 材质/几何助手 ---------- */
  function mat(color, opt = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color, roughness: 0.72, metalness: 0.02
    }, opt));
  }
  function mk(geo, material, x, y, z, opt = {}) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    if (opt.rx) m.rotation.x = opt.rx;
    if (opt.ry) m.rotation.y = opt.ry;
    if (opt.rz) m.rotation.z = opt.rz;
    if (opt.sx || opt.sy || opt.sz) m.scale.set(opt.sx || 1, opt.sy || 1, opt.sz || 1);
    return m;
  }
  const SPHERE = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
  const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const CYL = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const CONE = (r, h, seg = 10) => new THREE.ConeGeometry(r, h, seg);

  /** 等级底座：队伍色圆盘 + 顶面等级数字（canvas 纹理） */
  const levelTexCache = new Map();
  function levelTexture(owner, level) {
    const key = owner + level;
    if (levelTexCache.has(key)) return levelTexCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    const team = owner === 'red' ? '#8f2f24' : '#24496e';
    const rim = owner === 'red' ? '#c0574a' : '#3f6f9e';
    // 底色
    c.fillStyle = team;
    c.beginPath(); c.arc(64, 64, 64, 0, Math.PI * 2); c.fill();
    // 外圈描边
    c.strokeStyle = rim; c.lineWidth = 10;
    c.beginPath(); c.arc(64, 64, 56, 0, Math.PI * 2); c.stroke();
    // 内盘
    c.fillStyle = 'rgba(253,246,233,0.16)';
    c.beginPath(); c.arc(64, 64, 44, 0, Math.PI * 2); c.fill();
    // 等级数字
    c.fillStyle = '#fdf6e9';
    c.font = '700 52px "PingFang SC", "Microsoft YaHei", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(level), 64, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    levelTexCache.set(key, tex);
    return tex;
  }

  const TYPE_LEVEL = {
    ELEPHANT: 'elephant', LION: 'lion', TIGER: 'tiger', LEOPARD: 'leopard',
    WOLF: 'wolf', DOG: 'dog', CAT: 'cat', RAT: 'rat'
  };
  const LEVEL_NUM = { elephant: 8, lion: 7, tiger: 6, leopard: 5, wolf: 4, dog: 3, cat: 2, rat: 1 };

  /**
   * 构建一只动物（含等级底座）
   * @param {string} owner 'red' | 'blue'
   * @param {string} typeKey 'elephant' | 'lion' | ...
   * @returns {THREE.Group|null}
   */
  function buildPiece(owner, typeKey) {
    const level = LEVEL_NUM[typeKey] || 0;
    const g = new THREE.Group();

    // ---- 等级底座（顶面贴数字，侧面队伍色） ----
    const teamColor = owner === 'red' ? 0xa8382b : 0x2f5d8a;
    const sideMat = mat(teamColor, { roughness: 0.5 });
    const topMat = new THREE.MeshStandardMaterial({
      map: levelTexture(owner, level), roughness: 0.55, metalness: 0.05
    });
    const bottomMat = mat(teamColor);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.40, 0.43, 0.07, 28),
      [sideMat, topMat, bottomMat]
    );
    base.position.y = 0.035;
    base.receiveShadow = true;
    g.add(base);
    g.userData.baseY = 0.07;   // 动物脚踩的基准高度（底座顶面）

    const body = buildAnimal(typeKey);
    if (!body) return null;
    body.position.y = g.userData.baseY;
    g.add(body);

    // 队伍朝向：红方面 +z（朝蓝方），蓝方由渲染器转 PI
    g.userData.typeKey = typeKey;
    return g;
  }

  /* ---------- 各动物（面朝 +z） ---------- */

  function buildAnimal(key) {
    switch (key) {
      case 'elephant': return elephant();
      case 'lion': return lion();
      case 'tiger': return tiger();
      case 'leopard': return leopard();
      case 'wolf': return wolf();
      case 'dog': return dog();
      case 'cat': return cat();
      case 'rat': return rat();
      default: return null;
    }
  }

  /** 通用四足躯干：身体 + 4 腿 + 头位标记 */
  function quad(bodyColor, opt = {}) {
    const o = Object.assign({ bodyR: 0.20, legH: 0.10, headR: 0.17, headY: 0.30, headZ: 0.20 }, opt);
    const m = mat(bodyColor);
    const g = new THREE.Group();
    // 躯干（水平椭球）
    g.add(mk(SPHERE(o.bodyR), m, 0, o.legH + o.bodyR * 0.72, -0.02, { sx: 0.9, sy: 0.82, sz: 1.25 }));
    // 四腿
    const legGeo = CYL(o.legH * 0.42, o.legH * 0.5, o.legH, 10);
    [[-0.11, 0.10], [0.11, 0.10], [-0.11, -0.16], [0.11, -0.16]].forEach(([lx, lz]) => {
      g.add(mk(legGeo, m, lx, o.legH / 2, lz));
    });
    // 头
    g.add(mk(SPHERE(o.headR), m, 0, o.headY, o.headZ));
    g.userData.head = { x: 0, y: o.headY, z: o.headZ, r: o.headR, mat: m };
    return g;
  }

  function elephant() {
    const skin = 0x9aa6b5, dark = 0x7f8b9c, ivory = 0xf3ede0;
    const g = quad(skin, { bodyR: 0.26, legH: 0.11, headR: 0.21, headY: 0.36, headZ: 0.26 });
    const hd = g.userData.head;
    // 大耳朵（两片扁球）
    const earMat = mat(dark);
    [-1, 1].forEach(s => {
      g.add(mk(SPHERE(0.13), earMat, s * 0.19, hd.y + 0.02, hd.z - 0.02, { sx: 0.28, sy: 1.15, sz: 0.95, rz: s * 0.15 }));
    });
    // 象鼻：4 节圆柱向下弯
    const trunkMat = mat(skin);
    let px = 0, py = hd.y - 0.06, pz = hd.z + hd.r * 0.85, ang = 0.5;
    for (let i = 0; i < 4; i++) {
      const seg = CYL(0.055 - i * 0.008, 0.065 - i * 0.008, 0.09, 10);
      const segM = mk(seg, trunkMat, px, py, pz, { rx: ang });
      g.add(segM);
      pz += Math.sin(ang) * 0.085; py -= Math.cos(ang) * 0.085;
      ang = Math.max(0.05, ang - 0.42);
    }
    // 象牙
    const tuskMat = mat(ivory, { roughness: 0.4 });
    [-1, 1].forEach(s => {
      g.add(mk(CONE(0.03, 0.16, 8), tuskMat, s * 0.09, hd.y - 0.10, hd.z + hd.r * 0.72, { rx: 1.9, rz: s * 0.2 }));
    });
    // 小尾巴
    g.add(mk(CYL(0.02, 0.025, 0.16, 8), trunkMat, 0, 0.26, -0.32, { rx: 0.5 }));
    g.scale.setScalar(1.12);
    return g;
  }

  function lion() {
    const fur = 0xe0a33c, mane = 0x9c5a1d, light = 0xf3d9a0;
    const g = quad(fur, { bodyR: 0.20, legH: 0.10, headR: 0.15, headY: 0.34, headZ: 0.22 });
    const hd = g.userData.head;
    // 鬃毛：头后一圈厚环（扁球罩）
    g.add(mk(SPHERE(0.22), mat(mane, { roughness: 0.85 }), hd.x, hd.y + 0.01, hd.z - 0.09, { sx: 1.15, sy: 1.12, sz: 0.72 }));
    // 耳朵
    const earMat = mat(mane);
    [-1, 1].forEach(s => g.add(mk(CONE(0.045, 0.09, 8), earMat, s * 0.10, hd.y + 0.15, hd.z - 0.02)));
    // 吻部
    g.add(mk(SPHERE(0.07), mat(light), hd.x, hd.y - 0.04, hd.z + hd.r * 0.75, { sy: 0.8 }));
    // 尾巴 + 尾梢
    const tailMat = mat(fur);
    g.add(mk(CYL(0.025, 0.03, 0.3, 8), tailMat, 0, 0.30, -0.33, { rx: 1.0 }));
    g.add(mk(SPHERE(0.05), mat(mane), 0, 0.40, -0.46));
    g.scale.setScalar(1.06);
    return g;
  }

  function tiger() {
    const fur = 0xdf8437, stripe = 0x403326, light = 0xf5e3c4;
    const g = quad(fur, { bodyR: 0.20, legH: 0.10, headR: 0.16, headY: 0.33, headZ: 0.23 });
    const hd = g.userData.head;
    // 条纹：躯干与头顶的深色窄片
    const sMat = mat(stripe);
    [[-0.02, 0.30], [0.10, 0.26], [-0.14, 0.22], [0.20, 0.18]].forEach(([dz, dy], i) => {
      g.add(mk(BOX(0.30 - i * 0.02, 0.035, 0.035), sMat, 0, dy, dz - 0.10));
    });
    g.add(mk(BOX(0.05, 0.028, 0.10), sMat, 0.07, hd.y + 0.12, hd.z + 0.02));
    g.add(mk(BOX(0.05, 0.028, 0.10), sMat, -0.07, hd.y + 0.12, hd.z + 0.02));
    // 耳朵（圆球小耳）
    [-1, 1].forEach(s => g.add(mk(SPHERE(0.055), sMat, s * 0.10, hd.y + 0.15, hd.z - 0.03)));
    // 吻部
    g.add(mk(SPHERE(0.075), mat(light), hd.x, hd.y - 0.045, hd.z + hd.r * 0.8, { sy: 0.75 }));
    // 尾巴（带环纹）
    g.add(mk(CYL(0.026, 0.03, 0.32, 8), mat(fur), 0, 0.30, -0.34, { rx: 1.15 }));
    g.add(mk(CYL(0.028, 0.028, 0.06, 8), sMat, 0, 0.38, -0.47, { rx: 1.15 }));
    g.scale.setScalar(1.05);
    return g;
  }

  function leopard() {
    const fur = 0xd4bb4e, spot = 0x4a3c1e, light = 0xf0e2b6;
    const g = quad(fur, { bodyR: 0.185, legH: 0.10, headR: 0.145, headY: 0.32, headZ: 0.22 });
    const hd = g.userData.head;
    // 斑点：随机散布小球
    const sMat = mat(spot);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.add(mk(SPHERE(0.024), sMat,
        Math.cos(a * 2.3) * 0.13, 0.20 + (i % 3) * 0.07, -0.14 + Math.sin(a) * 0.16,
        { sx: 1.4, sy: 0.7 }));
    }
    // 耳朵
    [-1, 1].forEach(s => g.add(mk(SPHERE(0.05), sMat, s * 0.095, hd.y + 0.14, hd.z - 0.02)));
    // 吻部
    g.add(mk(SPHERE(0.07), mat(light), hd.x, hd.y - 0.04, hd.z + hd.r * 0.8, { sy: 0.75 }));
    // 长尾
    g.add(mk(CYL(0.02, 0.026, 0.34, 8), mat(fur), 0, 0.30, -0.35, { rx: 1.3 }));
    g.scale.setScalar(1.0);
    return g;
  }

  function wolf() {
    const fur = 0x8494ad, dark = 0x5d6c84, light = 0xd9e2ee;
    const g = quad(fur, { bodyR: 0.19, legH: 0.11, headR: 0.15, headY: 0.34, headZ: 0.22 });
    const hd = g.userData.head;
    // 尖吻
    g.add(mk(CONE(0.065, 0.18, 10), mat(light), hd.x, hd.y - 0.03, hd.z + hd.r + 0.05, { rx: Math.PI / 2 }));
    // 立耳（圆锥）
    [-1, 1].forEach(s => g.add(mk(CONE(0.055, 0.13, 8), mat(dark), s * 0.09, hd.y + 0.16, hd.z - 0.03, { rz: s * 0.18 })));
    // 蓬松尾（长椭球，微微上翘）
    g.add(mk(SPHERE(0.075), mat(dark), 0, 0.32, -0.36, { sx: 0.75, sy: 0.75, sz: 1.7, rx: 0.35 }));
    // 颈背深毛
    g.add(mk(SPHERE(0.12), mat(dark), 0, hd.y - 0.05, hd.z - 0.12, { sz: 0.7 }));
    g.scale.setScalar(1.04);
    return g;
  }

  function dog() {
    const fur = 0xc08a58, dark = 0x8a5f38, light = 0xf0d9b8;
    const g = quad(fur, { bodyR: 0.195, legH: 0.10, headR: 0.16, headY: 0.33, headZ: 0.22 });
    const hd = g.userData.head;
    // 垂耳（两片下垂扁球）
    [-1, 1].forEach(s => {
      g.add(mk(SPHERE(0.07), mat(dark), s * 0.14, hd.y + 0.05, hd.z - 0.04, { sx: 0.45, sy: 1.3, sz: 0.8 }));
    });
    // 吻部 + 鼻头
    g.add(mk(SPHERE(0.08), mat(light), hd.x, hd.y - 0.045, hd.z + hd.r * 0.85, { sy: 0.72 }));
    g.add(mk(SPHERE(0.028), mat(0x3a2c20), hd.x, hd.y - 0.03, hd.z + hd.r + 0.10));
    // 尾巴（上翘小尾）
    g.add(mk(CYL(0.03, 0.035, 0.2, 8), mat(fur), 0, 0.33, -0.32, { rx: -0.7 }));
    g.scale.setScalar(1.0);
    return g;
  }

  function cat() {
    const fur = 0xe0a892, dark = 0xa8654e, light = 0xf7e3d3;
    const g = quad(fur, { bodyR: 0.165, legH: 0.09, headR: 0.15, headY: 0.30, headZ: 0.20 });
    const hd = g.userData.head;
    // 大尖耳
    [-1, 1].forEach(s => {
      g.add(mk(CONE(0.06, 0.13, 8), mat(fur), s * 0.095, hd.y + 0.16, hd.z - 0.02, { rz: s * 0.15 }));
      g.add(mk(CONE(0.032, 0.07, 8), mat(light), s * 0.095, hd.y + 0.155, hd.z + 0.005, { rz: s * 0.15 }));
    });
    // 胡须：4 根白色细丝
    const whis = mat(0xffffff, { roughness: 0.35 });
    [-1, 1].forEach(s => [[0.02], [-0.03]].forEach(([dy], i) => {
      g.add(mk(CYL(0.004, 0.004, 0.16, 4), whis, s * 0.10, hd.y - 0.02 + dy, hd.z + hd.r * 0.7, { rz: Math.PI / 2 + s * 0.12, ry: s * 0.35 }));
    }));
    // 弯尾（3 节）
    const t1 = mk(CYL(0.022, 0.026, 0.16, 8), mat(fur), 0, 0.26, -0.28, { rx: 1.2 });
    const t2 = mk(CYL(0.02, 0.022, 0.14, 8), mat(dark), 0, 0.36, -0.37, { rx: 0.35 });
    g.add(t1); g.add(t2);
    // 额头条纹
    g.add(mk(BOX(0.035, 0.02, 0.09), mat(dark), 0, hd.y + 0.13, hd.z + 0.02));
    g.scale.setScalar(0.95);
    return g;
  }

  function rat() {
    const fur = 0xa9a49e, dark = 0x7e7973, light = 0xe8c8b8;
    const g = quad(fur, { bodyR: 0.15, legH: 0.08, headR: 0.12, headY: 0.25, headZ: 0.18 });
    const hd = g.userData.head;
    // 大圆耳
    [-1, 1].forEach(s => {
      g.add(mk(SPHERE(0.065), mat(dark), s * 0.10, hd.y + 0.10, hd.z - 0.05, { sx: 0.35, sy: 1, sz: 1 }));
      g.add(mk(SPHERE(0.045), mat(light), s * 0.115, hd.y + 0.10, hd.z - 0.045, { sx: 0.35, sy: 1, sz: 1 }));
    });
    // 尖吻
    g.add(mk(CONE(0.05, 0.14, 8), mat(fur), hd.x, hd.y - 0.02, hd.z + hd.r + 0.03, { rx: Math.PI / 2 }));
    // 细长尾（2 节弯折）
    g.add(mk(CYL(0.012, 0.016, 0.22, 6), mat(0xc7908a), 0, 0.20, -0.30, { rx: 1.35 }));
    g.add(mk(CYL(0.009, 0.012, 0.18, 6), mat(0xc7908a), 0, 0.30, -0.40, { rx: 0.6 }));
    g.scale.setScalar(0.9);
    return g;
  }

  /* ---------- 导出 ---------- */
  window.Animals3D = {
    /**
     * 构建动物（含等级底座）。每只动物面数 < 1k，16 个实例的
     * 显存与构建开销都可忽略，换来「每个实例可独立改材质」的自由度。
     * @returns {THREE.Group|null}
     */
    build(THREE, owner, typeKey) {
      return buildPiece(owner, typeKey);
    },
    /** 该 typeKey 是否支持 3D 模型 */
    supports(typeKey) {
      return !!TYPE_LEVEL[typeKey.toUpperCase()] || !!LEVEL_NUM[typeKey];
    }
  };
})();
