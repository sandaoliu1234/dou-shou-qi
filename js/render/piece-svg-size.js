/* ============================================================
   16 张棋子 SVG 的实测尺寸表
   ------------------------------------------------------------
   为什么需要这张表：
   这些 SVG **只有 viewBox，没有 width/height 属性**。
   - Three.js 的 TextureLoader 依赖 image.naturalWidth，无 width 的 SVG 在
     Firefox 下会返回 0，导致贴图黑块（2025 年起 Chrome 也复现）。
   - 因此 3D 模式必须走「canvas 光栅化 → CanvasTexture」，而canvas 的
     宽高必须由我们自己按 viewBox 指定。

   为什么要逐图而不是用统一值：
   16 张图的宽高比跨度是 0.701 ~ 0.792（±6.5%）。若统一按某一个
   viewBox（如blue/tiger 的 124x168）去贴图，最扁的 red/rat 会被纵向
   拉伸 13%，最方的 red/leopard 会被压扁。
   → 3D 的 PlaneGeometry 必须逐图按这张表定宽高比。

   数据来源：2026-10-04 用 node 逐文件实测，非估算。
   ============================================================ */
window.PIECE_SVG_SIZE = {
  blue: {
    elephant: { w: 118, h: 164 },
    lion:     { w: 119, h: 164 },
    tiger:    { w: 124, h: 168 },
    leopard:  { w: 120, h: 167 },
    wolf:     { w: 119, h: 167 },
    dog:      { w: 123, h: 172 },
    cat:      { w: 117, h: 162 },
    rat:      { w: 117, h: 160 }
  },
  red: {
    elephant: { w: 121, h: 157 },
    lion:     { w: 114, h: 155 },
    tiger:    { w: 121, h: 154 },
    leopard:  { w: 122, h: 154 },
    wolf:     { w: 120, h: 166 },
    dog:      { w: 118, h: 165 },
    cat:      { w: 121, h: 163 },
    rat:      { w: 115, h: 164 }
  }
};
