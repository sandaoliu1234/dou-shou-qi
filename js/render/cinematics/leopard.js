/* ============================================================
   豹 · 攻击剧场 —— 「豹影三连袭」
   ------------------------------------------------------------
   注册到 window.AttackCinematics.leopard，由 renderer3d 的
   playAttack3D 在「普通吃子」且攻方为豹时调起。
   只允许通过 ctx + window.AttackFx 触碰场景，不持有 scene/camera。

   分镜（约 2.6s，兜底 4.5s 必 resolve）：
     0.00-0.15  压低蓄势（scale.y 0.85 + 身体前倾）+ 转头锁定猎物
     0.15-0.73  三连瞬移（每次直线闪现 0.08s）：守方左侧 → 右侧 → 后方，
                每次瞬移——
                · 原地留半透明残影（clone + 逐 mesh 克隆材质，0.3s 淡出）
                · 到位一击：细白爪痕扫过守方（thickness 0.04，朝向守方）
                · 守方被击中抖动（小弹 + rotation.y 累计 1/3 圈）
                · shakeCamera(0.25) 快速三连 + impact 闷响
     0.73-1.10  第三击击瘫：守方 scale.y 压到 0.4 弹回，
                rotation.x ≈ 1.5 侧倒躺平（偏航补完整一圈），
                扬尘 + 小碎屑 + 冲击环；等级底座同步脱盘淡出
     1.10-1.55  豹从「后方」瞬移回守方格心（第四道残影），
                落地收势：scale 回弹站直 + 主题色小环 + 豹啸
     1.55-1.80  收势小点头
     2.05-2.40  守方尸体整体淡出
     2.50       守方 visible=false；攻方精确复位到守方格心

   技术点：
     - 攻守 rotation.order = 'YXZ'（先偏航后俯仰，演出守则 3）
     - 守方位姿补间全部在 tl.call 回调里动态排入：每次击中都先
       killTweensOf 再补间，预排在 timeline 上的守方补间会被中途的
       kill 连带误杀（演出守则 1 的坑）——所以守方一个预排补间都没有
     - 残影 = root.clone() + 逐 mesh 克隆材质转 opacity 0.35
       （clone 共享材质，直接改会把本体一起变透明），AttackFx.add
       挂特效层，淡出完成后 disposeTree + remove，不留 GPU 垃圾
     - 全程 y 锁（fromTo immediateRender）：渲染循环对选中棋子每帧写
       position.y（isTweening 为 false 时），y 锁让蓄势/瞬移阶段不悬浮
     - 爪痕弧平分线指向「守方 → 豹的闪现来向」，弧面兜住守方
   ============================================================ */
