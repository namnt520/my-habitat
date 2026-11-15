/**
 * Lãnh thổ sinh sản: định kỳ xác định những con cái nào "giữ được lãnh thổ" và do đó được phép sinh sản.
 *
 * Quy tắc (xét con cái trưởng thành theo thứ tự tuổi giảm dần — con lớn tuổi có quyền ưu tiên):
 *  - Loài có lãnh thổ: "nhà" của nó phải cách nhà của mọi con cái đã giữ lãnh thổ ít nhất `territory` đơn vị.
 *  - Loài sống theo bầy: mỗi bầy chỉ `packBreeders` con cái lớn tuổi nhất được sinh sản, và lãnh thổ tính giữa các bầy.
 *
 * Đây là cơ chế tự điều hoà mật độ có thật ở thú ăn thịt: quần thể càng dày thì càng nhiều con cái không có chỗ
 * để đẻ ("cá thể trôi nổi"), nên kẻ săn không tăng vượt mức con mồi nuôi nổi. Không có con số trần nào được đặt
 * sẵn — số lãnh thổ chứa được phụ thuộc vào bản đồ và vào nơi các con vật thật sự sinh sống.
 *
 * Vì sao là một hệ riêng thay vì kiểm tra trong module `mate`: con đực cũng chủ động tìm tới con cái, nên điều
 * kiện phải nằm trong "sẵn sàng giao phối" của con cái (xem `reproduction.ts`), không chỉ trong hành vi của nó.
 */
import { FLAG_BREEDER } from './entities';
import { isAdult } from './reproduction';
import type { Simulation } from './simulation';

/** Đánh dấu lại cờ FLAG_BREEDER cho mọi con cái của các loài có lãnh thổ. */
export function updateTerritories(sim: Simulation): void {
  const a = sim.animals;
  const members = sim.members;
  for (const sp of sim.registry.animals) {
    if (sp.territory <= 0) continue;
    const females: number[] = [];
    for (let k = members.start[sp.index]; k < members.start[sp.index + 1]; k++) {
      const i = members.items[k];
      if (a.alive[i] === 0 || a.sex[i] !== 0) continue;
      a.flags[i] &= ~FLAG_BREEDER;
      if (isAdult(sim, i)) females.push(i);
    }
    // Lớn tuổi trước; cùng tuổi thì mã định danh nhỏ trước (để kết quả tất định).
    females.sort((p, q) => a.age[q] - a.age[p] || a.id[p] - a.id[q]);
    const holders: number[] = [];
    const range2 = sp.territory * sp.territory;
    for (const i of females) {
      const group = a.group[i];
      let blocked = false;
      let seniorsInGroup = 0;
      for (const j of holders) {
        if (group >= 0 && a.group[j] === group) {
          if (++seniorsInGroup >= sp.packBreeders) {
            blocked = true;
            break;
          }
          continue;
        }
        const dx = a.homeX[j] - a.homeX[i];
        const dy = a.homeY[j] - a.homeY[i];
        if (dx * dx + dy * dy < range2) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        holders.push(i);
        a.flags[i] |= FLAG_BREEDER;
      }
    }
  }
}
