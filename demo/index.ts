import * as ocr from '../src/index';

const loading = document.getElementById('isLoading');
const txt = document.getElementById('txt');
const inputElement = document.getElementById('uploadImg');
const canvasOutput = document.getElementById('canvas') as HTMLCanvasElement;

load();

async function load() {
  await ocr.init();
  loading.style.display = 'none';
}

inputElement.addEventListener(
  'change',
  async (e: Event) => {
    txt.innerHTML = '';
    // 获取文本检测坐标及识别内容
    const res = await ocr.recognize((e.target as HTMLInputElement).files[0], {
      canvas: canvasOutput,
      style: { strokeStyle: 'red', lineWidth: 2 },
    });
    console.log(res);
    txt.innerHTML = res.text.join('\n');
  },
  false,
);
