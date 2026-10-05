/* ============================================================
   狗 · 攻击剧场（旋转扑击）
   ------------------------------------------------------------
   注册到 window.AttackCinematics.dog，由 renderer3d 的
   playAttack3D 在「普通吃子」且攻方为狗时调起。
   只允许通过 ctx + window.AttackFx 触碰场景，不持有 scene/camera。

   分镜（约 2.5s，兜底 4.5s 必 resolve）：
     0.00-0.30  汪汪两声：转向守方 → 原地小跳两下，
                狗口向守方连吐两道短促声波弧（间隔 0.12s）+ 狗叫
     0.30-0.75  旋转扑击：沿半径 0.55 的弧线绕守方外侧冲撞——
                position 分 3 段 tween（每段 0.15s）：前两段走圆弧，
                最后一段从侧后方直冲守方格心撞上；途中脚下扬尘
     0.75       撞击：贴地闪光 + 冲击环 + 碎屑 + 尘雾
                + shakeCamera(0.5) + 闷响
     0.75-1.32  守方被压扁：scale.y 压到 0.3 弹回 0.6，
                再沿冲量方向歪倒（rotation.x ≈ ±1.5 侧躺），
                等级底座「脱盘」淡出，尸体沿冲量方向滑出 0.3 格
     1.24-2.08  狗转回原朝向站定摇尾庆祝：rotation.y ±0.25
                快速摆动 3 次 + 尾巴同步摇摆 3 圈
     2.12       守方（压扁歪倒的尸体）整体淡出
     2.48       收尾：守方 visible=false；攻方精确复位到守方格心

   技术点：
     - 攻守双方 rotation.order 都改 'YXZ'：先偏航再俯仰，
       守方歪倒方向才与自身朝向解耦
     - 绕行弧线以守方格心为圆心：起点角 = 守方看向攻方的方位角，
       前 2 段各扫 60°，狗头始终朝切线方向（跑动感）
     - 守方歪倒方向按「冲量方向 × 守方自身朝向」计算：
       正面撞 → 顺冲量前扑（rotation.x=+1.5），
       背面撞 → 后仰翻倒（-1.5），侧向撞 → 横滚（rotation.z=±1.5）
     - 守方位姿补间全部在撞击 tl.call 回调里动态排入（演出守则 1：
       先 killTweensOf 的补间不能预排在 timeline 上，会被连带误杀）
     - 尾巴 = 攻方身体组（children[1]）里 z < -0.25 的部件，
       摇摆后收尾精确复原
   ============================================================ */
