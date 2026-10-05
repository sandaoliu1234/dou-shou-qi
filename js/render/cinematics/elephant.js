/* ============================================================
   象 · 专属攻击剧场「象鼻抛飞」
   ------------------------------------------------------------
   注册到 window.AttackCinematics.elephant，由 renderer3d 的
   playAttack3D 通过 AttackFx.buildCtx 调起（普通吃子 scene=burst）。

   分镜（约 2.8s，≤ 4.2s 上限）：
     0.00-0.30  象前倾低头卷鼻蓄力（rotation.x 前倾 + 身体前移 0.1 格 + 压缩）
     0.30       甩鼻抛飞：鼻尖尘风 + 起抛亮光 + 象鸣；守方被卷起抛上天
                —— 抛物线（最高 +1.5）、向远离象方向水平飞 1.2 格、
                   rotation.x / z 各自转 2 圈
     1.16       重摔落地：强震 shakeCamera(0.85) + 尘土 fxSmoke×4 +
                fxBurst 碎屑 + fxRing 冲击环 + impactFlash + 闷响
     1.18-1.55  守方弹起后躺平（仰面 rotation.x ≈ -1.5 + 微弹）
     1.62-2.10  象仰头长鸣收势（前倾回正 → 后仰 -0.3 → y 小弹两下 + 二声象鸣）
     2.15-2.60  象走回守方格心站定（落地压弹一次）
     2.50/2.78  守方 visible=false；攻方精确复位到 to 格心，resolve

   技术点：
     - 动 root 前一律 killTweensOf，避免与选中浮动/旧补间打架
     - 组合偏航+俯仰前 root.rotation.order = 'YXZ'
     - 翻滚角度以 4π（整 2 圈）收尾，与后续躺平补间视觉连续无回卷
     - 攻方 position 全程保持至少一个活跃补间，压掉选中浮动
     - 只通过 window.AttackFx 触碰场景，不持有 scene/camera/renderer
   ============================================================ */
