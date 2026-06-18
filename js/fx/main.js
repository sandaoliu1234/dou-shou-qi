/* ============================================================
   fx-demo.html 主交互
   - 生成 27 个按钮（按类别分组）
   - 点击播放对应特效
   - 顺序播放全部
   - 攻方主公切换（红/蓝）
   - 音效开关
   - 音频首次交互解锁
   ============================================================ */
(function () {
  const stage = document.getElementById('fxStage');
  const cell = document.getElementById('fxCell');
  const buttonsContainer = document.getElementById('fxButtons');
  const btnReplayAll = document.getElementById('btnReplayAll');
  const audioHint = document.getElementById('fxAudioHint');
  const btnSound = document.getElementById('btnSound');
  const btnSideRed = document.getElementById('btnSideRed');
  const btnSideBlue = document.getElementById('btnSideBlue');

  // 当前攻方颜色
  let attackerColor = 'red';
  // 攻方按钮（数组索引）
  const btnNodes = [];

  // ============== 音频解锁 ==============
  function unlockAudio() {
    FxSound.unlock();
    if (audioHint) {
      audioHint.classList.add('hidden');
    }
  }
  // 任何点击都尝试解锁音频
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  // ============== 主公切换 ==============
  function setAttackerColor(side) {
    attackerColor = side;
    btnSideRed.classList.toggle('active', side === 'red');
    btnSideBlue.classList.toggle('active', side === 'blue');
  }
  btnSideRed.addEventListener('click', () => setAttackerColor('red'));
  btnSideBlue.addEventListener('click', () => setAttackerColor('blue'));

  // ============== 音效切换 ==============
  function setSoundOn(on) {
    FxSound.setMuted(!on);
    btnSound.dataset.on = on ? 'true' : 'false';
    btnSound.querySelector('.sound-icon').textContent = on ? '🔊' : '🔇';
    btnSound.querySelector('.sound-text').textContent = on ? '开' : '关';
  }
  btnSound.addEventListener('click', () => {
    const next = btnSound.dataset.on !== 'true';
    setSoundOn(next);
  });

  // ============== 按类别分组 ==============
  const groups = {};
  FxList.FX_FACTORIES.forEach(fx => {
    if (!groups[fx.category]) groups[fx.category] = [];
    groups[fx.category].push(fx);
  });

  // 类别中文映射
  const CAT_LABEL = {
    '普通吃子': '普通吃子',
    '跳河吃子': '跳河吃子（狮虎可跳河）',
    '陷阱吃子': '陷阱吃子（任意方困于敌穴）',
    '兽穴获胜': '兽穴获胜（攻入对方兽穴）',
    '反杀特化': '反杀特化（鼠吃象）'
  };

  // ============== 生成按钮 ==============
  Object.keys(groups).forEach(cat => {
    const title = document.createElement('div');
    title.className = 'fx-cat-title';
    title.textContent = `【${CAT_LABEL[cat] || cat}】(${groups[cat].length} 种)`;
    buttonsContainer.appendChild(title);

    groups[cat].forEach(fx => {
      const btn = document.createElement('button');
      btn.className = 'fx-btn';
      btn.style.borderLeft = `4px solid ${fx.theme.color}`;
      btn.innerHTML = `
        <span class="no">${fx.id}</span>
        <span class="animal">${fx.theme.name}</span>
        <span class="desc">${fx.desc}</span>
      `;
      btn.addEventListener('click', () => {
        unlockAudio();
        playFx(fx, btn);
      });
      buttonsContainer.appendChild(btn);
      btnNodes.push({ fx, btn });
    });
  });

  // ============== 播放单个特效 ==============
  function playFx(fx, btn) {
    if (btn) btn.disabled = true;
    try {
      FxList.playFX(fx, {
        attackerColor: attackerColor,
        defenderColor: attackerColor === 'red' ? 'blue' : 'red',
        soundOn: btnSound.dataset.on === 'true'
      });
    } catch (e) {
      console.error('FX error:', e);
    }
    setTimeout(() => {
      if (btn) btn.disabled = false;
    }, 2200);
  }

  // ============== 顺序播放全部 27 种 ==============
  function replayAll() {
    btnReplayAll.disabled = true;
    unlockAudio();
    let i = 0;
    const list = FxList.FX_FACTORIES;
    function next() {
      if (i >= list.length) {
        btnReplayAll.disabled = false;
        return;
      }
      const fx = list[i];
      const ref = btnNodes[i];
      playFx(fx, ref ? ref.btn : null);
      i++;
      setTimeout(next, 1800);
    }
    next();
  }

  btnReplayAll.addEventListener('click', replayAll);

  // 欢迎：自动播第一个（但不强制用户交互）
  setTimeout(() => {
    if (FxList.FX_FACTORIES.length) {
      const fx = FxList.FX_FACTORIES[0];
      const ref = btnNodes[0];
      // 不播放音效（避免没解锁被警告），只演示视觉
      try {
        FxList.playFX(fx, {
          attackerColor: attackerColor,
          defenderColor: 'blue',
          soundOn: false
        });
      } catch (e) {
        console.error(e);
      }
      // 2.2s 后重置按钮
      setTimeout(() => {
        if (ref) ref.btn.disabled = false;
      }, 2200);
    }
  }, 400);
})();
