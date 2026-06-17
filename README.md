# 斗兽棋 (Dou Shou Qi)

> 一款纯前端实现的双人回合制桌游。打开浏览器即可在 9×7 木质棋盘上，让红蓝双方 16 枚棋子按等级对弈，攻入对方兽穴即胜。

![preview](preview.png)

## 特性

- **完整规则**：8 个等级棋子（象/狮/虎/豹/狼/狗/猫/鼠）、陷阱、兽穴、河流阻隔、鼠吃象、狮虎跳河
- **复刻童年**：复古木质视觉，红蓝双方不同色调的 SVG 卡片棋子
- **响应式布局**：桌面优先，棋盘 9:7 自适应缩放
- **抽屉交互**：底部「规则图鉴 / 操作日志 / 游戏设置」三个 Tab，默认折叠
- **零依赖运行**：纯 HTML / CSS / JS，可直接 file:// 打开

## 快速开始

### 方式 1 · 本地静态服务（推荐）

```powershell
cd dou-shou-qi
python -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765/
```

### 方式 2 · Node 静态服务

```powershell
cd dou-shou-qi
npx serve .
```

### 方式 3 · 直接打开

双击 `index.html` 即可（部分浏览器对 `file://` 协议下的 SVG 加载有限制，建议使用方式 1）。

## 玩法

| 棋子 | 等级 | 特殊能力 |
|------|------|----------|
| 象 | 8 | 最强，但**怕鼠** |
| 狮 | 7 | 可横向跳河 |
| 虎 | 6 | 可纵向跳河 |
| 豹 | 5 | — |
| 狼 | 4 | — |
| 狗 | 3 | — |
| 猫 | 2 | — |
| 鼠 | 1 | 可入水、可吃象 |

**胜负条件**：任一方棋子攻入对方**兽穴**即胜；**陷阱**内的棋子被对方任何棋子吃掉；**河流**只有鼠可入。

详细规则见 `rules.html`。

## 目录结构

```
dou-shou-qi/
├─ index.html          # 游戏主页面
├─ rules.html          # 规则说明页
├─ css/
│  ├─ style.css        # 主样式（4 段式布局）
│  └─ rules.css        # 规则页样式
├─ js/
│  └─ game.js          # 游戏逻辑
├─ assets/
│  └─ images/
│     ├─ red/          # 红方 SVG 棋子
│     ├─ blue/         # 蓝方 SVG 棋子
│     └─ 豆包*.png     # 原始素材（已 gitignore）
├─ trace.js            # PNG → SVG 矢量化脚本
├─ package.json
└─ .gitignore
```

## 棋子资源

棋子 SVG 由 `trace.js`（基于 [imagetracerjs](https://github.com/jankovicsandras/imagetracerjs)）从 PNG 矢量化生成：

```powershell
npm install
node trace.js
```

## 技术栈

- HTML5 / CSS3（CSS Grid + Flexbox + CSS Variables）
- 原生 JavaScript（ES6+，无框架）
- SVG 矢量图形

## 许可

MIT