(function () {
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** 把 target 角度解卷到离 prev 最近的等价角（避免补间绕远路） */
  function unwrap(prev, target) {
    while (target - prev > Math.PI) target -= Math.PI * 2;
    while (target - prev < -Math.PI) target += Math.PI * 2;
    return target;
  }

  /** fxSlash 的 torus 弧朝向换算：让弧的中点指向方位角 beta
      （torus 先绕 z 转 angle、再绕 x 转 -PI/2 放平，弧中点世界方向 = PI/2 + angle + arcLen/2） */
  function aimAngle(beta, arcLen) { return beta - Math.PI / 2 - arcLen / 2; }

  function dogCinematic(ctx) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      window.gsap.delayedCall(4.5, finish);   // 兜底，超时也必须 resolve

      const api = window.AttackFx || null;
      const atk = ctx && ctx.attacker;
      const def = ctx && ctx.defender;

      // ctx 或特效层缺失：直接安全复位并放行，绝不锁死输入
      if (!api || !atk || !def || !atk.root || !def.root || !window.gsap) {
        try {
          if (def && def.root) {
            if (window.gsap) window.gsap.killTweensOf(def.root.position);
            def.root.visible = false;
          }
          if (atk && atk.root && def) {
            if (window.gsap) window.gsap.killTweensOf(atk.root.position);
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

      const startYaw = atkRoot.rotation.y;          // 攻方原始朝向（庆祝/收尾复位用）
      const defStartYaw = defRoot.rotation.y;       // 守方原始朝向（歪倒方向判定用）

      // 扑击方向（from→to 单位向量）
      let dx = to.x - from.x, dz = to.z - from.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist; dz /= dist;
      const faceYaw = Math.atan2(dx, dz);           // 面朝守方所需偏航

      // 绕行弧线：圆心 = 守方格心，半径 0.55
      const R = 0.55;
      const side = 1;                               // 绕行方向（+1 逆时针）
      const phi0 = Math.atan2(from.z - to.z, from.x - to.x);   // 起点方位角
      const phi1 = phi0 + side * Math.PI / 3;       // 第 1 段终点（扫 60°）
      const phi2 = phi0 + side * Math.PI * 2 / 3;   // 第 2 段终点（累计 120°）
      const arcPos = phi => ({ x: to.x + Math.cos(phi) * R, z: to.z + Math.sin(phi) * R });
      const p1 = arcPos(phi1);
      const p2 = arcPos(phi2);
      // 沿弧跑动时狗头朝切线方向
      const runYaw = phi => (side > 0 ? -phi : Math.PI - phi);

      // 最后一段直冲方向（p2 → 守方格心），也是守方被撞飞的冲量方向
      let kx = to.x - p2.x, kz = to.z - p2.z;
      const kLen = Math.hypot(kx, kz) || 1;
      kx /= kLen; kz /= kLen;
      const dashYaw = Math.atan2(kx, kz);
      // 守方尸体滑出落点（夹在棋盘范围内）
      const knockX = clamp(to.x + kx * 0.32, -3.9, 3.9);
      const knockZ = clamp(to.z + kz * 0.32, -2.9, 2.9);
      // 守方歪倒姿态：冲量方向 × 自身朝向 → 前扑 / 后仰 / 横滚
      const faceX = Math.sin(defStartYaw), faceZ = Math.cos(defStartYaw);
      const dotK = kx * faceX + kz * faceZ;
      let fallRx = 0, fallRz = 0;
      if (Math.abs(dotK) >= 0.5) {
        fallRx = 1.5 * (dotK > 0 ? 1 : -1);         // 顺/逆着自身朝向翻倒
      } else {
        fallRz = 1.5 * ((kz * faceX - kx * faceZ) > 0 ? 1 : -1);   // 侧向横滚
      }

      const snd = api.sound ? api.sound() : null;

      /* ---- 守方材质提前转 transparent（收尾整体淡出） ----
         注意：材质首次渲染后已按不透明编译进着色器程序，
         只改 transparent 不加 needsUpdate 不会生效（淡出会失效） */
      const defMats = [];
      defRoot.traverse(o => {
        if (o.isMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => {
            if (!m.transparent) { m.transparent = true; m.needsUpdate = true; }
            defMats.push(m);
          });
        }
      });
      const discMats = [];   // 等级底座（children[0]）：撞击瞬间"脱盘"淡出
      const disc = defRoot.children && defRoot.children[0];
      if (disc && disc.isMesh) {
        const mats = Array.isArray(disc.material) ? disc.material : [disc.material];
        mats.forEach(m => discMats.push(m));
      }

      /* ---- 攻方尾巴（身体组里 z < -0.25 的部件），庆祝时摇摆 ---- */
      let tail = null;
      const atkBody = atkRoot.children && atkRoot.children[1];
      if (atkBody && atkBody.children) {
        for (let i = 0; i < atkBody.children.length; i++) {
          const o = atkBody.children[i];
          if (o.position && o.position.z < -0.25) { tail = o; break; }
        }
      }
      const tailRot0 = tail
        ? { x: tail.rotation.x, y: tail.rotation.y, z: tail.rotation.z } : null;
      if (tail) window.gsap.killTweensOf(tail.rotation);

      /* ============================================================
         分镜演出
         ============================================================ */

      // ---- 0.00-0.30 汪汪两声：转向守方 + 原地小跳两下 ----
      tl.to(atkRoot.rotation, { y: unwrap(startYaw, faceYaw), duration: 0.08, ease: 'power1.out' }, 0);
      // 小跳 1
      tl.to(atkRoot.position, { y: aBaseY + 0.10, duration: 0.07, ease: 'power2.out' }, 0.00);
      tl.to(atkRoot.position, { y: aBaseY, duration: 0.07, ease: 'power2.in' }, 0.07);
      // 小跳 2
      tl.to(atkRoot.position, { y: aBaseY + 0.10, duration: 0.07, ease: 'power2.out' }, 0.16);
      tl.to(atkRoot.position, { y: aBaseY, duration: 0.07, ease: 'power2.in' }, 0.23);

      // 两道声波弧：从狗口向守方，一前一后间隔 0.12s + 狗叫
      const barkArc = Math.PI * 0.75;
      tl.call(() => {
        api.slash(
          { x: from.x + dx * 0.30, y: aBaseY + 0.26, z: from.z + dz * 0.30 },
          aimAngle(faceYaw, barkArc), 0xfff3d0,
          { radius: 0.30, arc: barkArc, sweep: 0.55, thickness: 0.04, life: 0.24 });
        if (snd && snd.play) snd.play(ctx.animal || 'dog', 'burst');
      }, [], 0.03);
      tl.call(() => {
        api.slash(
          { x: from.x + dx * 0.34, y: aBaseY + 0.26, z: from.z + dz * 0.34 },
          aimAngle(faceYaw, barkArc), 0xfff8e8,
          { radius: 0.40, arc: barkArc, sweep: 0.7, thickness: 0.04, life: 0.26 });
      }, [], 0.15);

      // ---- 0.30-0.60 旋转绕后：沿弧线分 2 段绕到守方侧后方 ----
      tl.to(atkRoot.position, { x: p1.x, z: p1.z, duration: 0.15, ease: 'power1.in' }, 0.30);
      tl.to(atkRoot.rotation, { y: unwrap(faceYaw, runYaw(phi1)), duration: 0.15, ease: 'power1.inOut' }, 0.30);
      tl.to(atkRoot.position, { x: p2.x, z: p2.z, duration: 0.15, ease: 'power1.out' }, 0.45);
      tl.to(atkRoot.rotation, { y: unwrap(runYaw(phi1), runYaw(phi2)), duration: 0.15, ease: 'power1.inOut' }, 0.45);
      // 途中脚下扬尘
      tl.call(() => {
        api.smoke({ x: atkRoot.position.x, y: aBaseY, z: atkRoot.position.z }, 0xa68b64, { count: 2, size: 0.10 });
      }, [], 0.36);
      tl.call(() => {
        api.smoke({ x: atkRoot.position.x, y: aBaseY, z: atkRoot.position.z }, 0xa68b64, { count: 2, size: 0.10 });
      }, [], 0.52);

      // ---- 0.60-0.75 最后一段：直冲守方撞上（带小腾跃） ----
      tl.to(atkRoot.position, { x: to.x, z: to.z, duration: 0.15, ease: 'power2.in' }, 0.60);
      tl.to(atkRoot.rotation, { y: unwrap(runYaw(phi2), dashYaw), duration: 0.12, ease: 'power1.in' }, 0.60);
      tl.to(atkRoot.position, { y: aBaseY + 0.22, duration: 0.075, ease: 'power2.out' }, 0.60);
      tl.to(atkRoot.position, { y: aBaseY, duration: 0.075, ease: 'power2.in' }, 0.675);

      // ---- 0.75 撞击：闪光 + 环 + 碎屑 + 尘雾 + 震镜 + 闷响 ----
      //      守方压扁 → 弹回 → 歪倒（动态排入，演出守则 1）
      tl.call(() => {
        const impactW = { x: to.x, y: dBaseY, z: to.z };
        api.impactFlash(impactW, 'rgba(255,196,140,0.9)', { size: 0.95, life: 0.35 });
        api.ring(impactW, 0xffe8c8, { r1: 1.8, life: 0.4 });
        api.burst(impactW, 0xd9b98a, { count: 9, size: 0.04, dist: 0.6 });
        api.smoke(impactW, 0xa68b64, { count: 3, size: 0.15 });
        api.shakeCamera(0.5);
        if (snd && snd.impact) snd.impact();

        // 守方接管位姿：先 kill 再动态排入 timeline
        window.gsap.killTweensOf(defRoot.position);
        window.gsap.killTweensOf(defRoot.rotation);
        window.gsap.killTweensOf(defRoot.scale);
        // 等级底座被撞脱：淡出
        discMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.25, ease: 'power1.out' }));
        // 压扁：scale.y 0.3，横向挤出
        tl.to(defRoot.scale, { x: 1.18, y: 0.30, z: 1.18, duration: 0.11, ease: 'power3.out' }, 0.75);
        // 弹回 0.6
        tl.to(defRoot.scale, { x: 1.06, y: 0.62, z: 1.06, duration: 0.17, ease: 'back.out(2)' }, 0.86);
        // 尸体沿冲量方向滑出
        tl.to(defRoot.position, { x: knockX, z: knockZ, duration: 0.34, ease: 'power2.out' }, 0.77);
        // 歪倒侧躺（y 微抬免穿地）
        tl.to(defRoot.rotation, { x: fallRx, z: fallRz, duration: 0.32, ease: 'power2.in' }, 1.00);
        tl.to(defRoot.position, { y: dBaseY + 0.14, duration: 0.32, ease: 'power1.inOut' }, 1.00);
      }, [], 0.75);

      // ---- 1.24-2.08 站定摇尾庆祝：转回原朝向 + 摆动 3 次 + 尾巴摇摆 ----
      tl.to(atkRoot.rotation, { y: unwrap(dashYaw, startYaw), duration: 0.16, ease: 'power1.inOut' }, 1.24);
      tl.to(atkRoot.rotation, {
        y: startYaw + 0.25, duration: 0.11, ease: 'sine.inOut',
        yoyo: true, repeat: 5
      }, 1.42);
      if (tail && tailRot0) {
        tl.fromTo(tail.rotation,
          { z: tailRot0.z - 0.32 },
          { z: tailRot0.z + 0.32, duration: 0.11, ease: 'sine.inOut', yoyo: true, repeat: 5 },
          1.42);
      }

      // ---- 1.98-2.48 慢速 y 保持：压住选中浮动，防止复位下坠 ----
      tl.to(atkRoot.position, { y: aBaseY, duration: 0.50, ease: 'none' }, 1.98);

      // ---- 2.12 守方尸体整体淡出 ----
      tl.call(() => {
        defMats.forEach(m => window.gsap.to(m, { opacity: 0, duration: 0.32, ease: 'power1.in' }));
      }, [], 2.12);

      // ---- 2.48 收尾：守方隐没 + 攻方精确复位（演出守则 2） ----
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
        if (tail && tailRot0) tail.rotation.set(tailRot0.x, tailRot0.y, tailRot0.z);
      }, [], 2.48);
    });
  }

  window.AttackCinematics = window.AttackCinematics || {};
  window.AttackCinematics.dog = dogCinematic;
})();
