/* ============================================================
   猫 · 专属攻击剧场 —— 「猫爪定身」
   ------------------------------------------------------------
   分镜（约 2.5s，≤ 4.2s 契约）：
     0.00-0.15  压低蓄势（scale.y 0.85 + 身体前倾暗示）
     0.15-0.27  化作一道影瞬移：直线掠过守方，落在其后方 0.35 格
                （起点留一道半透明残影，起跳/落地各一撮小尘）
     0.30-0.66  三道粉色细爪痕依次亮起在守方身上（角度 -0.4/0.5/1.4，
                thickness 0.035，各延迟 0.12s），每道配一声轻"喵"
     0.70-1.00  守方吓僵：scale 膨胀到 1.06 后定住一拍
     1.00-1.45  守方直挺挺向后倒（rotation.x → -1.5，木板式无缓冲）
                + 落地小尘土 + 轻震
     1.62       守方在小烟尘中隐没（visible = false，提前于收尾——
                后倒的身体会挡住走回的猫，见下方 hide 处注释）
     1.40-1.80  猫优雅走回守方格心坐定
     1.85-2.41  甩尾一下（身体组 rotation.y 摆 0.35 再回，底座不动）
     1.95-2.25  胜利理毛姿态（scale.y 微伸 1.05 再收回）
     2.50       攻方精确落位（to 格心 / scale 1 / 可见），resolve
   技术点：
     - 动任何 root 前先 killTweensOf(position/scale/rotation)
     - 攻守旋转顺序统一 'YXZ'（守方后倒 = 绕自身横轴的俯仰）
     - 渲染循环对"选中棋子"有每帧浮动（isTweening 为 false 时才写 y），
       用一条全程 fromTo y 锁压住，详见 y 锁处注释
     - 残影 = root.clone() + 逐 mesh 克隆材质转 opacity 0.35
       （克隆材质是为了不污染本体共享材质），AttackFx.add 挂特效层，
       淡出完成后 disposeTree + remove，不留 GPU 垃圾
     - 守方后倒方向：模型面朝攻方，rotation.x = -1.5 恒为
       "仰面倒向自身背后"，与阵营无关
     - 全程只通过 window.AttackFx 触碰场景，不持有 scene/camera/renderer
   ============================================================ */
