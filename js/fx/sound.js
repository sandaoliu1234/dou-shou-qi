/* ============================================================
   Web Audio API 程序化音效合成器
   8 动物音色 + 5 场景叠加
   ============================================================ */
const FxSound = (function () {
  let ctx = null;
  let unlocked = false;
  let muted = false;

  // 解锁音频（首次用户交互后调用）
  function unlock() {
    if (unlocked) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
  }

  function setMuted(m) { muted = m; }
  function isMuted() { return muted; }

  function now() { return ctx ? ctx.currentTime : 0; }

  /**
   * 单音：频率 + 时长 + 音量 + 波形 + 包络
   * @param {Number} freq 频率 Hz
   * @param {Number} dur  时长 s
   * @param {Object} opt  { type, vol, attack, decay, slideTo }
   */
  function tone(freq, dur, opt = {}) {
    if (!unlocked || muted || !ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(freq, now());
    if (opt.slideTo) {
      o.frequency.exponentialRampToValueAtTime(opt.slideTo, now() + dur);
    }
    const vol = opt.vol != null ? opt.vol : 0.3;
    const a = opt.attack != null ? opt.attack : 0.005;
    const d = opt.decay != null ? opt.decay : dur;
    g.gain.setValueAtTime(0, now());
    g.gain.linearRampToValueAtTime(vol, now() + a);
    g.gain.exponentialRampToValueAtTime(0.001, now() + a + d);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(now() + a + d + 0.05);
  }

  /** 短噪声（白噪 + 低通滤波） */
  function noise(dur, opt = {}) {
    if (!unlocked || muted || !ctx) return;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * dur, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = opt.filterType || 'lowpass';
    filter.frequency.value = opt.filterFreq || 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now());
    g.gain.linearRampToValueAtTime(opt.vol != null ? opt.vol : 0.15, now() + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now() + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
    src.stop(now() + dur + 0.05);
  }

  // ============== 8 动物基础音色 ==============
  const ANIMAL_SOUND = {
    /** 象：低频钝响 */
    elephant: (vol = 0.5) => {
      tone(80, 0.25, { type: 'sine', vol: vol * 0.6, decay: 0.25 });
      tone(120, 0.2, { type: 'triangle', vol: vol * 0.3, decay: 0.2 });
    },
    /** 狮：中频吼叫（200→350Hz 滑音） */
    lion: (vol = 0.5) => {
      tone(200, 0.35, { type: 'sawtooth', vol: vol * 0.4, slideTo: 350, decay: 0.35 });
      tone(100, 0.35, { type: 'sine', vol: vol * 0.3, decay: 0.35 });
    },
    /** 虎：高频短促吼（400→600Hz） */
    tiger: (vol = 0.5) => {
      tone(400, 0.25, { type: 'sawtooth', vol: vol * 0.4, slideTo: 600, decay: 0.2 });
      tone(800, 0.1, { type: 'square', vol: vol * 0.15, decay: 0.1 });
    },
    /** 豹：高频短促"啪" */
    leopard: (vol = 0.5) => {
      tone(500, 0.08, { type: 'square', vol: vol * 0.3, decay: 0.08 });
      tone(300, 0.1, { type: 'sine', vol: vol * 0.4, decay: 0.1 });
    },
    /** 狼：长嚎（200→800Hz 滑音，0.6s） */
    wolf: (vol = 0.5) => {
      tone(200, 0.6, { type: 'sawtooth', vol: vol * 0.35, slideTo: 800, decay: 0.6 });
      tone(150, 0.6, { type: 'sine', vol: vol * 0.25, decay: 0.6 });
    },
    /** 狗：短促"汪"（双音） */
    dog: (vol = 0.5) => {
      tone(400, 0.08, { type: 'square', vol: vol * 0.3, decay: 0.08 });
      setTimeout(() => tone(350, 0.08, { type: 'square', vol: vol * 0.3, decay: 0.08 }), 100);
    },
    /** 猫："喵"（高音短促+颤音） */
    cat: (vol = 0.5) => {
      tone(600, 0.15, { type: 'triangle', vol: vol * 0.35, slideTo: 800, decay: 0.15 });
      tone(1200, 0.05, { type: 'sine', vol: vol * 0.15, decay: 0.05 });
    },
    /** 鼠：尖细"吱吱"（双高频） */
    rat: (vol = 0.5) => {
      tone(1000, 0.06, { type: 'square', vol: vol * 0.25, decay: 0.06 });
      setTimeout(() => tone(1200, 0.06, { type: 'square', vol: vol * 0.25, decay: 0.06 }), 60);
    }
  };

  // ============== 5 场景叠加层 ==============
  const SCENE_SOUND = {
    /** 普通吃子：低沉"砰" */
    burst: () => {
      tone(60, 0.15, { type: 'sine', vol: 0.3, decay: 0.15 });
    },
    /** 跳河：水花噪声 */
    stream: () => {
      noise(0.4, { filterType: 'lowpass', filterFreq: 1200, vol: 0.25 });
      noise(0.3, { filterType: 'bandpass', filterFreq: 2000, vol: 0.15 });
      tone(150, 0.2, { type: 'sine', vol: 0.2, slideTo: 80, decay: 0.2 });
    },
    /** 陷阱：低频下沉 */
    sink: () => {
      tone(120, 0.5, { type: 'sine', vol: 0.3, slideTo: 40, decay: 0.5 });
      noise(0.3, { filterType: 'lowpass', filterFreq: 400, vol: 0.15 });
    },
    /** 兽穴获胜：4 音上升号角（C-E-G-C） */
    crown: () => {
      const notes = [261.63, 329.63, 392.00, 523.25];
      notes.forEach((f, i) => {
        setTimeout(() => tone(f, 0.3, { type: 'triangle', vol: 0.3, decay: 0.3 }), i * 120);
        setTimeout(() => tone(f / 2, 0.3, { type: 'sine', vol: 0.2, decay: 0.3 }), i * 120);
      });
    },
    /** 反杀：反向音（高→低） */
    reverse: () => {
      tone(800, 0.2, { type: 'sawtooth', vol: 0.3, slideTo: 100, decay: 0.3 });
      noise(0.4, { filterType: 'highpass', filterFreq: 1000, vol: 0.2 });
      tone(1500, 0.1, { type: 'square', vol: 0.2, slideTo: 200, decay: 0.2 });
    }
  };

  /**
   * 播放完整音效：动物基础 + 场景叠加
   * @param {String} animalKey - elephant/lion/tiger/leopard/wolf/dog/cat/rat
   * @param {String} sceneKey  - burst/stream/sink/crown/reverse
   */
  function play(animalKey, sceneKey) {
    if (ANIMAL_SOUND[animalKey]) ANIMAL_SOUND[animalKey](0.4);
    setTimeout(() => {
      if (SCENE_SOUND[sceneKey]) SCENE_SOUND[sceneKey]();
    }, 100);
  }

  return { unlock, play, setMuted, isMuted };
})();

// 暴露到全局
window.FxSound = FxSound;
