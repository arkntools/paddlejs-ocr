import { InitConfig } from '.';
import ppocrKeysV1 from './ppocrKeysV1';

const config: InitConfig = {
  detModel: 'https://js-models.bj.bcebos.com/PaddleOCR/PP-OCRv3/ch_PP-OCRv3_det_infer_js_960/model.json',
  recModel: 'https://js-models.bj.bcebos.com/PaddleOCR/PP-OCRv3/ch_PP-OCRv3_rec_infer_js/model.json',
  ocrChars: ppocrKeysV1,
};

export default config;