(function () {
  function catCinematic(ctx) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      window.gsap.delayedCall(4.5, finish);   // 兜底：时间线卡死也能交还执行权
      const tl = window.gsap.timeline({ onComplete: () => finish() });

      const Fx = window.AttackFx;
      const gsap = window.gsap;
      const atk = ctx && ctx.attacker && ctx.attacker.root;
      const def = ctx && ctx.defender && ctx.defender.root;
      if (!Fx || !gsap || !atk || !def) { finish(); return; }

      const from = ctx.attacker.from || { x: atk.position.x, y: 0, z: atk.position.z };
      const to = ctx.defender.to || { x: def.position.x, y: 0, z: def.position.z };
      const atkBaseY = (ctx.attacker.baseY != null) ? ctx.attacker.baseY : Fx.cellTopY();
      const defBaseY = (ctx.defender.baseY != null) ? ctx.defender.baseY : Fx.cellTopY();

      // 冲锋方向（棋盘平面单位向量）与"穿过守方"的落点（背后 0.35 格）
      const dx = to.x - from.x, dz = to.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const behindX = to.x + ux * 0.35, behindZ = to.z + uz * 0.35;
      const faceYaw = Math.atan2(ux, uz);   // 模型面朝 +z 时 rotation.y = 0
      const origYaw = atk.rotation.y;       // 残影保留出发时的朝向

      // 动 root 前先停掉飞行中的补间；剧场旋转顺序：先偏航后俯仰
      ['position', 'scale', 'rotation'].forEach((k) => {
        gsap.killTweensOf(atk[k]);
        gsap.killTweensOf(def[k]);
      });
      atk.rotation.order = 'YXZ';
      def.rotation.order = 'YXZ';

      const S = (typeof Fx.sound === 'function') ? Fx.sound() : null;
      const topY = (typeof Fx.cellTopY === 'function') ? Fx.cellTopY() : 0.04;
      const atkBody = atk.children && atk.children[1];   // 动物身体组（children[0] 是底座）

      const safePlay = (fn) => { if (fn) { try { fn(); } catch (e) { /* 音效失败不影响演出 */ } } };

      // ---- 残影：克隆本体、逐 mesh 克隆材质转半透明（不污染本体共享材质）----
      function spawnGhost() {
        const ghost = atk.clone();
        const mats = [];
        ghost.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = false;
          const cloneMat = (m) => {
            const c = m.clone();
            c.transparent = true;
            c.opacity = 0.35;
            c.depthWrite = false;
            return c;
          };
          o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.push(m));
        });
        ghost.position.set(from.x, atkBaseY, from.z);
        ghost.rotation.set(0, origYaw, 0);
        ghost.scale.set(1.04, 0.88, 1.04);
        Fx.add(ghost, 1.0);
        gsap.to(mats, {
          opacity: 0, duration: 0.35, delay: 0.45, ease: 'power1.in',
          onComplete: () => { Fx.disposeTree(ghost); Fx.remove(ghost); }
        });
      }

      // ---- 全程 y 锁（压住渲染循环的选中浮动）----
      // 渲染循环对"选中棋子"每帧写 position.y = baseY+0.06+sin(t)*0.03，
      // 仅在 gsap.isTweening(position) 为 false 时生效。用一条贯穿全程的
      // y 保持补间让 isTweening 恒为 true，猫在蓄势/定身/理毛等
      // 没有位移补间的阶段才不会悬浮离地。
      // 用 fromTo（而非 to）：补间是懒启动的，构造后到首个 gsap tick 之间
      // 渲染循环还会写一次 y，to 会把那个脏值记成起点导致猫缓慢下沉；
      // fromTo 两端锁死且 immediateRender 立即把 y 按回地面。
      // 注意：必须在收尾 killTweensOf 之前结束（2.45），否则在时间线
      // 运行中杀死活跃子补间会吞掉 onComplete，剧场要拖到 4.5s 兜底才交权。
      tl.fromTo(atk.position, { y: atkBaseY }, { y: atkBaseY, duration: 2.45, ease: 'none', immediateRender: true }, 0);

      // ---- 0.00-0.15 压低蓄势 ----
      if (atkBody) tl.to(atkBody.rotation, { x: 0.12, duration: 0.14, ease: 'power2.out' }, 0);
      tl.to(atk.scale, { x: 1.06, y: 0.85, z: 1.06, duration: 0.14, ease: 'power2.out' }, 0);

      // ---- 0.15 化影起跳：摆正朝向 + 起点残影 + 起跳尘 ----
      tl.call(() => {
        atk.rotation.y = faceYaw;
        spawnGhost();
        Fx.smoke({ x: from.x, y: topY, z: from.z }, 0xb9a58f, { count: 2, size: 0.09 });
      }, [], 0.15);

      // ---- 0.15-0.27 瞬移穿过守方（压扁成一道影）----
      tl.to(atk.position, { x: behindX, z: behindZ, duration: 0.12, ease: 'power2.in' }, 0.15);
      tl.to(atk.scale, { x: 1.12, y: 0.62, z: 1.12, duration: 0.06, ease: 'power2.out' }, 0.15);
      tl.call(() => {
        Fx.smoke({ x: behindX, y: topY, z: behindZ }, 0xb9a58f, { count: 2, size: 0.09 });
      }, [], 0.27);
      if (atkBody) tl.to(atkBody.rotation, { x: 0, duration: 0.1, ease: 'power2.out' }, 0.27);
      tl.to(atk.scale, { x: 1, y: 1, z: 1, duration: 0.12, ease: 'back.out(1.6)' }, 0.28);

      // ---- 0.30/0.42/0.54 三道粉色细爪痕依次亮起 + 轻喵 ----
      [-0.4, 0.5, 1.4].forEach((angle, i) => {
        tl.call(() => {
          Fx.slash(
            { x: to.x, y: defBaseY + 0.10 + i * 0.055, z: to.z }, angle, 0xf29cb4,
            { radius: 0.32 + i * 0.04, arc: Math.PI * 0.72, sweep: 0.85, thickness: 0.035, life: 0.26 }
          );
          Fx.burst({ x: to.x, y: defBaseY + 0.16 + i * 0.055, z: to.z }, 0xf29cb4,
            { count: 4, size: 0.025, dist: 0.28 });
          safePlay(S && (() => S.play('cat', 'burst')));
        }, [], 0.30 + i * 0.12);
      });

      // ---- 0.70-1.00 守方吓僵：膨胀 1.06 定住一拍 ----
      tl.to(def.scale, { x: 1.06, y: 1.06, z: 1.06, duration: 0.08, ease: 'power3.out' }, 0.70);

      // ---- 1.00-1.45 木板式后倒（无缓冲）----
      tl.to(def.scale, { x: 1, y: 1, z: 1, duration: 0.10, ease: 'power1.in' }, 1.00);
      tl.to(def.rotation, { x: -1.5, duration: 0.35, ease: 'power2.in' }, 1.00);
      tl.to(def.position, { y: defBaseY + 0.20, duration: 0.35, ease: 'power1.in' }, 1.00);
      tl.to(def.position, { y: defBaseY + 0.08, duration: 0.12, ease: 'power1.out' }, 1.35);
      tl.call(() => {
        Fx.smoke({ x: to.x, y: topY, z: to.z + uz * 0.22 }, 0xa68b64, { count: 3, size: 0.12 });
        Fx.shakeCamera(0.3);
        safePlay(S && (() => S.impact()));
      }, [], 1.35);

      // ---- 1.62 守方在小烟尘中隐没 ----
      // 比契约的"结束前"提前：守方后倒的身体恰好挡住走回格心的攻方
      // （rx=-1.5 的几何决定了身体朝攻方身后延伸），不提前隐没的话
      // 甩尾/理毛的胜利拍会被粉色身子整个挡住。烟尘掩护消失。
      tl.call(() => {
        gsap.killTweensOf(def.position);
        Fx.smoke({ x: to.x, y: topY + 0.05, z: to.z + uz * 0.18 }, 0x8f8a84, { count: 4, size: 0.13 });
        def.visible = false;
      }, [], 1.62);

      // ---- 1.40-1.80 猫优雅走回守方格心 ----
      tl.to(atk.position, { x: to.x, z: to.z, duration: 0.4, ease: 'power1.inOut' }, 1.40);

      // ---- 1.85-2.41 甩尾一下（身体组绕偏航摆 0.35 再回，底座不动）----
      // 摆身体组而不是整 root：底座保持不动，尾/臀的扭动更像"甩尾"，
      // 俯视镜头下也看得清；atkBody 缺失时退化为 root 摆 0.3。
      const flickTarget = atkBody ? atkBody.rotation : atk.rotation;
      tl.to(flickTarget, { y: atkBody ? 0.35 : faceYaw + 0.3, duration: 0.28, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 1.85);

      // ---- 1.95-2.25 胜利理毛：微伸 1.05 再收回 ----
      tl.to(atk.scale, { y: 1.05, duration: 0.15, ease: 'power2.out' }, 1.95);
      tl.to(atk.scale, { y: 1, duration: 0.15, ease: 'power2.in' }, 2.10);

      // ---- 2.50 攻方精确落位 ----
      // 此时 y 锁 / 甩尾 / 理毛补间都已自然结束，killTweensOf 只会清理
      // 已完成的子补间，不会打断时间线的 onComplete。
      tl.call(() => {
        gsap.killTweensOf(atk.position);
        gsap.killTweensOf(atk.scale);
        gsap.killTweensOf(atk.rotation);
        if (atkBody) gsap.killTweensOf(atkBody.rotation);
        atk.position.set(to.x, atkBaseY, to.z);
        atk.scale.set(1, 1, 1);
        atk.rotation.set(0, faceYaw, 0);
        if (atkBody) atkBody.rotation.set(0, 0, 0);
        atk.visible = true;
      }, [], 2.50);
    });
  }

  window.AttackCinematics = window.AttackCinematics || {};
  window.AttackCinematics.cat = catCinematic;
})();
