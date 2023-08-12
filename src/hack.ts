import cv from '@paddlejs-mediapipe/opencv/library/opencv_ocr';

if (!self.window) self.window = self;

cv.imshow = (canvas: OffscreenCanvas, mat) => {
  const img = new cv.Mat();
  const depth = mat.type() % 8;
  const scale = depth <= cv.CV_8S ? 1 : depth <= cv.CV_32S ? 1 / 256 : 255;
  const shift = depth === cv.CV_8S || depth === cv.CV_16S ? 128 : 0;
  mat.convertTo(img, cv.CV_8U, scale, shift);
  switch (img.type()) {
    case cv.CV_8UC1:
      cv.cvtColor(img, img, cv.COLOR_GRAY2RGBA);
      break;
    case cv.CV_8UC3:
      cv.cvtColor(img, img, cv.COLOR_RGB2RGBA);
      break;
    case cv.CV_8UC4:
      break;
    default:
      throw new Error('Bad number of channels (Source image must have 1, 3 or 4 channels)');
  }
  const imgData = new ImageData(new Uint8ClampedArray(img.data), img.cols, img.rows);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = imgData.width;
  canvas.height = imgData.height;
  ctx.putImageData(imgData, 0, 0);
  img.delete();
};

cv.imread = (img: ImageBitmap) => {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, img.width, img.height);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return cv.matFromImageData(imgData);
};