(function () {
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function leopardCinematic(ctx) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      window.gsap.delayedCall(4.5, finish);   // 兜底，超时也必须 resolve
      const tl = window.gsap.timeline({ onComplete: () => finish() });

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
      const from = atk.from;
      const to = def.to;
      const aBaseY = (atk.baseY != null) ? atk.baseY : api.cellTopY();
      const dBaseY = (def.baseY != null) ? def.baseY : api.cellTopY();

      /* ---- 前置清理：接管攻守 root 的位姿（演出守则 1） ---- */
      ['position', 'rotation', 'scale'].forEach(k => {
        window.gsap.killTweensOf(atkRoot[k]);
        window.gsap.killTweensOf(defRoot[k]);
      });
      // 剧场旋转顺序：先偏航后俯仰（演出守则 3）
      atkRoot.rotation.order = 'YXZ';
      defRoot.rotation.order = 'YXZ';

      const startYaw = atkRoot.rotation.y;       // 攻方原始朝向（收尾复位用）
      const defStartYaw = defRoot.rotation.y;
      const atkBody = atkRoot.children && atkRoot.children[1];   // 动物身体组

      // 突袭主方向（from→to 单位向量）与垂直侧向
      let dx = to.x - from.x, dz = to.z - from.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist; dz /= dist;
      const px = -dz, pz = dx;
      // 从 pos 面朝守方所需偏航（模型面朝 +z 时 rotation.y = 0）
      const faceYaw = (pos) => Math.atan2(to.x - pos.x, to.z - pos.z);

      // 三个闪现落点：守方左侧 → 右侧 → 后方（夹在棋盘范围内）
      const sideL = { x: clamp(to.x + px * 0.42, -3.9, 3.9), z: clamp(to.z + pz * 0.42, -2.9, 2.9) };
      const sideR = { x: clamp(to.x - px * 0.42, -3.9, 3.9), z: clamp(to.z - pz * 0.42, -2.9, 2.9) };
      const back  = { x: clamp(to.x + dx * 0.46, -3.9, 3.9), z: clamp(to.z + dz * 0.46, -2.9, 2.9) };

      const snd = (typeof api.sound === 'function') ? api.sound() : null;
      const themeColor = (ctx.theme && ctx.theme.color) || 0xd4bb4e;
      const safePlay = (fn) => { if (fn) { try { fn(); } catch (e) { /* 音效失败不影响演出 */ } } };

      /* ---- 守方材质提前转 transparent（收尾淡出）+ 底座单独收集 ---- */
      const defMats = [];
      defRoot.traverse(o => {
        if (o.isMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { m.transparent = true; defMats.push(m); });
        }
      });
      const discMats = [];   // 等级底座（children[0]）：击瘫瞬间"脱盘"
      const disc = defRoot.children && defRoot.children[0];
      if (disc && disc.isMesh) {
        const mats = Array.isArray(disc.material) ? disc.material : [disc.material];
        mats.forEach(m => discMats.push(m));
      }

      /* ---- 残影：克隆本体（捕获当前位姿）、逐 mesh 克隆材质转半透明 ---- */
      function spawnGhost() {
        const ghost = atkRoot.clone();
        const gMats = [];
        ghost.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = false;
          const cloneMat = (m) => {
            const c = m.clone();
            c.transparent = true;
            c.opacity = 0.35;
            c.depthWrite = false;
            gMats.push(c);
            return c;
          };
          o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
        });
        api.add(ghost, 1.0);   // 兜底移除
        window.gsap.to(gMats, {
          opacity: 0, duration: 0.3, delay: 0.02, ease: 'power1.out',
          onComplete: () => { api.disposeTree(ghost); api.remove(ghost); }
        });
      }

      /* ---- 细白爪痕：弧平分线指向「守方→闪现来向」，弧面兜住守方 ---- */
      function clawSlash(origin, lift, radius, thickness, sweep) {
        let ix = to.x - origin.x, iz = to.z - origin.z;
        const ilen = Math.hypot(ix, iz) || 1;
        const bx = -ix / ilen, bz = -iz / ilen;   // 守方指向来向
        const arc = Math.PI * 0.72;
        const ang = Math.atan2(-bz, bx) - arc / 2;
        api.slash(
          { x: to.x, y: dBaseY + lift, z: to.z }, ang, 0xffffff,
          { radius, arc, sweep, thickness, life: 0.26 }
        );
      }

      /* ---- 守方被击中抖动：动态排入（先 kill，演出守则 1） ---- */
      let defYawKick = 0;
      function jolt(originX, originZ, turn) {
        window.gsap.killTweensOf(defRoot.position);
        window.gsap.killTweensOf(defRoot.rotation);
        // 沿「远离豹」方向小弹，随后弹回格心
        let kx = to.x - originX, kz = to.z - originZ;
        const klen = Math.hypot(kx, kz) || 1;
        kx /= klen; kz /= klen;
        window.gsap.to(defRoot.position, {
          x: to.x + kx * 0.07, z: to.z + kz * 0.07, duration: 0.08, ease: 'power2.out'
        });
        window.gsap.to(defRoot.position, {
          x: to.x, z: to.z, y: dBaseY, duration: 0.14, ease: 'power1.inOut', delay: 0.08
        });
        // 偏航被击转 1/3 圈（累计）
        defYawKick += turn;
        window.gsap.to(defRoot.rotation, {
          y: defStartYaw + defYawKick, duration: 0.20, ease: 'power2.out'
        });
      }

      /* ============================================================
         分镜演出
         ============================================================ */

      // ---- 全程 y 锁（压住渲染循环的选中浮动，同 cat.js 套路）----
      // fromTo + immediateRender：补间懒启动，构造后到首个 gsap tick 之间
      // 渲染循环还会写一次 y，to 会把脏值记成起点导致缓慢下沉。
      // 必须在收尾 killTweensOf（2.50）之前结束，否则会吞掉 onComplete。
      tl.fromTo(atkRoot.position, { y: aBaseY }, { y: aBaseY, duration: 2.45, ease: 'none', immediateRender: true }, 0);

      // ---- 0.00-0.15 压低蓄势 + 转头锁定猎物 ----
      tl.to(atkRoot.scale, { x: 1.05, y: 0.85, z: 1.05, duration: 0.15, ease: 'power2.out' }, 0);
      tl.to(atkRoot.rotation, { y: faceYaw(from), duration: 0.14, ease: 'power1.inOut' }, 0);
      if (atkBody) tl.to(atkBody.rotation, { x: 0.14, duration: 0.15, ease: 'power2.out' }, 0);

      /* ---- 三连瞬移：每次 = 起跳残影 + 0.08s 直线闪现 + 到位一击 ---- */
      // 起跳 call 先插入、位移补间后插入：同一时刻按插入顺序渲染，
      // 残影捕获的必然是闪现前的位姿
      function blink(t, dest, hitCall) {
        tl.call(() => { spawnGhost(); }, [], t);
        tl.to(atkRoot.position, { x: dest.x, z: dest.z, duration: 0.08, ease: 'none' }, t);
        tl.to(atkRoot.rotation, { y: faceYaw(dest), duration: 0.08, ease: 'none' }, t);
        tl.call(hitCall, [], t + 0.08);
      }

      // ---- 第一击（左侧）：0.15 → 0.23 ----
      blink(0.15, sideL, () => {
        clawSlash(sideL, 0.10, 0.30, 0.04, 0.9);
        jolt(sideL.x, sideL.z, Math.PI * 2 / 3);
        api.shakeCamera(0.25);
        safePlay(snd && snd.impact && (() => snd.impact()));
      });

      // ---- 第二击（右侧）：0.40 → 0.48 ----
      blink(0.40, sideR, () => {
        clawSlash(sideR, 0.16, 0.32, 0.04, -0.9);
        jolt(sideR.x, sideR.z, Math.PI * 2 / 3);
        api.shakeCamera(0.25);
        safePlay(snd && snd.impact && (() => snd.impact()));
      });

      // ---- 第三击（后方）：0.65 → 0.73，击瘫 ----
      blink(0.65, back, () => {
        // 交错的粗细双爪痕收尾
        clawSlash(back, 0.12, 0.34, 0.05, 0.9);
        clawSlash(back, 0.20, 0.42, 0.04, -1.0);
        api.smoke({ x: to.x, y: dBaseY, z: to.z }, 0xa68b64, { count: 5, size: 0.15 });
        api.burst({ x: to.x, y: dBaseY + 0.08, z: to.z }, 0xcfc09a, { count: 8, size: 0.035, dist: 0.6 });
        api.ring({ x: to.x, y: dBaseY, z: to.z }, 0xffffff, { r1: 2.2, life: 0.45 });
        api.shakeCamera(0.5);
        safePlay(snd && snd.impact && (() => snd.impact()));

        // 击瘫：压扁 → 弹回侧倒躺平（动态排入，演出守则 1）
        window.gsap.killTweensOf(defRoot.position);
        window.gsap.killTweensOf(defRoot.rotation);
        window.gsap.killTweensOf(defRoot.scale);
        window.gsap.to(defRoot.scale, { x: 1.12, y: 0.4, z: 1.12, duration: 0.10, ease: 'power2.out' });
        window.gsap.to(defRoot.scale, { x: 1.0, y: 0.7, z: 1.0, duration: 0.24, ease: 'power2.in', delay: 0.10 });
        // 侧倒 rotation.x ≈ 1.5，偏航补完被击的整一圈
        window.gsap.to(defRoot.rotation, { x: 1.5, duration: 0.32, ease: 'power2.in', delay: 0.06 });
        window.gsap.to(defRoot.rotation, { y: defStartYaw + Math.PI * 2, duration: 0.32, ease: 'power1.inOut', delay: 0.06 });
        // 沿豹最后一击方向击离格心一点，抬 y 免穿地
        window.gsap.to(defRoot.position, {
          x: to.x + dx * 0.10, z: to.z + dz * 0.10, duration: 0.16, ease: 'power2.out'
        });
        window.gsap.to(defRoot.position, { y: dBaseY + 0.10, duration: 0.32, ease: 'power1.inOut', delay: 0.06 });
        // 底座脱盘淡出（躺平不留立着的圆盘）
        discMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.25, ease: 'power1.out' }));
      });

      // ---- 1.10-1.18 从「后方」瞬移回守方格心（第四道残影）----
      blink(1.10, { x: to.x, z: to.z }, () => {});

      // ---- 1.18 落地收势：豹啸 + 主题色小环 + 站直 ----
      tl.call(() => {
        api.ring({ x: to.x, y: aBaseY, z: to.z }, themeColor, { r1: 1.6, life: 0.4 });
        safePlay(snd && snd.play && (() => snd.play(ctx.animal || 'leopard', 'burst')));
      }, [], 1.18);
      tl.to(atkRoot.scale, { x: 1, y: 1, z: 1, duration: 0.22, ease: 'back.out(1.8)' }, 1.18);
      if (atkBody) tl.to(atkBody.rotation, { x: 0, duration: 0.15, ease: 'power2.out' }, 1.18);

      // ---- 1.25-1.50 转回原始朝向 ----
      tl.to(atkRoot.rotation, { y: startYaw, duration: 0.25, ease: 'power1.inOut' }, 1.25);

      // ---- 1.55-1.79 收势小点头 ----
      tl.to(atkRoot.rotation, { x: 0.06, duration: 0.10, ease: 'sine.inOut' }, 1.55);
      tl.to(atkRoot.rotation, { x: 0, duration: 0.14, ease: 'sine.inOut' }, 1.65);

      // ---- 2.05-2.40 守方尸体整体淡出 ----
      tl.call(() => {
        defMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.35, ease: 'power1.in' }));
      }, [], 2.05);

      // ---- 2.50 收尾：守方隐没 + 攻方精确复位（演出守则 2） ----
      // 此时 y 锁 / 位移 / 旋转补间都已自然结束，killTweensOf 只会清理
      // 已完成的子补间，不会打断时间线的 onComplete。
      tl.call(() => {
        window.gsap.killTweensOf(defRoot.position);
        window.gsap.killTweensOf(defRoot.rotation);
        window.gsap.killTweensOf(defRoot.scale);
        defRoot.visible = false;

        window.gsap.killTweensOf(atkRoot.position);
        window.gsap.killTweensOf(atkRoot.rotation);
        window.gsap.killTweensOf(atkRoot.scale);
        if (atkBody) {
          window.gsap.killTweensOf(atkBody.rotation);
          atkBody.rotation.set(0, 0, 0);
        }
        atkRoot.position.set(to.x, aBaseY, to.z);
        atkRoot.rotation.set(0, startYaw, 0);
        atkRoot.scale.set(1, 1, 1);
        atkRoot.visible = true;
      }, [], 2.50);
    });
  }

  window.AttackCinematics = window.AttackCinematics || {};
  window.AttackCinematics.leopard = leopardCinematic;
})();
