/* ============================================================
   鼠 · 专属攻击剧场 —— 「影袭缠尾」
   ------------------------------------------------------------
   注册到 window.AttackCinematics.rat，由 renderer3d 的 playAttack3D
   通过 AttackFx.buildCtx 调起（普通吃子 scene=burst/stream/sink）。

   为什么鼠的打法要"灵巧"而不是"力量"：
     鼠是 8 只动物里等级最低（1）、体型最小（模型 scale 0.9）的一只，
     2D 主题色 #9a9590 灰、速度系数 0.5（最快）、动作描述是「尾巴一卷」。
     它唯一能吃的高等级对手是象，而那条线由 playReverseCinematic 的
     专属剧场负责（钻鼻 → 抬脚挣扎 → 痛苦 → 摔倒）。
     所以本剧场负责的是**普通吃子**（鼠吃鼠）——两只同级小兽的缠斗，
     表现上应该是"快、滑、绕后下手"，与虎的压制、象的抛摔形成对比。
     → 分镜取"之字突进绕后 + 尾巴横扫绊倒"，而非正面冲撞。

   分镜（约 2.1s，≤ 4.2s 契约；全场最快的剧场）：
     0.00-0.12  压低蓄势（scale.y 0.82 + 身体微前倾）
     0.10       化影起跳：摆正朝向 + 起点残影 + 一撮尘
     0.10-0.34  之字突进：先向侧向偏 0.22 格 → 再切向守方侧后方 0.30 格
                （两段折线，是"滑不留手"的关键，与猫的直线瞬移区分）
     0.36-0.62  尾巴横扫三下：灰白细弧依次亮起在守方身上，
                各延迟 0.13s，每记配一声轻响
     0.72-0.95  守方被缠住绊倒：侧翻 rotation.z → -1.5 + 弹起再落下
     0.95       落地：轻震 + 小尘 + 闷响
     1.05-1.45  鼠迅速窜回守方格心（比别的动物快 0.1s）
     1.30       守方在烟尘中隐没（早于攻方到位，避免尸体挡住胜利拍）
     1.50-1.66  得意甩尾（身体组偏航 yo-yo 一次）
     1.62-1.92  抖须收势（scale.y 1.06 → 1）
     2.10       攻方精确落位（to 格心 / scale 1 / 可见），resolve

   技术点（与 cat.js 同一套约定）：
     - 动任何 root 前先 killTweensOf(position/scale/rotation)
     - 攻守旋转顺序统一 'YXZ'
     - 全程 y 锁压住渲染循环的选中浮动，用 fromTo + immediateRender，
       且必须在收尾 killTweensOf 之前自然结束（否则吞掉 onComplete）
     - 残影 = root.clone() + 逐 mesh 克隆材质转 opacity，淡出后
       disposeTree + remove，不留 GPU 垃圾
     - 只通过 window.AttackFx 触碰场景，不持有 scene/camera/renderer
   ============================================================ */
