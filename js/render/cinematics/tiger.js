/* ============================================================
   虎 · 攻击剧场（虎扑撕咬）
   ------------------------------------------------------------
   注册到 window.AttackCinematics.tiger，由 renderer3d 的
   playAttack3D 在「普通吃子」且攻方为虎时调起。
   只允许通过 ctx + window.AttackFx 触碰场景，不持有 scene/camera。

   分镜（约 2.5s，兜底 4.5s 必 resolve）：
     0.00-0.12  蓄力下蹲（scale.y 压到 0.78，同时冻结选中浮动）
     0.10-0.42  大跳扑击：转向扑击方向 → 抛物线腾空，
                0.42 恰好压到守方格正上方（y 抬升 0.85）
     0.42       撞击：三道白色爪痕弧交错 + 贴地闪光 + 冲击环
                + 碎屑 + 镜头震动(0.6) + 闷响
                守方被拍飞：沿扑击方向抛物线飞出约 0.8 格，
                空中前翻两圈 + 侧滚一圈，落地侧躺；
                等级底座在撞击瞬间「脱盘」淡出（平台被拍碎）
     0.42-0.72  虎随前越过格子，落在守方格前方约 1/3 格处
     0.72       虎落地压扁回弹 + 落地扬尘
     0.94-1.32  低吼：scale 快速脉冲 ×2 + 虎啸音 + 主题色光环
     1.30-1.60  转身走回守方格心站定
     2.05       守方（侧躺尸体）整体淡出
     2.45       守方 visible=false；攻方精确复位到守方格心

   技术点：
     - 攻守双方 rotation.order 都改 'YXZ'：先偏航再俯仰，
       空中翻滚/扑击俯仰方向才与朝向解耦
     - 狼被拍飞的方向 = from→to 单位向量（"远离虎"），落点夹在棋盘内
     - 守方材质提前转 transparent（与 playReverseCinematic 同套路），
       先淡出底座再淡出全身，结束 visible=false，由棋盘稍后移除
     - 结束前用一条慢速 y 保持补间压住选中浮动，避免复位瞬间下坠跳变
   ============================================================ */
