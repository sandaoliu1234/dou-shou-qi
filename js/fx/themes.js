/* ============================================================
   8 动物主题配置
   颜色 / 调性 / 速度 / 元素类名
   ============================================================ */
const ANIMAL_THEMES = {
  elephant: {
    name: '象', color: '#8b6f47',
    size: 1.3,         /* 大 */
    speed: 1.2,        /* 慢 */
    intensity: 0.8,
    elClass: 'fx-tusk',
    particles: 8
  },
  lion: {
    name: '狮', color: '#e8a535',
    size: 1.1,
    speed: 1.0,
    intensity: 1.0,
    elClass: 'fx-mane',
    particles: 10
  },
  tiger: {
    name: '虎', color: '#5b6db8',
    size: 1.05,
    speed: 0.95,
    intensity: 1.0,
    elClass: 'fx-wang',
    particles: 8
  },
  leopard: {
    name: '豹', color: '#d4c04a',
    size: 1.0,
    speed: 0.7,
    intensity: 1.0,
    elClass: 'fx-leo-stripe',
    particles: 12
  },
  wolf: {
    name: '狼', color: '#7a8fb0',
    size: 1.0,
    speed: 0.9,
    intensity: 0.9,
    elClass: 'fx-moon',
    particles: 8
  },
  dog: {
    name: '狗', color: '#c0392b',
    size: 1.0,
    speed: 1.0,
    intensity: 1.0,
    elClass: 'fx-paw',
    particles: 8
  },
  cat: {
    name: '猫', color: '#e8a8b8',
    size: 0.9,
    speed: 1.1,
    intensity: 0.7,
    elClass: 'fx-whisker',
    particles: 6
  },
  rat: {
    name: '鼠', color: '#9a9590',
    size: 0.7,
    speed: 0.5,        /* 极快 */
    intensity: 0.7,
    elClass: 'fx-tail',
    particles: 4
  }
};

// 暴露到全局（供 game.js / FxBridge / base.js 访问）
window.ANIMAL_THEMES = ANIMAL_THEMES;
