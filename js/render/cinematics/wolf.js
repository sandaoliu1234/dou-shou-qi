/* ============================================================
   狼 · 攻击剧场（狼咬甩头）
   ------------------------------------------------------------
   注册到 window.AttackCinematics.wolf，由 renderer3d 的
   playAttack3D 在「普通吃子」且攻方为狼时调起。
   只允许通过 ctx + window.AttackFx 触碰场景，不持有 scene/camera。

   分镜（约 2.4s，兜底 4.5s 必 resolve）：
     0.00-0.20  压低身子潜行逼近守方格边（前移 0.3 格 + scale.y 0.9）
                + 狼嚎（sound().play('wolf','burst')）
     0.20-0.35  猛扑咬住：短距扑到守方格（小幅腾空），俯头咬合
     0.35-0.48  叼住：守方位置 tween 到狼口
                （attacker.root.localToWorld(0,0.36,0.40) 近似狼口），略微悬空
     0.48-0.98  左右猛甩：狼 rotation.y ±0.45 两次大幅摆头，
                守方位置被甩向相反方向（x/z 摆幅 ±0.3，rotation.z 跟着甩），
                期间地面小尘雾两撮
     1.00-1.40  甩飞：守方沿「远离狼」方向抛物线飞出约 1.0 格
                （垂直方向轻偏 0.25 避免砸在相邻棋子正中），
                空中前翻两圈 + 侧滚一圈，重摔躺平（rotation.x ≡ 1.5）
     1.40       落地：尘土 + 贴地闪光 + 冲击环 + shakeCamera(0.6) + 闷响
     1.44-1.84  狼抖毛收势（scale 快速小幅抖动两下）+ 走回守方格心站定
     2.00-2.35  守方侧躺尸体整体淡出
     2.40       守方 visible=false；攻方精确复位到守方格心

   技术点：
     - 攻守双方 rotation.order 改 'YXZ'：先偏航再俯仰（演出守则 3）
     - 狼口锚点 M 在咬合帧用 localToWorld 实时取（狼已落定在守方格心、
       面朝 pounceYaw），甩头阶段守方各关键帧均以 M 为基准偏移
     - 守方材质提前转 transparent：甩飞瞬间等级底座「脱盘」淡出，
       结尾全身淡出，最后 visible=false（棋盘稍后自动移除）
     - 甩飞落点与虎剧场同套路：clamp 夹在棋盘范围内
   ============================================================ */