(function () {
  function elephantCinematic(ctx) {
    return new Promise((resolve) => {
      const FX = window.AttackFx;
      const gsap = window.gsap;
      const THREE = window.THREE;
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      window.gsap.delayedCall(4.5, finish);
      const tl = window.gsap.timeline({ onComplete: () => finish() });

      const atk = ctx.attacker && ctx.attacker.root;
      const def = ctx.defender && ctx.defender.root;
      if (!atk || !def || !FX || !gsap || !THREE) { finish(); return; }

      const atkBaseY = ctx.attacker.baseY || FX.cellTopY();
      const defBaseY = ctx.defender.baseY || FX.cellTopY();
      const from = ctx.attacker.from;
      const to = ctx.defender.to;

      // 抛飞方向：远离象的一侧；落点 = 目标格外延 1.2 格
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const land = { x: to.x + ux * 1.2, z: to.z + uz * 1.2 };
      const groundY = FX.cellTopY();          // 0.04 格子顶面
      const faceYaw = Math.atan2(dx, dz);     // 模型面朝 +z，偏航指向甩飞方向
      const sound = FX.sound();

      // ---- 剧场前置：停旧补间 + 旋转顺序 ----
      gsap.killTweensOf(atk.position);
      gsap.killTweensOf(def.position);
      atk.rotation.order = 'YXZ';   // 偏航 + 俯仰组合，先偏航
      def.rotation.order = 'YXZ';

      /* ---- 0.00-0.30 蓄力：前倾低头 + 身体前移 + 压缩 ---- */
      tl.to(atk.rotation, { y: faceYaw, duration: 0.24, ease: 'power1.inOut' }, 0);
      tl.to(atk.rotation, { x: 0.15, duration: 0.28, ease: 'power2.in' }, 0);
      tl.to(atk.position, {
        x: from.x + ux * 0.1, z: from.z + uz * 0.1,
        y: atkBaseY - 0.015, duration: 0.28, ease: 'power2.in'
      }, 0);
      tl.to(atk.scale, { x: 1.03, y: 0.94, z: 1.03, duration: 0.28, ease: 'power2.in' }, 0);
      // 蓄力保持补间：让选中浮动循环让位（isTweening = true 直到开步）
      tl.to(atk.position, { y: atkBaseY - 0.015, duration: 1.85, ease: 'none' }, 0.30);

      /* ---- 0.30 甩鼻抛飞 ---- */
      tl.call(() => {
        // 象鼻尖世界坐标（模型面朝 +z，鼻尖约在 (0, 0.12, 0.55)）
        const tip = atk.localToWorld(new THREE.Vector3(0, 0.12, 0.55));
        FX.smoke({ x: tip.x, y: tip.y, z: tip.z }, 0xb0a08a, { count: 3, size: 0.12 });
        FX.slash({ x: to.x, y: groundY, z: to.z }, Math.atan2(uz, ux), 0xd9c9a8,
          { radius: 0.5, arc: Math.PI * 0.85, sweep: 1.3, life: 0.35, thickness: 0.045 });
        FX.ring({ x: from.x, y: groundY, z: from.z }, 0xd9c9a8, { r1: 1.6, life: 0.4 });
        FX.flashLight({ x: to.x, y: groundY + 0.06, z: to.z }, 0xffe9c0, 6);
        if (sound) sound.play('elephant', 'burst');   // 象鸣①：抛飞长鸣
      }, [], 0.30);

      // 象鼻回弹（甩鞭收势）
      tl.to(atk.rotation, { x: -0.12, duration: 0.16, ease: 'power3.out' }, 0.30);
      tl.to(atk.scale, { x: 1, y: 1, z: 1, duration: 0.22, ease: 'back.out(2)' }, 0.30);

      // 守方抛物线：升 1.5 → 摔回地面；水平飞 1.2 格；空翻两周 + 侧滚两周
      tl.to(def.position, { y: defBaseY + 1.5, duration: 0.42, ease: 'power2.out' }, 0.30);
      tl.to(def.position, { y: defBaseY, duration: 0.44, ease: 'power2.in' }, 0.72);
      tl.to(def.position, { x: land.x, z: land.z, duration: 0.86, ease: 'power1.out' }, 0.30);
      tl.to(def.rotation, { x: def.rotation.x + Math.PI * 4, duration: 0.86, ease: 'power1.in' }, 0.30);
      tl.to(def.rotation, { z: def.rotation.z + Math.PI * 4, duration: 0.86, ease: 'power1.in' }, 0.30);

      /* ---- 1.16 重摔落地：强震 + 尘土 + 碎屑 + 冲击环 ---- */
      tl.call(() => {
        const P = { x: land.x, y: groundY + 0.04, z: land.z };
        FX.shakeCamera(0.85);
        FX.impactFlash(P, 'rgba(255,225,180,0.9)', { size: 1.0, life: 0.38 });
        FX.ring(P, 0xffffff, { r1: 2.8, life: 0.5 });
        FX.burst(P, 0x9a8a76, { count: 12, size: 0.05, dist: 0.7 });
        // 尘土 ×4：中心一大坨 + 三向余尘
        FX.smoke(P, 0xa68b64, { count: 3, size: 0.2 });
        FX.smoke({ x: land.x + 0.25, y: groundY, z: land.z + 0.15 }, 0xb59a78, { count: 2, size: 0.16 });
        FX.smoke({ x: land.x - 0.22, y: groundY, z: land.z - 0.18 }, 0x9a8060, { count: 2, size: 0.15 });
        FX.smoke({ x: land.x + 0.1, y: groundY, z: land.z - 0.25 }, 0xa68b64, { count: 2, size: 0.14 });
        if (sound) sound.impact();   // 闷响
      }, [], 1.16);

      /* ---- 1.18-1.55 弹起后躺平（仰面朝天，身体抬离地面防穿模） ---- */
      tl.to(def.position, { y: defBaseY + 0.16, duration: 0.12, ease: 'power1.out' }, 1.18);
      // 翻滚收尾恰好停在 4π ≡ 0，接着向后翻 1.45 rad 变成仰面躺平，视觉连续
      tl.to(def.rotation, { x: def.rotation.x - 1.45, duration: 0.30, ease: 'power2.in' }, 1.18);
      tl.to(def.rotation, { z: def.rotation.z + 0.1, duration: 0.30, ease: 'sine.inOut' }, 1.18);
      tl.to(def.position, { y: defBaseY + 0.10, duration: 0.25, ease: 'power2.in' }, 1.30);
      // 躺平微弹 + 尘埃落定
      tl.to(def.position, { y: defBaseY + 0.13, duration: 0.08, ease: 'power1.out' }, 1.55);
      tl.to(def.position, { y: defBaseY + 0.10, duration: 0.12, ease: 'power1.in' }, 1.63);
      tl.to(def.rotation, { z: def.rotation.z + 0.06, duration: 0.14, ease: 'sine.inOut' }, 1.55);

      /* ---- 1.62-2.10 象仰头长鸣收势：前倾回正 → 后仰 + y 小弹两下 ---- */
      tl.to(atk.rotation, { x: -0.3, duration: 0.20, ease: 'power2.out' }, 1.62);
      tl.to(atk.position, { y: atkBaseY + 0.06, duration: 0.12, ease: 'power2.out' }, 1.62);
      tl.to(atk.position, { y: atkBaseY - 0.015, duration: 0.12, ease: 'power2.in' }, 1.74);
      tl.to(atk.position, { y: atkBaseY + 0.04, duration: 0.10, ease: 'power2.out' }, 1.86);
      tl.to(atk.position, { y: atkBaseY - 0.015, duration: 0.10, ease: 'power2.in' }, 1.96);
      tl.call(() => {
        if (sound) sound.play('elephant', 'burst');   // 象鸣②：仰头收势
        FX.ring({ x: from.x, y: groundY, z: from.z }, 0xffd76a, { r1: 2.0, life: 0.45 });
        FX.smoke({ x: from.x + ux * 0.3, y: groundY + 0.02, z: from.z + uz * 0.3 },
          0xb0a08a, { count: 2, size: 0.12 });
      }, [], 1.66);
      tl.to(atk.rotation, { x: 0, duration: 0.22, ease: 'power2.inOut' }, 1.95);

      /* ---- 2.15-2.60 象走回守方格心站定 ---- */
      tl.call(() => {
        FX.smoke({ x: from.x + ux * 0.15, y: groundY, z: from.z + uz * 0.15 },
          0x9a8a76, { count: 2, size: 0.1 });   // 起步扬尘
      }, [], 2.15);
      tl.to(atk.position, { x: to.x, z: to.z, duration: 0.42, ease: 'power1.inOut' }, 2.15);
      tl.to(atk.position, { y: atkBaseY, duration: 0.42, ease: 'power1.inOut' }, 2.15);
      tl.to(atk.rotation, { x: 0, y: faceYaw, z: 0, duration: 0.30, ease: 'power1.inOut' }, 2.15);
      // 落步压弹
      tl.to(atk.scale, { y: 0.92, duration: 0.07, ease: 'power2.out' }, 2.57);
      tl.to(atk.scale, { y: 1, duration: 0.12, ease: 'back.out(2)' }, 2.64);
      tl.to(atk.position, { y: atkBaseY, duration: 0.12, ease: 'none' }, 2.66);   // 压住浮动直到复位

      /* ---- 2.50 守方退场 / 2.78 攻方精确复位 ---- */
      tl.call(() => {
        gsap.killTweensOf(def.position);
        def.visible = false;
      }, [], 2.50);
      tl.call(() => {
        gsap.killTweensOf(atk.position);
        atk.position.set(to.x, atkBaseY, to.z);
        atk.scale.set(1, 1, 1);
        atk.rotation.set(0, faceYaw, 0);
        atk.visible = true;
      }, [], 2.78);
    });
  }
  window.AttackCinematics = window.AttackCinematics || {};
  window.AttackCinematics.elephant = elephantCinematic;
})();
