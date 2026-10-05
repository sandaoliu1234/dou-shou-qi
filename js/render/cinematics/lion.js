/* ============================================================
   狮 · 攻击剧场（狮吼震退）
   ------------------------------------------------------------
   注册到 window.AttackCinematics.lion，由 renderer3d 的
   playAttack3D 在「普通吃子」且攻方为狮时调起。
   只允许通过 ctx + window.AttackFx 触碰场景，不持有 scene/camera。

   分镜（约 2.4s，兜底 4.5s 必 resolve）：
     0.00-0.24  蓄气：转向守方 → 后仰吸气（rotation.x -0.28）
                + 鬃毛微涨（scale 脉冲 1.07）
     0.25       怒吼爆发第一波：金色冲击环 r1=2.2 + 贴地闪光
                + 狮口点光爆闪 + 震屏(0.5) + 狮吼音
                + 三道竖立声波弧（临时 Object3D，1.05s 后销毁）
     0.37/0.49  第二/三波：冲击环 r1=3.0/3.8 + 闪光 + 震屏递减
     0.25-0.80  守方被声波连续推退 3 段（每段 0.25 格，段间小幅
                腾空），身体后仰踉跄 + 每段脚下扬尘
     0.76-1.00  守方原地踉跄失衡（后倾加深、左右摇晃）
     1.00-1.30  守方失去平衡摔倒（rotation.x ±1.42 仰面躺平，
                倒向远离狮子的方向），y 抬升贴地不穿模
     1.30       落地：尘土爆发 + 碎屑 + 灰环 + 震屏(0.45) + 闷响
                + 等级底座「震脱」淡出
     1.40-1.72  狮抖鬃收势：scale y 脉冲两下 + 甩鬃小摇头 + 金环
     1.55-1.95  狮走回守方格心站定（滑步 + 小跳步 + 落定点头）
     2.00-2.32  守方（仰面躺平）整体淡出
     2.36       守方 visible=false；攻方精确复位到守方格心

   技术点：
     - 攻守双方 rotation.order 都改 'YXZ'：先偏航再俯仰，
       后仰/摔倒方向与各自朝向解耦
     - 摔倒俯仰的符号 s：按「守方头顶倾向方向 · 推退方向」点积
       取符号，保证无论守方朝向如何，摔倒总是倒向远离狮子的方向
     - 狮口世界坐标用 atkRoot.localToWorld(0,0.35,0.3) 实时反算
       （失败时退化为格心 + 朝向偏移的手工近似）
     - 声波弧是自建的临时 Group（3 道 TorusGeometry 圆弧，竖立
       面向守方），走 AttackFx.add 挂载 / disposeTree+remove 销毁，
       并加 1.3s ttl 作双保险，不泄漏任何 GPU 资源
     - 守方材质提前转 transparent，收尾整体淡出后 visible=false，
       由棋盘稍后移除（与 tiger / playReverseCinematic 同套路）
   ============================================================ */