(function () {
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function wolfCinematic(ctx) {
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

      const tl = window.gsap.timeline({ onComplete: () => finish() });

      const atkRoot = atk.root;
      const defRoot = def.root;
      const from = atk.from;             // 攻方格心
      const to = def.to;                 // 守方格心
      const aBaseY = atk.baseY || api.cellTopY();
      const dBaseY = def.baseY || api.cellTopY();

      /* ---- 前置清理：接管攻守 root 的位姿（演出守则 1） ---- */
      ['position', 'rotation', 'scale'].forEach(k => {
        window.gsap.killTweensOf(atkRoot[k]);
        window.gsap.killTweensOf(defRoot[k]);
      });
      // 剧场旋转顺序：先偏航后俯仰（演出守则 3）
      atkRoot.rotation.order = 'YXZ';
      defRoot.rotation.order = 'YXZ';

      const startYaw = atkRoot.rotation.y;          // 攻方原始朝向（收尾复位用）
      const defStartYaw = defRoot.rotation.y;

      // 扑咬方向（from→to 单位向量），守方「远离狼」被甩飞也沿它
      let dx = to.x - from.x, dz = to.z - from.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist; dz /= dist;
      const pounceYaw = Math.atan2(dx, dz);         // 面朝守方所需偏航

      // 潜行逼近点：攻方格心向守方推进 0.7（= 前移 0.3 格）
      const stalkX = from.x + dx * 0.7;
      const stalkZ = from.z + dz * 0.7;
      // 甩飞落点：远离狼 1.0 格 + 垂直方向轻偏 0.25（避免砸在相邻棋子正中），夹在棋盘内
      const side = Math.random() < 0.5 ? -1 : 1;
      const perpX = -dz, perpZ = dx;
      const flyX = clamp(to.x + dx * 1.0 + perpX * 0.25 * side, -3.9, 3.9);
      const flyZ = clamp(to.z + dz * 1.0 + perpZ * 0.25 * side, -2.9, 2.9);

      const snd = api.sound ? api.sound() : null;

      /* ---- 守方材质提前转 transparent（甩飞脱盘、结尾全身淡出） ---- */
      const defMats = [];
      defRoot.traverse(o => {
        if (o.isMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { m.transparent = true; defMats.push(m); });
        }
      });
      const discMats = [];   // 等级底座（children[0]）：甩飞瞬间脱盘
      const disc = defRoot.children && defRoot.children[0];
      if (disc && disc.isMesh) {
        const mats = Array.isArray(disc.material) ? disc.material : [disc.material];
        mats.forEach(m => discMats.push(m));
      }

      /* ============================================================
         分镜演出
         ============================================================ */

      // ---- 0.00-0.20 压低身子潜行逼近 + 狼嚎 ----
      tl.call(() => {
        if (snd && snd.play) snd.play(ctx.animal || 'wolf', 'burst');
      }, [], 0);
      tl.to(atkRoot.rotation, { y: pounceYaw, duration: 0.10, ease: 'power1.inOut' }, 0);
      tl.to(atkRoot.scale, { x: 1.04, y: 0.90, z: 1.04, duration: 0.16, ease: 'power1.out' }, 0);
      tl.to(atkRoot.rotation, { x: 0.14, duration: 0.16, ease: 'power1.out' }, 0.02);   // 俯头潜行
      tl.to(atkRoot.position, { x: stalkX, z: stalkZ, duration: 0.18, ease: 'power1.inOut' }, 0.02);
      tl.to(atkRoot.position, { y: aBaseY, duration: 0.18, ease: 'power1.out' }, 0.02);

      // ---- 0.20-0.35 猛扑咬住：短距扑到守方格 + 小幅腾空 ----
      tl.to(atkRoot.scale, { x: 1, y: 1, z: 1, duration: 0.10, ease: 'power1.in' }, 0.20);
      tl.to(atkRoot.position, { x: to.x, z: to.z, duration: 0.15, ease: 'power2.in' }, 0.20);
      tl.to(atkRoot.position, { y: aBaseY + 0.16, duration: 0.075, ease: 'power2.out' }, 0.20);
      tl.to(atkRoot.position, { y: aBaseY, duration: 0.075, ease: 'power2.in' }, 0.275);
      tl.to(atkRoot.rotation, { x: -0.16, duration: 0.06, ease: 'power1.out' }, 0.20);  // 起扑抬头
      tl.to(atkRoot.rotation, { x: 0.18, duration: 0.09, ease: 'power1.in' }, 0.26);    // 咬合俯头

      // ---- 0.35 叼住：守方 tween 到狼口（悬空），随后左右猛甩 ----
      // 注意：守方的所有位姿补间都必须在 call 内动态排（先 killTweensOf 再加），
      // 若预排在 timeline 上会被这里的 killTweensOf 一并杀掉（虎剧场同套路）
      tl.call(() => {
        // 狼此刻已落定在守方格心、面朝 pounceYaw，实时取狼口世界坐标
        const mouth = atkRoot.localToWorld(new window.THREE.Vector3(0, 0.36, 0.40));
        const M = { x: mouth.x, y: Math.max(mouth.y, dBaseY + 0.22), z: mouth.z };
        window.gsap.killTweensOf(defRoot.position);
        window.gsap.killTweensOf(defRoot.rotation);

        // 咬合反馈：狼口处一小段冰白斩弧 + 碎屑
        api.slash(M, pounceYaw, 0xd9e2ee, { radius: 0.30, arc: Math.PI * 0.6, sweep: 0.55, thickness: 0.035, life: 0.22 });
        api.burst(M, 0xbcd4ec, { count: 6, size: 0.03, dist: 0.35 });

        // 守方被叼到狼口，略微悬空
        tl.to(defRoot.position, { x: M.x, y: M.y, z: M.z, duration: 0.13, ease: 'power2.out' }, 0.35);

        /* -- 0.48-0.98 左右猛甩：狼摆头，守方反向鞭甩 -- */
        // 狼摆头 ±0.45 两次
        tl.to(atkRoot.rotation, { y: pounceYaw + 0.45, duration: 0.14, ease: 'sine.inOut' }, 0.48);
        tl.to(atkRoot.rotation, { y: pounceYaw - 0.45, duration: 0.18, ease: 'sine.inOut' }, 0.62);
        tl.to(atkRoot.rotation, { y: pounceYaw, duration: 0.16, ease: 'sine.inOut' }, 0.82);
        // 守方反向甩（局部 -x / +x 摆幅 0.3，rotation.z 跟甩，y 轻微上下鞭动）
        tl.to(defRoot.position, {
          x: M.x - Math.cos(pounceYaw) * 0.30, z: M.z + Math.sin(pounceYaw) * 0.30,
          y: M.y - 0.03, duration: 0.14, ease: 'sine.inOut'
        }, 0.48);
        tl.to(defRoot.rotation, { z: 0.55, duration: 0.14, ease: 'sine.inOut' }, 0.48);
        tl.to(defRoot.position, {
          x: M.x + Math.cos(pounceYaw) * 0.30, z: M.z - Math.sin(pounceYaw) * 0.30,
          y: M.y + 0.02, duration: 0.18, ease: 'sine.inOut'
        }, 0.62);
        tl.to(defRoot.rotation, { z: -0.55, duration: 0.18, ease: 'sine.inOut' }, 0.62);
        tl.to(defRoot.position, { x: M.x, z: M.z, y: M.y, duration: 0.16, ease: 'sine.inOut' }, 0.82);
        tl.to(defRoot.rotation, { z: 0, duration: 0.16, ease: 'sine.inOut' }, 0.82);
      }, [], 0.35);

      // 甩动期间地面小尘雾两撮（守方格两侧）
      tl.call(() => {
        api.smoke({ x: to.x + perpX * 0.14, y: aBaseY, z: to.z + perpZ * 0.14 }, 0x9aa7b8, { count: 2, size: 0.10 });
      }, [], 0.56);
      tl.call(() => {
        api.smoke({ x: to.x - perpX * 0.14, y: aBaseY, z: to.z - perpZ * 0.14 }, 0x9aa7b8, { count: 2, size: 0.10 });
      }, [], 0.78);

      // ---- 1.00 甩飞：守方抛物线飞出 + 空中翻滚；狼顺势前探 ----
      // 守方位姿补间同样在 call 内动态排（前面的 killTweensOf 不会杀到它们）
      tl.call(() => {
        window.gsap.killTweensOf(defRoot.position);
        window.gsap.killTweensOf(defRoot.rotation);
        // 等级底座被甩脱：脱盘淡出
        discMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.25, ease: 'power1.out' }));

        tl.to(defRoot.position, { x: flyX, z: flyZ, duration: 0.40, ease: 'power1.out' }, 1.00);
        tl.to(defRoot.position, { y: dBaseY + 0.58, duration: 0.20, ease: 'power2.out' }, 1.00);
        tl.to(defRoot.position, { y: dBaseY + 0.14, duration: 0.20, ease: 'power2.in' }, 1.20);
        // 空中翻滚：前翻两圈收在 1.5（侧躺）+ 侧滚一圈收在整圈
        tl.to(defRoot.rotation, { x: 1.5 + Math.PI * 4, duration: 0.40, ease: 'power1.inOut' }, 1.00);
        tl.to(defRoot.rotation, { z: (side < 0 ? 1 : -1) * Math.PI * 2, duration: 0.40, ease: 'power1.inOut' }, 1.00);
        // 摔实后的小幅下沉
        tl.to(defRoot.position, { y: dBaseY + 0.12, duration: 0.10, ease: 'power1.out' }, 1.40);
      }, [], 1.00);
      // 狼甩出后的顺势前探
      tl.to(atkRoot.position, { x: to.x + dx * 0.15, z: to.z + dz * 0.15, duration: 0.10, ease: 'power2.out' }, 1.00);
      tl.to(atkRoot.rotation, { x: 0.20, duration: 0.09, ease: 'power1.out' }, 1.00);
      tl.to(atkRoot.rotation, { x: 0, duration: 0.14, ease: 'power2.out' }, 1.10);

      // ---- 1.40 重摔落地：尘土 + 闪光 + 冲击环 + 强震 + 闷响 ----
      tl.call(() => {
        api.smoke({ x: flyX, y: dBaseY, z: flyZ }, 0xa68b64, { count: 5, size: 0.17 });
        api.burst({ x: flyX, y: dBaseY + 0.06, z: flyZ }, 0x9a8a76, { count: 8, size: 0.045, dist: 0.6 });
        api.impactFlash({ x: flyX, y: dBaseY, z: flyZ }, 'rgba(200,210,225,0.85)', { size: 0.9, life: 0.35 });
        api.ring({ x: flyX, y: dBaseY, z: flyZ }, 0xccccd8, { r1: 2.2, life: 0.45 });
        api.shakeCamera(0.6);
        if (snd && snd.impact) snd.impact();
      }, [], 1.40);

      // ---- 1.44-1.84 狼抖毛收势（快速小幅抖动两下）----
      tl.to(atkRoot.scale, { x: 1.06, y: 0.92, z: 1.06, duration: 0.07, ease: 'sine.inOut' }, 1.44);
      tl.to(atkRoot.scale, { x: 0.96, y: 1.06, z: 0.96, duration: 0.07, ease: 'sine.inOut' }, 1.52);
      tl.to(atkRoot.scale, { x: 1.04, y: 0.94, z: 1.04, duration: 0.06, ease: 'sine.inOut' }, 1.60);
      tl.to(atkRoot.scale, { x: 1, y: 1, z: 1, duration: 0.08, ease: 'power2.out' }, 1.68);
      // 走回守方格心站定
      tl.to(atkRoot.position, { x: to.x, z: to.z, duration: 0.30, ease: 'power1.inOut' }, 1.46);
      tl.to(atkRoot.rotation, { y: startYaw, duration: 0.22, ease: 'power1.inOut' }, 1.46);

      // ---- 2.00-2.35 守方侧躺尸体整体淡出 ----
      tl.call(() => {
        defMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.35, ease: 'power1.in' }));
      }, [], 2.00);

      // ---- 2.40 收尾：守方隐没 + 攻方精确复位（演出守则 2） ----
      tl.call(() => {
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
      }, [], 2.40);
    });
  }

  window.AttackCinematics = window.AttackCinematics || {};
  window.AttackCinematics.wolf = wolfCinematic;
})();