(function () {
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function tigerCinematic(ctx) {
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
      const from = atk.from;             // 攻方格心（y=0 平面坐标）
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

      // 扑击方向（from→to 单位向量），狼"远离虎"被拍飞也沿它
      let dx = to.x - from.x, dz = to.z - from.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist; dz /= dist;
      const pounceYaw = Math.atan2(dx, dz);         // 面朝扑击方向所需偏航

      // 虎随前落点（守方格前 ~1/3 格）与狼落地，均夹在棋盘范围内
      const overX = clamp(to.x + dx * 0.32, -3.9, 3.9);
      const overZ = clamp(to.z + dz * 0.32, -2.9, 2.9);
      const flyX = clamp(to.x + dx * 0.8, -3.9, 3.9);
      const flyZ = clamp(to.z + dz * 0.8, -2.9, 2.9);

      const snd = api.sound ? api.sound() : null;
      const themeColor = (ctx.theme && ctx.theme.color) || 0xdf8437;

      /* ---- 守方材质提前转 transparent（先脱盘、后全身淡出） ---- */
      const defMats = [];
      defRoot.traverse(o => {
        if (o.isMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { m.transparent = true; m.needsUpdate = true; defMats.push(m); });
        }
      });
      const discMats = [];   // 等级底座（children[0]）：撞击瞬间"拍碎脱盘"
      const disc = defRoot.children && defRoot.children[0];
      if (disc && disc.isMesh) {
        const mats = Array.isArray(disc.material) ? disc.material : [disc.material];
        mats.forEach(m => discMats.push(m));
      }

      /* ============================================================
         分镜演出
         ============================================================ */

      // ---- 0.00-0.12 蓄力下蹲（压 y 同时冻结选中浮动） ----
      tl.to(atkRoot.scale, { x: 1.06, y: 0.78, z: 1.06, duration: 0.12, ease: 'power2.out' }, 0);
      tl.to(atkRoot.position, { y: aBaseY, duration: 0.12, ease: 'power1.out' }, 0);

      // ---- 0.10-0.42 大跳扑向守方格正上方 ----
      tl.to(atkRoot.rotation, { y: pounceYaw, duration: 0.10, ease: 'power1.inOut' }, 0.10);
      tl.to(atkRoot.position, { x: to.x, z: to.z, duration: 0.30, ease: 'power2.in' }, 0.12);
      tl.to(atkRoot.position, { y: aBaseY + 0.85, duration: 0.30, ease: 'power2.out' }, 0.12);
      tl.to(atkRoot.rotation, { x: -0.50, duration: 0.18, ease: 'power1.out' }, 0.12);   // 抬头挺胸
      tl.to(atkRoot.scale, { x: 0.90, y: 1.12, z: 0.90, duration: 0.20, ease: 'power1.out' }, 0.14);
      tl.call(() => {
        // 后腿蹬地扬尘
        api.smoke({ x: from.x, y: aBaseY, z: from.z }, 0xb08a5a, { count: 3, size: 0.13 });
      }, [], 0.14);

      // ---- 0.42 撞击：爪痕 ×3 + 闪光 + 守方被拍飞 ----
      tl.call(() => {
        const impactW = { x: to.x, y: dBaseY, z: to.z };
        // 三道白色爪痕弧交错（水平面新月弧，角度/半径/扫向各不同）
        api.slash(impactW, pounceYaw - 0.70, 0xffffff, { radius: 0.52, arc: Math.PI * 0.85, sweep: 1.0, thickness: 0.05, life: 0.30 });
        window.gsap.delayedCall(0.05, () =>
          api.slash(impactW, pounceYaw + 0.55, 0xf2f6ff, { radius: 0.60, arc: Math.PI * 0.80, sweep: -0.9, thickness: 0.05, life: 0.30 }));
        window.gsap.delayedCall(0.10, () =>
          api.slash(impactW, pounceYaw + 2.40, 0xffffff, { radius: 0.44, arc: Math.PI * 0.90, sweep: 1.1, thickness: 0.045, life: 0.28 }));
        api.impactFlash(impactW, 'rgba(255,214,150,0.9)', { size: 1.0, life: 0.38 });
        api.flashLight(impactW, 0xffd9a0, 6);
        api.ring(impactW, 0xffffff, { r1: 2.6, life: 0.5 });
        api.burst(impactW, 0xf0c07a, { count: 12, size: 0.05, dist: 0.75 });
        api.shakeCamera(0.6);
        if (snd && snd.impact) snd.impact();
        // 等级底座被拍碎：脱盘淡出，狼身自由翻滚
        discMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.25, ease: 'power1.out' }));

        // 守方抛物线飞出 ~0.8 格：升 0.62 → 落地侧躺（y 抬 0.18 免穿地）
        tl.to(defRoot.position, { x: flyX, z: flyZ, duration: 0.55, ease: 'power1.out' }, 0.42);
        tl.to(defRoot.position, { y: dBaseY + 0.62, duration: 0.25, ease: 'power2.out' }, 0.42);
        tl.to(defRoot.position, { y: dBaseY + 0.18, duration: 0.30, ease: 'power2.in' }, 0.67);
        // 空中翻滚：前翻两圈收在 1.5（侧躺）+ 侧滚一圈收在整圈
        tl.to(defRoot.rotation, { x: 1.5 + Math.PI * 4, duration: 0.55, ease: 'power1.inOut' }, 0.42);
        tl.to(defRoot.rotation, { z: (Math.random() < 0.5 ? -1 : 1) * Math.PI * 2, duration: 0.55, ease: 'power1.inOut' }, 0.42);
      }, [], 0.42);

      // ---- 0.42-0.72 虎随前越过格子，前落 ~1/3 格 ----
      tl.to(atkRoot.position, { x: overX, z: overZ, duration: 0.30, ease: 'power2.out' }, 0.42);
      tl.to(atkRoot.position, { y: aBaseY, duration: 0.30, ease: 'power2.in' }, 0.42);
      tl.to(atkRoot.rotation, { x: 0.45, duration: 0.13, ease: 'power1.in' }, 0.42);     // 低头下扑
      tl.to(atkRoot.rotation, { x: 0, duration: 0.18, ease: 'power2.out' }, 0.55);

      // ---- 0.72 虎落地：压扁回弹 + 扬尘 ----
      tl.call(() => {
        api.smoke({ x: overX, y: aBaseY, z: overZ }, 0xa68b64, { count: 4, size: 0.16 });
        api.burst({ x: overX, y: aBaseY + 0.05, z: overZ }, 0xc9a875, { count: 6, size: 0.04, dist: 0.5 });
      }, [], 0.72);
      tl.to(atkRoot.scale, { x: 1.14, y: 0.80, z: 1.14, duration: 0.10, ease: 'power2.out' }, 0.72);
      tl.to(atkRoot.scale, { x: 1, y: 1, z: 1, duration: 0.10, ease: 'power2.out' }, 0.82);

      // ---- 0.94-1.32 落地低吼：快速脉冲 + 虎啸 + 主题色光环 ----
      tl.call(() => {
        if (snd && snd.play) snd.play(ctx.animal || 'tiger', 'burst');
        api.ring({ x: overX, y: aBaseY, z: overZ }, themeColor, { r1: 1.5, life: 0.4 });
      }, [], 0.94);
      tl.to(atkRoot.scale, { x: 1.05, y: 1.14, z: 1.05, duration: 0.10, ease: 'power2.out' }, 0.94);
      tl.to(atkRoot.scale, { x: 0.97, y: 0.95, z: 0.97, duration: 0.09, ease: 'sine.inOut' }, 1.04);
      tl.to(atkRoot.scale, { x: 1.02, y: 1.08, z: 1.02, duration: 0.09, ease: 'sine.inOut' }, 1.13);
      tl.to(atkRoot.scale, { x: 1, y: 1, z: 1, duration: 0.10, ease: 'power2.out' }, 1.22);

      // ---- 1.30-1.60 转身走回守方格心站定 ----
      tl.to(atkRoot.rotation, { y: startYaw, duration: 0.22, ease: 'power1.inOut' }, 1.30);
      tl.to(atkRoot.position, { x: to.x, z: to.z, duration: 0.30, ease: 'power1.inOut' }, 1.30);
      // 落定小点头
      tl.to(atkRoot.rotation, { x: 0.07, duration: 0.10, ease: 'sine.inOut' }, 1.64);
      tl.to(atkRoot.rotation, { x: 0, duration: 0.14, ease: 'sine.inOut' }, 1.74);

      // ---- 0.97 狼落地（尘土 + 小环 + 轻震） ----
      tl.call(() => {
        api.smoke({ x: flyX, y: dBaseY, z: flyZ }, 0xa68b64, { count: 4, size: 0.16 });
        api.ring({ x: flyX, y: dBaseY, z: flyZ }, 0xcccccc, { r1: 1.8, life: 0.4 });
        api.shakeCamera(0.3);
        if (snd && snd.impact) snd.impact();
      }, [], 0.97);

      // ---- 2.05-2.40 守方侧躺尸体整体淡出 ----
      tl.call(() => {
        defMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.35, ease: 'power1.in' }));
      }, [], 2.05);

      // ---- 1.60-2.42 慢速 y 保持：压住选中浮动，防止复位下坠 ----
      tl.to(atkRoot.position, { y: aBaseY, duration: 0.82, ease: 'none' }, 1.60);

      // ---- 2.42 收尾：守方隐没 + 攻方精确复位（演出守则 2） ----
      tl.call(() => {
        window.gsap.killTweensOf(defRoot.position);
        window.gsap.killTweensOf(defRoot.rotation);
        defRoot.rotation.set(1.5, defStartYaw, 0);
        defRoot.position.set(flyX, dBaseY + 0.18, flyZ);
        defRoot.visible = false;

        window.gsap.killTweensOf(atkRoot.position);
        window.gsap.killTweensOf(atkRoot.rotation);
        window.gsap.killTweensOf(atkRoot.scale);
        atkRoot.position.set(to.x, aBaseY, to.z);
        atkRoot.rotation.set(0, startYaw, 0);
        atkRoot.scale.set(1, 1, 1);
        atkRoot.visible = true;
      }, [], 2.42);
    });
  }

  window.AttackCinematics = window.AttackCinematics || {};
  window.AttackCinematics.tiger = tigerCinematic;
})();
