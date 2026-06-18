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
   * @param {Object} ctx - { fromCellEl, toCellEl, attacker, defender }
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
   */
  function playForCapture(ctx, eventInfo, settings) {
    return new Promise((resolve) => {
      try {
        // 找到对应 factory
        const factoryList = (window.FxList && window.FxList.FX_FACTORIES) || [];
        const fx = factoryList.find(
          f => f.category === eventInfo.category && f.animal === eventInfo.animal
        );
        if (!fx) { resolve(); return; }

        // 调用 FxList.playFX（demo 也用这个入口）
        if (window.FxList && window.FxList.playFX) {
          window.FxList.playFX(fx, {
            attackerColor: ctx.attacker.owner,
            defenderColor: ctx.defender ? ctx.defender.owner : 'red',
            defender: eventInfo.defenderAnimal,
            soundOn: settings.soundEnabled !== false,
            targetCell: ctx.toCellEl
          });
        }
        // 等动画结束（~3.2s: 5 阶段 + 元素释放 + 攻方淡入 + 缓冲）
        setTimeout(resolve, 3200);
      } catch (e) {
        console.error('FxBridge.playForCapture:', e);
        resolve();
      }
    });
  }

  /**
   * 移动播放
   */
  function playForMove(ctx, eventInfo, settings) {
    return new Promise((resolve) => {
      try {
        if (window.FxBase && typeof window.FxBase.playMoveFx === 'function') {
          window.FxBase.playMoveFx({
            fromCellEl: ctx.fromCellEl,
            toCellEl: ctx.toCellEl,
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
