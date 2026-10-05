/* ============================================================
   FxBridge: 游戏 ↔ 特效 桥接层
   - categorizeMove: 把游戏事件分类为 6 种 FX 场景
   - playFor: 统一播放入口，处理开关降级
   - playForCapture: 吃子播放
   - playForMove: 移动播放
   ============================================================ */
const FxBridge = (function () {

  // 动物 type → 英文 key（与 themes.js / list.js 一致）
  const TYPE_KEY = {
    ELEPHANT: 'elephant', LION: 'lion', TIGER: 'tiger', LEOPARD: 'leopard',
    WOLF: 'wolf', DOG: 'dog', CAT: 'cat', RAT: 'rat'
  };

  // 跳河检测：路径中含河格
  function pathCrossesRiver(fromRow, fromCol, toRow, toCol) {
    const dr = Math.sign(toRow - fromRow);
    const dc = Math.sign(toCol - fromCol);
    if (dr === 0 && dc === 0) return false;
    let r = fromRow + dr, c = fromCol + dc;
    // 沿路径逐一检查（最多 7 步）
    for (let i = 0; i < 7; i++) {
      if (window.isRiver && window.isRiver(r, c)) return true;
      if (r === toRow && c === toCol) break;
      r += dr; c += dc;
    }
    return false;
  }

  /**
   * 把游戏事件分类为 FX 场景
   * @returns {Object} { category, scene, animal, defenderAnimal, theme }
   */
  function categorizeMove(attacker, defender, fromRow, fromCol, toRow, toCol) {
    const attackerKey = TYPE_KEY[attacker.type] || 'dog';
    const theme = (window.ANIMAL_THEMES || {})[attackerKey] || { color: '#aaa' };

    // 1. 反杀：鼠吃象
    if (attacker.type === 'RAT' && defender && defender.type === 'ELEPHANT') {
      return { category: '反杀特化', scene: 'reverse', animal: attackerKey, defenderAnimal: 'elephant', theme };
    }

    // 2. 跳河：狮/虎，路径含河
    if ((attacker.type === 'LION' || attacker.type === 'TIGER')
        && pathCrossesRiver(fromRow, fromCol, toRow, toCol)
        && defender) {
      return { category: '跳河吃子', scene: 'stream', animal: attackerKey, defenderAnimal: TYPE_KEY[defender.type] || 'rat', theme };
    }

    // 3. 兽穴获胜：攻入敌方兽穴（即使空）
    if (typeof window.isEnemyDen === 'function' && window.isEnemyDen(toRow, toCol, attacker.owner)) {
      return {
        category: '兽穴获胜',
        scene: 'crown',
        animal: attackerKey,
        defenderAnimal: defender ? (TYPE_KEY[defender.type] || 'rat') : null,
        theme
      };
    }

    // 4. 陷阱吃子：守方在己方陷阱
    if (defender && typeof window.isTrap === 'function' && window.isTrap(toRow, toCol, defender.owner)) {
      return { category: '陷阱吃子', scene: 'sink', animal: attackerKey, defenderAnimal: TYPE_KEY[defender.type] || 'rat', theme };
    }

    // 5. 普通吃子 vs 普通移动
    if (defender) {
      return { category: '普通吃子', scene: 'burst', animal: attackerKey, defenderAnimal: TYPE_KEY[defender.type] || 'rat', theme };
    }

    // 6. 普通移动
    return { category: '移动', scene: 'move', animal: attackerKey, defenderAnimal: null, theme };
  }

  /**
   * 统一播放入口
   * @param {Object} eventInfo - categorizeMove 的返回值
   * @param {Object} ctx - { fromPos, toPos, asset, attacker, defender }
   *   fromPos / toPos 为视口坐标矩形 { x, y, width, height }（viewport CSS 像素，
   *   语义等同 getBoundingClientRect()），由渲染器提供，桥接层只做透传
   * @param {Object} settings - { fxEnabled, soundEnabled }
   * @returns {Promise}
   */
  function playFor(eventInfo, ctx, settings) {
    if (!settings || settings.fxEnabled === false) {
      return Promise.resolve();
    }
    if (eventInfo.category === '移动') {
      return playForMove(ctx, eventInfo, settings);
    }
    return playForCapture(ctx, eventInfo, settings);
  }

  /**
   * 吃子播放
   *
   * 3D 模式：交给渲染器的原生 playAttack3D（场景内冲锋/击倒/碎屑/逐动物签名），
   * 不再播放 2D 卡片覆盖层（贴图卡片飘在 3D 棋盘上风格割裂）。
   * 2D 模式：走 FxList.playFX → playCaptureSceneAt 的 5 阶段覆盖层。
   */
  function playForCapture(ctx, eventInfo, settings) {
    return new Promise((resolve) => {
      try {
        // ---- 3D 原生路径 ----
        const r = ctx.renderer;
        if (document.body.classList.contains('render-3d')
            && r && typeof r.playAttack3D === 'function') {
          // 音效仍由桥接层负责（动物音色 + 场景叠加）
          if (settings && settings.soundEnabled !== false && window.FxSound) {
            window.FxSound.play(eventInfo.animal, eventInfo.scene);
          }
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          try {
            const p = r.playAttack3D(eventInfo, {
              fromRow: ctx.fromRow, fromCol: ctx.fromCol,
              toRow: ctx.toRow, toCol: ctx.toCol,
              attacker: ctx.attacker,
              defender: ctx.defender
            });
            if (p && typeof p.then === 'function') {
              p.then(finish).catch(finish);
              setTimeout(finish, 6000);   // 兜底：动画异常也不能锁死输入
            } else {
              finish();
            }
          } catch (e) {
            console.error('FxBridge.playForCapture(3D):', e);
            finish();
          }
          return;
        }

        // ---- 2D 覆盖层路径（原实现） ----
        // 找到对应 factory
        const factoryList = (window.FxList && window.FxList.FX_FACTORIES) || [];
        const fx = factoryList.find(
          f => f.category === eventInfo.category && f.animal === eventInfo.animal
        );
        if (!fx) { resolve(); return; }

        // 调用 FxList.playFX（返回 GSAP timeline，thenable）
        // 传参链：ctx.toPos（视口坐标矩形）→ opts.targetPos → playCaptureSceneAt 的 targetPos
        let result = null;
        if (window.FxList && window.FxList.playFX) {
          result = window.FxList.playFX(fx, {
            attackerColor: ctx.attacker.owner,
            defenderColor: ctx.defender ? ctx.defender.owner : 'red',
            defender: eventInfo.defenderAnimal,
            soundOn: settings.soundEnabled !== false,
            targetPos: ctx.toPos
          });
        }
        // 跟随动画时间线结束（带兜底超时，防止 timeline 异常导致输入永久锁死）
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        if (result && typeof result.then === 'function') {
          result.then(finish).catch(finish);
          setTimeout(finish, 4000);
        } else {
          setTimeout(finish, 2600);
        }
      } catch (e) {
        console.error('FxBridge.playForCapture:', e);
        resolve();
      }
    });
  }

  /**
   * 移动播放
   *
   * 3D 模式下跳过 DOM ghost（2D 的卡片残影飘在 3D 棋盘上风格割裂），
   * 改由 Renderer3D 在 render 差分时做原生抛物线跳跃，这里立即解锁。
   */
  function playForMove(ctx, eventInfo, settings) {
    return new Promise((resolve) => {
      try {
        if (document.body.classList.contains('render-3d')) {
          setTimeout(resolve, 60);
          return;
        }
        if (window.FxBase && typeof window.FxBase.playMoveFx === 'function') {
          window.FxBase.playMoveFx({
            // 透传渲染器提供的视口坐标与资产描述，FX 层不再回读棋格 DOM
            fromPos: ctx.fromPos,
            toPos: ctx.toPos,
            asset: ctx.asset,
            animal: eventInfo.animal,
            color: ctx.attacker.owner
          }).then(resolve);
        } else {
          resolve();
        }
      } catch (e) {
        console.error('FxBridge.playForMove:', e);
        resolve();
      }
    });
  }

  return { categorizeMove, playFor, playForCapture, playForMove };
})();

// 暴露到全局
window.FxBridge = FxBridge;
