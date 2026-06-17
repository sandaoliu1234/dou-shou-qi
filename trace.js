const ImageTracer = require('imagetracerjs');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'assets', 'images', 'blue');
const files = ['cat.png', 'dog.png', 'elephant.png', 'leopard.png', 'lion.png', 'rat.png', 'tiger.png', 'wolf.png'];

const options = {
  ltres: 1,
  qtres: 1,
  pathomit: 8,
  rightangleenhance: true,
  colorsampling: 2,
  numberofcolors: 16,
  mincolorratio: 0,
  colorquantcycles: 3,
  strokewidth: 1,
  viewbox: true
};

function pngToImageData(file) {
  const buf = fs.readFileSync(file);
  const png = PNG.sync.read(buf);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength)
  };
}

function convert(name) {
  const src = path.join(dir, name);
  const dst = path.join(dir, name.replace(/\.png$/i, '.svg'));
  const imgd = pngToImageData(src);
  const svgstr = ImageTracer.imagedataToSVG(imgd, options);
  fs.writeFileSync(dst, svgstr, 'utf8');
  console.log('OK:', name, '->', path.basename(dst), `(${imgd.width}x${imgd.height})`);
}

for (const f of files) {
  try {
    convert(f);
  } catch (e) {
    console.error('FAIL:', f, e.message);
  }
}
