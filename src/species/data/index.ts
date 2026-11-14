/**
 * Danh mục loài. THỨ TỰ trong mảng quyết định chỉ số loài (và do đó cả thứ tự rút số ngẫu nhiên lúc khởi tạo),
 * nên thêm loài mới thì thêm vào CUỐI danh sách của nhóm tương ứng.
 *
 * Thêm loài mới: tạo `<tên>.json` theo lược đồ trong `../types.ts`, import và thêm vào mảng dưới đây.
 */
import type { SpeciesDef } from '../types';
import algae from './algae.json';
import bear from './bear.json';
import boar from './boar.json';
import deer from './deer.json';
import eagle from './eagle.json';
import fish from './fish.json';
import fox from './fox.json';
import frog from './frog.json';
import fungi from './fungi.json';
import grass from './grass.json';
import insects from './insects.json';
import rabbit from './rabbit.json';
import shrub from './shrub.json';
import vulture from './vulture.json';
import wolf from './wolf.json';

export const SPECIES_DATA = [
  // Trường mật độ
  grass,
  shrub,
  algae,
  insects,
  fungi,
  // Động vật khởi đầu
  rabbit,
  deer,
  fox,
  wolf,
  eagle,
  bear,
  frog,
  fish,
  vulture,
  // Loài xâm lấn (không có mặt lúc khởi đầu)
  boar,
] as unknown as readonly SpeciesDef[];