(function () {
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function lionCinematic(ctx) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      window.gsap.delayedCall(4.5, finish);   // 兜底，超时也必须 resolve

      const api = window.AttackFx || null;
      const atk = ctx && ctx.attacker;
      const def = ctx && ctx.defender;

      // ctx 或特效层缺失：直接安全复位并放行，绝不锁死输入
      if (!api || !atk || !def || !atk.root || !def.root) {
        try {
          if (def && def.root) {
            window.gsap.killTweensOf(def.root.position);
            def.root.visible = false;
          }
          if (atk && atk.root && def) {
            window.gsap.killTweensOf(atk.root.position);
            atk.root.position.set(def.to.x, atk.baseY, def.to.z);
            atk.root.scale.set(1, 1, 1);
            atk.root.visible = true;
          }
        } catch (e) { /* 降级路径不抛错 */ }
        finish();
        return;
      }

      const atkRoot = atk.root;
      const defRoot = def.root;
      const from = atk.from;             // 攻方格心（y=0 平面坐标）
      const to = def.to;                 // 守方格心
      const aBaseY = atk.baseY || api.cellTopY();
      const dBaseY = def.baseY || api.cellTopY();

      /* ---- 收尾函数：先定义，供异常兜底复用（演出守则 2） ---- */
      function finalize() {
        try {
          window.gsap.killTweensOf(defRoot.position);
          window.gsap.killTweensOf(defRoot.rotation);
          window.gsap.killTweensOf(defRoot.scale);
          defRoot.visible = false;

          window.gsap.killTweensOf(atkRoot.position);
          window.gsap.killTweensOf(atkRoot.rotation);
          window.gsap.killTweensOf(atkRoot.scale);
          atkRoot.position.set(to.x, aBaseY, to.z);
          atkRoot.rotation.set(0, startYaw, 0);
          atkRoot.scale.set(1, 1, 1);
          atkRoot.visible = true;
        } catch (e) { /* 复位失败也不锁死 resolve */ }
      }

      try {
        const tl = window.gsap.timeline({ onComplete: () => finish() });

        /* ---- 前置清理：接管攻守 root 的位姿（演出守则 1） ---- */
        ['position', 'rotation', 'scale'].forEach(k => {
          window.gsap.killTweensOf(atkRoot[k]);
          window.gsap.killTweensOf(defRoot[k]);
        });
        // 剧场旋转顺序：先偏航后俯仰（演出守则 3）
        atkRoot.rotation.order = 'YXZ';
        defRoot.rotation.order = 'YXZ';

        const startYaw = atkRoot.rotation.y;      // 攻方原始朝向（收尾复位用）
        const defStartYaw = defRoot.rotation.y;

        // 推退方向 = from→to 单位向量（远离狮子）
        let dx = to.x - from.x, dz = to.z - from.z;
        const dist = Math.hypot(dx, dz) || 1;
        dx /= dist; dz /= dist;
        const pounceYaw = Math.atan2(dx, dz);     // 面朝守方所需偏航

        // 摔倒方向符号：+pitch 会让头顶倾向 (sinYaw, cosYaw) 方向，
        // 与推退方向点积为正 → 仰面向后倒；为负 → 取负 pitch。保证
        // 无论守方朝向如何都倒向「远离狮子」的一侧
        const tipX = Math.sin(defStartYaw), tipZ = Math.cos(defStartYaw);
        const dot = tipX * dx + tipZ * dz;
        const s = dot >= 0 ? 1 : -1;

        // 守方推退落点（3 段 × 0.25 格，夹在棋盘范围内）
        const seg = [0.25, 0.5, 0.75].map(k => ({
          x: clamp(to.x + dx * k, -3.9, 3.9),
          z: clamp(to.z + dz * k, -2.9, 2.9)
        }));

        const snd = api.sound ? api.sound() : null;

        /* ---- 守方材质提前转 transparent（收尾整体淡出） ---- */
        const defMats = [];
        defRoot.traverse(o => {
          if (o.isMesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(m => { m.transparent = true; defMats.push(m); });
          }
        });
        const discMats = [];   // 等级底座（children[0]）：摔倒落地时「震脱」
        const disc = defRoot.children && defRoot.children[0];
        if (disc && disc.isMesh) {
          const mats = Array.isArray(disc.material) ? disc.material : [disc.material];
          mats.forEach(m => discMats.push(m));
        }

        /* ---- 狮口世界坐标：localToWorld 实时反算，失败退化手工近似 ---- */
        let mouthW = null;
        function mouthWorld() {
          if (mouthW) return mouthW;
          const manual = {
            x: from.x + dx * 0.30, y: aBaseY + 0.44, z: from.z + dz * 0.30
          };
          const THREE = window.THREE;
          if (!THREE || typeof atkRoot.localToWorld !== 'function') return manual;
          try {
            const v = atkRoot.localToWorld(new THREE.Vector3(0, 0.35, 0.3));
            mouthW = {
              x: v.x,
              y: Math.max(aBaseY + 0.30, v.y),
              z: v.z
            };
          } catch (e) { mouthW = manual; }
          return mouthW;
        }

        /* ---- 声波弧：3 道竖立金色圆弧从狮口向守方扩散（临时物体） ---- */
        function spawnRoarWave() {
          const THREE = window.THREE;
          if (!THREE) return;
          const mouth = mouthWorld();
          const wave = new THREE.Group();
          wave.position.set(mouth.x, mouth.y + 0.06, mouth.z);
          wave.rotation.y = pounceYaw;          // 弧面正对守方
          const arc = Math.PI * 0.8;
          const golds = [0xffe9a8, 0xffd76a, 0xe8a535];
          for (let k = 0; k < 3; k++) {
            const geo = new THREE.TorusGeometry(0.13 + k * 0.09, 0.016, 6, 22, arc);
            const mat = new THREE.MeshBasicMaterial({
              color: golds[k], transparent: true, opacity: 0.95, depthWrite: false
            });
            const m = new THREE.Mesh(geo, mat);
            m.rotation.z = Math.PI / 2 - arc / 2;   // 圆弧开口中心对准 +y
            wave.add(m);
            const d = 0.06 + k * 0.07;
            window.gsap.fromTo(m.scale,
              { x: 0.35, y: 0.35, z: 0.35 },
              { x: 1.3, y: 1.3, z: 1.3, duration: 0.42, delay: d, ease: 'power2.out' });
            window.gsap.to(mat, { opacity: 0, duration: 0.24, delay: d + 0.22 });
          }
          api.add(wave, 1.3);   // ttl 双保险：即使忘了手动清理也会被摘下
          window.gsap.delayedCall(1.05, () => {
            api.disposeTree(wave);
            api.remove(wave);
          });
        }

        /* ============================================================
           分镜演出
           ============================================================ */

        // ---- 0.00-0.24 蓄气：转向守方 + 后仰吸气 + 鬃毛微涨 ----
        // 选中浮动残留的 y 先压回基准（浮动循环在 fxBusyUntil 内不会打扰）
        tl.to(atkRoot.position, { y: aBaseY, duration: 0.10, ease: 'power1.out' }, 0);
        tl.to(atkRoot.rotation, { y: pounceYaw, duration: 0.14, ease: 'power1.inOut' }, 0);
        tl.to(atkRoot.rotation, { x: -0.28, duration: 0.20, ease: 'power2.out' }, 0.03);
        tl.to(atkRoot.scale, { x: 1.07, y: 1.06, z: 1.07, duration: 0.22, ease: 'sine.inOut' }, 0.02);
        tl.to(atkRoot.position, { y: aBaseY + 0.03, duration: 0.20, ease: 'sine.inOut' }, 0.10);

        // ---- 0.25/0.37/0.49 怒吼三连波：冲击环 r1 递增 2.2/3.0/3.8 ----
        tl.call(() => {
          const rg = { x: from.x + dx * 0.25, y: aBaseY, z: from.z + dz * 0.25 };
          api.ring(rg, 0xffd76a, { r1: 2.2, life: 0.55 });
          api.impactFlash(rg, 'rgba(255,214,140,0.9)', { size: 0.95, life: 0.32 });
          api.flashLight(mouthWorld(), 0xffc860, 6);
          api.shakeCamera(0.5);
          spawnRoarWave();
          if (snd && snd.play) snd.play(ctx.animal || 'lion', 'burst');
        }, [], 0.25);
        tl.call(() => {
          const rg = { x: from.x + dx * 0.25, y: aBaseY, z: from.z + dz * 0.25 };
          api.ring(rg, 0xf0b24a, { r1: 3.0, life: 0.60 });
          api.impactFlash(rg, 'rgba(255,200,130,0.8)', { size: 0.78, life: 0.28 });
          api.flashLight(mouthWorld(), 0xffc860, 4.5);
          api.shakeCamera(0.4);
        }, [], 0.37);
        tl.call(() => {
          const rg = { x: from.x + dx * 0.25, y: aBaseY, z: from.z + dz * 0.25 };
          api.ring(rg, 0xe8a535, { r1: 3.8, life: 0.65 });
          api.impactFlash(rg, 'rgba(255,190,120,0.75)', { size: 0.62, life: 0.26 });
          api.flashLight(mouthWorld(), 0xffc860, 3.5);
          api.shakeCamera(0.35);
        }, [], 0.49);

        // 吼出瞬间头顶前送再回正，配合 scale 收回
        tl.to(atkRoot.rotation, { x: 0.16, duration: 0.10, ease: 'power2.in' }, 0.25);
        tl.to(atkRoot.rotation, { x: 0, duration: 0.30, ease: 'power2.out' }, 0.38);
        tl.to(atkRoot.scale, { x: 1, y: 1, z: 1, duration: 0.25, ease: 'power2.out' }, 0.40);
        tl.to(atkRoot.position, { y: aBaseY, duration: 0.25, ease: 'power2.out' }, 0.40);

        // ---- 0.25-0.80 守方被声波推退 3 段（每段 0.25 格 + 小幅腾空） ----
        for (let i = 0; i < 3; i++) {
          const t0 = 0.25 + i * 0.17;
          const sx = seg[i].x, sz = seg[i].z;
          tl.to(defRoot.position, { x: sx, z: sz, duration: 0.16, ease: 'power2.out' }, t0);
          tl.to(defRoot.position, { y: dBaseY + 0.13, duration: 0.07, ease: 'power2.out' }, t0);
          tl.to(defRoot.position, { y: dBaseY, duration: 0.10, ease: 'power2.in' }, t0 + 0.065);
          // 后仰踉跄：一波比一波更站不稳 + 左右摇晃
          tl.to(defRoot.rotation, { x: s * (0.26 + i * 0.12), duration: 0.14, ease: 'power2.out' }, t0);
          tl.to(defRoot.rotation, { z: (i % 2 ? -0.12 : 0.12), duration: 0.16, ease: 'sine.inOut' }, t0);
          // 每段脚下扬尘（滑行擦地）
          tl.call(() => {
            api.smoke({ x: sx, y: dBaseY, z: sz }, 0xa68b64, { count: 2, size: 0.10 });
          }, [], t0 + 0.02);
        }

        // ---- 0.76-1.00 踉跄失衡：原地摇晃、重心不稳 ----
        tl.to(defRoot.rotation, { x: s * 0.55, duration: 0.16, ease: 'sine.inOut' }, 0.78);
        tl.to(defRoot.rotation, { z: 0, duration: 0.16, ease: 'sine.inOut' }, 0.78);
        tl.to(defRoot.position, { y: dBaseY, duration: 0.16, ease: 'power1.out' }, 0.78);

        // ---- 1.00-1.30 失衡摔倒：仰面躺平（倒向远离狮子的一侧） ----
        tl.to(defRoot.rotation, { x: s * 1.42, duration: 0.32, ease: 'power2.in' }, 1.00);
        tl.to(defRoot.rotation, { y: defStartYaw, duration: 0.20, ease: 'sine.inOut' }, 1.00);
        tl.to(defRoot.position, { y: dBaseY + 0.24, duration: 0.30, ease: 'power1.in' }, 1.00);
        tl.call(() => {
          const lx = seg[2].x, lz = seg[2].z;
          api.smoke({ x: lx, y: dBaseY + 0.02, z: lz }, 0xa68b64, { count: 5, size: 0.17 });
          api.burst({ x: lx, y: dBaseY + 0.06, z: lz }, 0x9a8a76, { count: 8, size: 0.045, dist: 0.6 });
          api.ring({ x: lx, y: dBaseY, z: lz }, 0xcccccc, { r1: 2.0, life: 0.45 });
          api.shakeCamera(0.45);
          if (snd && snd.impact) snd.impact();
          // 等级底座被震脱：淡出，让躺平的身体不拖着一块立起来的圆盘
          discMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.30, ease: 'power1.out' }));
        }, [], 1.30);
        // 落地小弹：身体拍地回弹一下
        tl.to(defRoot.position, { y: dBaseY + 0.18, duration: 0.12, ease: 'power1.out' }, 1.30);
        tl.to(defRoot.rotation, { x: s * 1.34, duration: 0.09, ease: 'power1.out' }, 1.30);
        tl.to(defRoot.rotation, { x: s * 1.42, duration: 0.10, ease: 'sine.inOut' }, 1.39);

        // ---- 1.40-1.72 狮抖鬃收势：scale y 脉冲两下 + 甩鬃小摇头 ----
        tl.call(() => {
          api.ring({ x: from.x, y: aBaseY, z: from.z }, 0xe8a535, { r1: 1.4, life: 0.4 });
        }, [], 1.42);
        tl.to(atkRoot.scale, { x: 1.08, y: 1.12, z: 1.08, duration: 0.09, ease: 'power2.out' }, 1.40);
        tl.to(atkRoot.scale, { x: 0.97, y: 0.94, z: 0.97, duration: 0.08, ease: 'sine.inOut' }, 1.49);
        tl.to(atkRoot.scale, { x: 1.05, y: 1.08, z: 1.05, duration: 0.08, ease: 'sine.inOut' }, 1.57);
        tl.to(atkRoot.scale, { x: 1, y: 1, z: 1, duration: 0.09, ease: 'power2.out' }, 1.65);
        tl.to(atkRoot.rotation, { z: 0.07, duration: 0.08, ease: 'sine.inOut' }, 1.40);
        tl.to(atkRoot.rotation, { z: -0.07, duration: 0.09, ease: 'sine.inOut' }, 1.48);
        tl.to(atkRoot.rotation, { z: 0, duration: 0.08, ease: 'sine.inOut' }, 1.57);

        // ---- 1.55-1.95 走回守方格心站定（滑步 + 起步小跳 + 落定点头） ----
        tl.to(atkRoot.position, { x: to.x, z: to.z, duration: 0.38, ease: 'power1.inOut' }, 1.55);
        tl.to(atkRoot.position, { y: aBaseY + 0.08, duration: 0.10, ease: 'power2.out' }, 1.57);
        tl.to(atkRoot.position, { y: aBaseY, duration: 0.12, ease: 'power2.in' }, 1.67);
        tl.to(atkRoot.rotation, { x: 0.06, duration: 0.09, ease: 'sine.inOut' }, 1.95);
        tl.to(atkRoot.rotation, { x: 0, duration: 0.12, ease: 'sine.inOut' }, 2.04);

        // ---- 2.00-2.32 守方（仰面躺平的尸体）整体淡出 ----
        tl.call(() => {
          defMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.32, ease: 'power1.in' }));
        }, [], 2.00);

        // ---- 2.36 收尾：守方隐没 + 攻方精确复位（演出守则 2） ----
        tl.call(() => { finalize(); }, [], 2.36);
      } catch (e) {
        // 任何异常都不允许锁死游戏：复位 + 立即放行
        finalize();
        finish();
      }
    });
  }

  window.AttackCinematics = window.AttackCinematics || {};
  window.AttackCinematics.lion = lionCinematic;
})();
