import './hack';
import { Runner, env } from '@paddlejs/paddlejs-core';
import '@paddlejs/paddlejs-backend-webgl';
import cloneDeep from 'lodash.clonedeep';
import type { Box, Points, Point } from './type';
import DBProcess from './dbPostprocess';
import RecProcess from './recPostprocess';
import cv from '@paddlejs-mediapipe/opencv/library/opencv_ocr';
import { flatten, int, clip } from './util';

export interface DrawBoxOptions {
  canvas?: HTMLCanvasElement;
  style?: CanvasStyleOptions;
}

export interface CanvasStyleOptions {
  strokeStyle?: string;
  lineWidth?: number;
  fillStyle?: string;
}

export interface DetPostConfig {
  shape: number;
  thresh: number;
  box_thresh: number;
  unclip_ratio: number;
}

export interface InitConfig {
  detModel: string;
  recModel: string;
  ocrChars: string | string[];
}

const defaultPostConfig: DetPostConfig = {
  shape: 960,
  thresh: 0.3,
  box_thresh: 0.6,
  unclip_ratio: 1.5,
};

let DEFAULT_DET_SHAPE = 960;
let REC_WIDTH = 320;
let REC_HEIGHT = 32;
const canvas_det = new OffscreenCanvas(0, 0);
const canvas_rec = new OffscreenCanvas(0, 0);
let detectRunner = null as Runner;
let recRunner = null as Runner;

export async function init(params: InitConfig) {
  env.set('webgl_pack_output', true);
  env.set('canvas', new OffscreenCanvas(0, 0));
  env.set('canvas2d', new OffscreenCanvas(0, 0));

  detectRunner = new Runner({
    modelPath: params.detModel,
    fill: '#fff',
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    bgr: true,
    webglFeedProcess: true,
  });
  const detectInit = detectRunner.init();

  recRunner = new Runner({
    modelPath: params.recModel,
    fill: '#000',
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    bgr: true,
    webglFeedProcess: true,
  });
  const recInit = recRunner.init();

  await Promise.all([detectInit, recInit]);

  RecProcess.ocrCharacter = params.ocrChars;
  if (detectRunner.feedShape) {
    DEFAULT_DET_SHAPE = detectRunner.feedShape.fw;
  }
  if (recRunner.feedShape) {
    REC_WIDTH = recRunner.feedShape.fw;
    REC_HEIGHT = recRunner.feedShape.fh;
  }
}

async function detect(image: ImageBitmap, Config: DetPostConfig = defaultPostConfig) {
  // 目标尺寸
  const DET_SHAPE = Config.shape ? Config.shape : DEFAULT_DET_SHAPE;
  const thresh = Config.thresh;
  const box_thresh = Config.box_thresh;
  const unclip_ratio = Config.unclip_ratio;

  const targetWidth = DET_SHAPE;
  const targetHeight = DET_SHAPE;
  canvas_det.width = targetWidth;
  canvas_det.height = targetHeight;
  // 通过canvas将上传原图大小转换为目标尺寸
  const ctx = canvas_det.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, targetHeight, targetWidth);
  // 缩放后的宽高
  let sw = targetWidth;
  let sh = targetHeight;
  let x = 0;
  let y = 0;
  // target的长宽比大些 就把原图的高变成target那么高
  if (((targetWidth / targetHeight) * image.height) / image.width >= 1) {
    sw = Math.round((sh * image.width) / image.height);
    x = Math.floor((targetWidth - sw) / 2);
  }
  // target的长宽比小些 就把原图的宽变成target那么宽
  else {
    sh = Math.round((sw * image.height) / image.width);
    y = Math.floor((targetHeight - sh) / 2);
  }
  ctx.drawImage(image, x, y, sw, sh);
  const shapeList = [DET_SHAPE, DET_SHAPE];
  const outsDict = await detectRunner.predict(canvas_det);
  const postResult = new DBProcess(outsDict, shapeList, thresh, box_thresh, unclip_ratio);
  // 获取坐标
  const result = postResult.outputBox();
  // 转换原图坐标
  const points = cloneDeep(result.boxes);
  // 框选调整大小
  const adjust = 8;
  points.forEach(item => {
    item.forEach((point, index) => {
      // 扩大框选区域，便于文字识别
      point[0] = clip(
        (Math.round(point[0] - x) * Math.max(image.width, image.height)) / DET_SHAPE +
          (index === 0 ? -adjust : index === 1 ? adjust : index === 2 ? adjust : -adjust),
        0,
        image.width,
      );
      point[1] = clip(
        (Math.round(point[1] - y) * Math.max(image.width, image.height)) / DET_SHAPE +
          (index === 0 ? -adjust : index === 1 ? -adjust : index === 2 ? adjust : adjust),
        0,
        image.height,
      );
    });
  });
  return points;
}

function drawBox(points: Box, image: ImageBitmap, canvas: HTMLCanvasElement, style?: CanvasStyleOptions) {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  points.forEach((point: [number, number][]) => {
    // 开始一个新的绘制路径
    ctx.beginPath();
    // 设置绘制线条颜色，默认为黑色
    ctx.strokeStyle = style?.strokeStyle || '#000';
    // 设置线段宽度，默认为1
    ctx.lineWidth = style?.lineWidth || 1;
    // 设置填充颜色，默认透明
    ctx.fillStyle = style?.fillStyle || 'transparent';
    // 设置路径起点坐标
    ctx.moveTo(point[0][0], point[0][1]);
    ctx.lineTo(point[1][0], point[1][1]);
    ctx.lineTo(point[2][0], point[2][1]);
    ctx.lineTo(point[3][0], point[3][1]);
    // 进行内容填充
    ctx.fill();
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  });
}