(function () {
  function ratCinematic(ctx) {
    return new Promise((resolve) => {
      // settled 守卫：兜底定时器与时间线完成，先到先得，只 resolve 一次
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      window.gsap.delayedCall(4.2, finish);
      const tl = window.gsap.timeline({ onComplete: () => finish() });

      const Fx = window.AttackFx;
      const gsap = window.gsap;
      const atk = ctx && ctx.attacker && ctx.attacker.root;
      const def = ctx && ctx.defender && ctx.defender.root;
      // 攻守任一方拿不到（卡片降级模式）→ 直接交还执行权，由通用演出兜底
      if (!Fx || !gsap || !atk || !def) { finish(); return; }

      const from = ctx.attacker.from || { x: atk.position.x, y: 0, z: atk.position.z };
      const to = ctx.defender.to || { x: def.position.x, y: 0, z: def.position.z };
      const atkBaseY = (ctx.attacker.baseY != null) ? ctx.attacker.baseY : Fx.cellTopY();
      const defBaseY = (ctx.defender.baseY != null) ? ctx.defender.baseY : Fx.cellTopY();

      // ---- 突进方向分解：前向单位向量 (ux,uz) + 垂直侧向量 (px,pz) ----
      const dx = to.x - from.x, dz = to.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const px = -uz, pz = ux;          // 垂直分量，用于之字的第一折
      // 之字中点：前进半程 + 侧偏 0.22 格
      const midX = from.x + ux * 0.5 + px * 0.22;
      const midZ = from.z + uz * 0.5 + pz * 0.22;
      // 绕后落点：守方侧后方 0.30 格
      const behindX = to.x + ux * 0.30;
      const behindZ = to.z + uz * 0.30;
      const faceYaw = Math.atan2(ux, uz);   // 模型面朝 +z 时 rotation.y = 0
      const origYaw = atk.rotation.y;       // 残影保留出发朝向

      // ---- 剧场前置：停旧补间 + 统一旋转顺序 ----
      ['position', 'scale', 'rotation'].forEach((k) => {
        gsap.killTweensOf(atk[k]);
        gsap.killTweensOf(def[k]);
      });
      atk.rotation.order = 'YXZ';
      def.rotation.order = 'YXZ';

      const S = (typeof Fx.sound === 'function') ? Fx.sound() : null;
      const topY = (typeof Fx.cellTopY === 'function') ? Fx.cellTopY() : 0.04;
      // children[0] 是底座、children[1] 是动物身体组（见 animals3d.js 的 buildPiece）
      const atkBody = atk.children && atk.children[1];

      // 音效播放包一层 try：音效失败绝不能中断演出
      const safePlay = (fn) => { if (fn) { try { fn(); } catch (e) { /* 静默 */ } } };

      /**
       * 残影：克隆本体 + 逐 mesh 克隆材质转半透明
       * 必须克隆材质，否则改 opacity 会污染本体的共享材质，把真身也变透明
       */
      function spawnGhost() {
        const ghost = atk.clone();
        const mats = [];
        ghost.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = false;
          const cloneMat = (m) => {
            const c = m.clone();
            c.transparent = true;
            c.opacity = 0.32;
            c.depthWrite = false;
            return c;
          };
          o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.push(m));
        });
        ghost.position.set(from.x, atkBaseY, from.z);
        ghost.rotation.set(0, origYaw, 0);
        ghost.scale.set(1.02, 0.9, 1.02);
        Fx.add(ghost, 1.0);
        gsap.to(mats, {
          opacity: 0, duration: 0.3, delay: 0.5, ease: 'power1.in',
          onComplete: () => { Fx.disposeTree(ghost); Fx.remove(ghost); }
        });
      }

      // ---- 全程 y 锁 ----
      // 渲染循环对"选中棋子"每帧写 position.y，仅在 gsap.isTweening(position)
      // 为 false 时生效。用一条贯穿全程的 y 保持补间让 isTweening 恒为 true，
      // 鼠在蓄势/抖须这些没有位移补间的阶段才不会悬浮离地。
      // 用 fromTo 而非 to：补间懒启动，构造到首个 tick 之间渲染循环还会写一次
      // y，to 会把脏值记成起点导致缓沉；fromTo 两端锁死。
      // duration 2.02 → 在 2.10 的收尾 killTweensOf 之前自然结束。
      tl.fromTo(atk.position, { y: atkBaseY }, { y: atkBaseY, duration: 2.02, ease: 'none', immediateRender: true }, 0);

      // ---- 0.00-0.12 压低蓄势：压扁 + 身体微前倾 ----
      if (atkBody) tl.to(atkBody.rotation, { x: 0.14, duration: 0.12, ease: 'power2.out' }, 0);
      tl.to(atk.scale, { x: 1.05, y: 0.82, z: 1.05, duration: 0.12, ease: 'power2.out' }, 0);

      // ---- 0.10 化影起跳：摆正朝向 + 残影 + 起点尘 ----
      tl.call(() => {
        atk.rotation.y = faceYaw;
        spawnGhost();
        Fx.smoke({ x: from.x, y: topY, z: from.z }, 0x9a9590, { count: 2, size: 0.08 });
      }, [], 0.10);

      // ---- 0.10-0.34 之字突进：两段折线 ----
      // 第一折：向侧向偏出去（身体压扁成一道影）
      tl.to(atk.position, { x: midX, z: midZ, duration: 0.12, ease: 'power2.in' }, 0.10);
      tl.to(atk.scale, { x: 1.10, y: 0.60, z: 1.10, duration: 0.06, ease: 'power2.out' }, 0.10);
      // 第二折：切向守方侧后方
      tl.to(atk.position, { x: behindX, z: behindZ, duration: 0.12, ease: 'power2.in' }, 0.22);
      tl.call(() => {
        Fx.smoke({ x: behindX, y: topY, z: behindZ }, 0x9a9590, { count: 2, size: 0.08 });
      }, [], 0.34);
      if (atkBody) tl.to(atkBody.rotation, { x: 0, duration: 0.1, ease: 'power2.out' }, 0.34);
      tl.to(atk.scale, { x: 1, y: 1, z: 1, duration: 0.12, ease: 'back.out(1.6)' }, 0.36);

      // ---- 0.36 / 0.49 / 0.62 尾巴横扫三下 ----
      // 用 slash 画细长灰白弧（尾巴的视觉替身）——不直接操作模型里的尾节点，
      // 那样会依赖 animals3d 的内部结构，脆且难维护。
      [0, 1, 2].forEach((i) => {
        tl.call(() => {
          const ang = -0.45 + i * 0.55;
          Fx.slash(
            { x: to.x, y: defBaseY + 0.09 + i * 0.05, z: to.z }, ang, 0xb9b4ae,
            { radius: 0.30 + i * 0.035, arc: Math.PI * 0.68, sweep: 0.8, thickness: 0.03, life: 0.24 }
          );
          Fx.burst({ x: to.x, y: defBaseY + 0.14 + i * 0.05, z: to.z }, 0xd8d3cc,
            { count: 3, size: 0.022, dist: 0.24 });
          safePlay(S && (() => S.play('rat', 'burst')));
        }, [], 0.36 + i * 0.13);
      });

      // ---- 0.72-0.95 守方被缠住绊倒：侧翻（绕自身前向轴翻滚） ----
      // 用 rotation.z 而不是像猫那样用 rotation.x：
      // 鼠是"绊"，倒向侧面；猫是"吓僵后直挺挺后仰"，两者倒下姿态要能区分。
      tl.to(def.rotation, { z: def.rotation.z - 1.5, duration: 0.23, ease: 'power2.in' }, 0.72);
      tl.to(def.position, { y: defBaseY + 0.16, duration: 0.10, ease: 'power1.out' }, 0.72);
      tl.to(def.position, { y: defBaseY + 0.06, duration: 0.13, ease: 'power1.in' }, 0.82);
      tl.call(() => {
        Fx.smoke({ x: to.x, y: topY, z: to.z }, 0xa8a49e, { count: 3, size: 0.11 });
        Fx.shakeCamera(0.32);
        safePlay(S && (() => S.impact()));
      }, [], 0.95);

      // ---- 1.30 守方隐没 ----
      // 早于攻方到位（1.45）：侧翻的尸体朝攻方身后延伸，不提前隐没会挡住
      // 之后"甩尾/抖须"的胜利拍。
      tl.call(() => {
        gsap.killTweensOf(def.position);
        Fx.smoke({ x: to.x, y: topY + 0.04, z: to.z }, 0x8f8a84, { count: 4, size: 0.12 });
        def.visible = false;
      }, [], 1.30);

      // ---- 1.05-1.45 鼠迅速窜回守方格心（比别的动物快 0.1s，呼应"最快"设定）----
      tl.to(atk.position, { x: to.x, z: to.z, duration: 0.40, ease: 'power1.inOut' }, 1.05);

      // ---- 1.50-1.66 得意甩尾（身体组偏航 yo-yo，底座不动）----
      const flickTarget = atkBody ? atkBody.rotation : atk.rotation;
      tl.to(flickTarget, {
        y: atkBody ? 0.32 : faceYaw + 0.28,
        duration: 0.16, ease: 'sine.inOut', yoyo: true, repeat: 1
      }, 1.50);

      // ---- 1.62-1.92 抖须收势：微伸 1.06 再收回 ----
      tl.to(atk.scale, { y: 1.06, duration: 0.15, ease: 'power2.out' }, 1.62);
      tl.to(atk.scale, { y: 1, duration: 0.15, ease: 'power2.in' }, 1.77);

      // ---- 2.10 攻方精确落位 ----
      // 此时 y 锁（2.02 结束）与甩尾/抖须补间均已自然结束，
      // killTweensOf 只清理已完成的子补间，不会吞掉时间线的 onComplete。
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
      }, [], 2.10);
    });
  }

  window.AttackCinematics = window.AttackCinematics || {};
  window.AttackCinematics.rat = ratCinematic;
})();
