import clipper from 'js-clipper';
import { divide, enableBoundaryChecking, plus } from 'number-precision';
import cv from '@paddlejs-mediapipe/opencv/library/opencv_ocr';
import { polygonArea, polygonLength } from 'd3-polygon';
import cloneDeep from 'lodash.clonedeep';
import { clip } from './util';
import type { Box, Point, Points } from './type';

export default class DBPostprocess {
  private readonly thresh: number;
  private readonly box_thresh: number;
  private readonly max_candidates: number;
  private readonly unclip_ratio: number;
  private readonly min_size: number;
  private readonly pred: number[];
  private readonly segmentation: number[];
  private readonly width: number;
  private readonly height: number;

  constructor(result: number[], shape: number[], thresh = 0.3, box_thresh = 0.6, unclip_ratio = 1.5) {
    enableBoundaryChecking(false);
    this.thresh = thresh ? thresh : 0.3;
    this.box_thresh = box_thresh ? box_thresh : 0.6;
    this.max_candidates = 1000;
    this.unclip_ratio = unclip_ratio ? unclip_ratio : 1.5;
    this.min_size = 3;
    this.width = shape[0];
    this.height = shape[1];
    this.pred = result;
    this.segmentation = [];
    this.pred.forEach((item: number) => {
      this.segmentation.push(item > this.thresh ? 255 : 0);
    });
  }

  public outputBox() {
    const src = new cv.matFromArray(this.width, this.height, cv.CV_8UC1, this.segmentation);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    // 获取轮廓
    cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const num_contours = Math.min(contours.size(), this.max_candidates);
    const boxes: Box = [];
    const scores: number[] = [];
    const arr: number[] = [];
    for (let i = 0; i < num_contours; i++) {
      const contour = contours.get(i);
      const minBox = this.get_mini_boxes(contour);
      const points = minBox.points;
      let side = minBox.side;
      if (side < this.min_size) {
        continue;
      }
      const score = this.box_score_fast(this.pred, points);
      if (this.box_thresh > score) {
        continue;
      }
      const flatBox = this.unclip(points);
      const boxMap = new cv.matFromArray(flatBox.length / 2, 1, cv.CV_32SC2, flatBox);
      const resultObj = this.get_mini_boxes(boxMap);
      const box = resultObj.points;
      side = resultObj.side;
      if (side < this.min_size + 2) {
        continue;
      }
      box.forEach(item => {
        item[0] = clip(Math.round(item[0]), 0, this.width);
        item[1] = clip(Math.round(item[1]), 0, this.height);
      });
      boxes.push(box);
      scores.push(score);
      arr.push(i);
      boxMap.delete();
    }
    src.delete();
    contours.delete();
    hierarchy.delete();
    return { boxes, scores };
  }

  private get_mini_boxes(contour: any) {
    // 生成最小外接矩形
    const bounding_box = cv.minAreaRect(contour);
    const points: Points = [];
    const mat = new cv.Mat();
    // 获取矩形的四个顶点坐标
    cv.boxPoints(bounding_box, mat);
    for (let i = 0; i < mat.data32F.length; i += 2) {
      const arr: Point = [mat.data32F[i], mat.data32F[i + 1]];
      points.push(arr);
    }
    function sortNumber(a: Point, b: Point) {
      return a[0] - b[0];
    }
    points.sort(sortNumber);

    let index_1: number;
    let index_2: number;
    let index_3: number;
    let index_4: number;
    if (points[1][1] > points[0][1]) {
      index_1 = 0;
      index_4 = 1;
    } else {
      index_1 = 1;
      index_4 = 0;
    }

    if (points[3][1] > points[2][1]) {
      index_2 = 2;
      index_3 = 3;
    } else {
      index_2 = 3;
      index_3 = 2;
    }

    const box: Points = [points[index_1], points[index_2], points[index_3], points[index_4]];

    const side = Math.min(bounding_box.size.height, bounding_box.size.width);
    mat.delete();

    return { points: box, side };
  }

  private box_score_fast(bitmap: number[], _box: Points) {
    const h = this.height;
    const w = this.width;
    const box = cloneDeep(_box);
    const x: number[] = [];
    const y: number[] = [];
    box.forEach((item: Point) => {
      x.push(item[0]);
      y.push(item[1]);
    });
    // clip这个函数将将数组中的元素限制在a_min, a_max之间，大于a_max的就使得它等于 a_max，小于a_min,的就使得它等于a_min。
    const xmin = clip(Math.floor(Math.min(...x)), 0, w - 1);
    const xmax = clip(Math.ceil(Math.max(...x)), 0, w - 1);
    const ymin = clip(Math.floor(Math.min(...y)), 0, h - 1);
    const ymax = clip(Math.ceil(Math.max(...y)), 0, h - 1);
    // eslint-disable-next-line new-cap
    const mask = new cv.Mat.zeros(ymax - ymin + 1, xmax - xmin + 1, cv.CV_8UC1);
    box.forEach((item: Point) => {
      item[0] = Math.max(item[0] - xmin, 0);
      item[1] = Math.max(item[1] - ymin, 0);
    });
    const npts = 4;
    const point_data = new Uint8Array(box.flat());
    const points = cv.matFromArray(npts, 1, cv.CV_32SC2, point_data);
    const pts = new cv.MatVector();
    pts.push_back(points);
    const color = new cv.Scalar(255);
    // 多个多边形填充
    cv.fillPoly(mask, pts, color, 1);
    const sliceArr: number[] = [];
    for (let i = ymin; i < ymax + 1; i++) {
      sliceArr.push(...bitmap.slice(this.width * i + xmin, this.height * i + xmax + 1));
    }
    const mean = this.mean(sliceArr, mask.data);
    mask.delete();
    points.delete();
    pts.delete();
    return mean;
  }

  private unclip(box: Points) {
    const unclip_ratio = this.unclip_ratio;
    const area = Math.abs(polygonArea(box));
    const length = polygonLength(box);
    const distance = (area * unclip_ratio) / length;
    const tmpArr: { X: number; Y: number }[] = [];
    box.forEach(item => {
      const obj = {
        X: 0,
        Y: 0,
      };
      obj.X = item[0];
      obj.Y = item[1];
      tmpArr.push(obj);
    });
    const offset = new clipper.ClipperOffset();
    offset.AddPath(tmpArr, clipper.JoinType.jtRound, clipper.EndType.etClosedPolygon);
    const expanded: { X: number; Y: number }[][] = [];
    offset.Execute(expanded, distance);
    const expandedArr: Points = [];
    expanded[0]?.forEach(item => {
      expandedArr.push([item.X, item.Y]);
    });
    return expandedArr.flat();
  }

  private mean(data: number[], mask: number[]) {
    let sum = 0;
    let length = 0;
    for (let i = 0; i < data.length; i++) {
      if (mask[i]) {
        sum = plus(sum, data[i]);
        length++;
      }
    }
    return divide(sum, length);
  }
}