/**
 * 文本识别
 * @param {Blob | ArrayBuffer} file 原图
 * @param {Object} options 绘制文本框配置参数
 * @param detConfig 识别相关可调参数
 */
export async function recognize(
  file: Blob | ArrayBuffer,
  options?: DrawBoxOptions,
  detConfig: DetPostConfig = defaultPostConfig,
) {
  const image = await createImageBitmap(file instanceof Blob ? file : new Blob([file]));
  try {
    // 文本框选坐标点
    const point = await detect(image, detConfig);
    // 绘制文本框
    if (options?.canvas) {
      drawBox(point, image, options.canvas, options.style);
    }
    const boxes = sorted_boxes(point);
    const text_list: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const tmp_box = cloneDeep(boxes[i]);
      get_rotate_crop_image(image, tmp_box);
      // 默认ratio=3，3是经验值，可根据实际情况调整。
      const ratio = 3;
      const width_num = Math.ceil(canvas_det.width / REC_WIDTH / ratio);
      let text_list_tmp = '';
      // 根据ratio*RECWIDTH宽度进行裁剪拼接
      for (let i = 0; i < width_num; i++) {
        resize_norm_img_splice(canvas_det, canvas_det.width, canvas_det.height, i, ratio);
        const output = await recRunner.predict(canvas_rec);
        const recResult = new RecProcess(output);
        const text = recResult.outputResult();
        text_list_tmp = text_list_tmp.concat(text.text);
      }

      text_list.push(text_list_tmp);
    }
    return { text: text_list, points: point };
  } finally {
    image.close();
  }
}

function sorted_boxes(box: Box) {
  function sortNumber(a: Points, b: Points) {
    return a[0][1] - b[0][1];
  }

  const boxes = box.sort(sortNumber);
  const num_boxes = boxes.length;
  for (let i = 0; i < num_boxes - 1; i++) {
    if (Math.abs(boxes[i + 1][0][1] - boxes[i][0][1]) < 10 && boxes[i + 1][0][0] < boxes[i][0][0]) {
      const tmp = boxes[i];
      boxes[i] = boxes[i + 1];
      boxes[i + 1] = tmp;
    }
  }
  return boxes;
}

function get_rotate_crop_image(img: OffscreenCanvas | ImageBitmap, points: Points) {
  const img_crop_width = int(Math.max(linalg_norm(points[0], points[1]), linalg_norm(points[2], points[3])));
  const img_crop_height = int(Math.max(linalg_norm(points[0], points[3]), linalg_norm(points[1], points[2])));
  const pts_std = [
    [0, 0],
    [img_crop_width, 0],
    [img_crop_width, img_crop_height],
    [0, img_crop_height],
  ];
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, flatten(points));
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, flatten(pts_std));
  // 获取到目标矩阵
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const src = cv.imread(img);
  const dst = new cv.Mat();
  const dsize = new cv.Size(img_crop_width, img_crop_height);
  // 透视转换
  cv.warpPerspective(src, dst, M, dsize, cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
  const dst_img_height = dst.matSize[0];
  const dst_img_width = dst.matSize[1];
  let dst_rot;
  // 图像旋转
  if (dst_img_height / dst_img_width >= 1.5) {
    dst_rot = new cv.Mat();
    const dsize_rot = new cv.Size(dst.rows, dst.cols);
    const center = new cv.Point(dst.cols / 2, dst.cols / 2);
    const M = cv.getRotationMatrix2D(center, 90, 1);
    cv.warpAffine(dst, dst_rot, M, dsize_rot, cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
  }

  const dst_resize = new cv.Mat();
  const dsize_resize = new cv.Size(0, 0);
  let scale;
  if (dst_rot) {
    scale = REC_HEIGHT / dst_rot.matSize[0];
    cv.resize(dst_rot, dst_resize, dsize_resize, scale, scale, cv.INTER_AREA);
    dst_rot.delete();
  } else {
    scale = REC_HEIGHT / dst_img_height;
    cv.resize(dst, dst_resize, dsize_resize, scale, scale, cv.INTER_AREA);
  }
  canvas_det.width = dst_resize.matSize[1];
  canvas_det.height = dst_resize.matSize[0];
  cv.imshow(canvas_det, dst_resize);

  src.delete();
  dst.delete();
  dst_resize.delete();
  srcTri.delete();
  dstTri.delete();
}

function linalg_norm(x: Point, y: Point) {
  return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2));
}

function resize_norm_img_splice(
  image: ImageBitmap | OffscreenCanvas,
  origin_width: number,
  origin_height: number,
  index = 0,
  ratio = 3,
) {
  canvas_rec.width = REC_WIDTH;
  canvas_rec.height = REC_HEIGHT;
  const ctx = canvas_rec.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.clearRect(0, 0, canvas_rec.width, canvas_rec.height);
  ctx.drawImage(image, -index * REC_WIDTH * ratio, 0, origin_width, origin_height);
}
