/**
 * Kịch bản "thí nghiệm Lotka–Volterra": biến đổi DỮ LIỆU loài (không sửa lõi) để chỉ còn một cặp
 * con mồi–kẻ săn thuần tuý trên đồng cỏ phẳng.
 *
 * So với hệ sinh thái đầy đủ, kịch bản này bỏ đi mọi thứ mà mô hình Lotka–Volterra không có:
 * mùa sinh sản (sinh sản quanh năm), lãnh thổ của cáo (số cáo chỉ phụ thuộc lượng thỏ), thức ăn thay thế của
 * cáo (chỉ săn thỏ), hang thỏ (không có nơi trú ẩn). Những khác biệt CÒN LẠI (cỏ hữu hạn, cáo biết no,
 * không gian, tuổi tác, ngẫu nhiên) chính là thứ thí nghiệm muốn phơi ra.
 */
import type { AnimalDef, BehaviorUse, SpeciesDef } from '../species/types';

/** Số lượng khởi đầu mặc định của thí nghiệm. */
export const LOTKA_VOLTERRA_COUNTS: Readonly<Record<string, number>> = { rabbit: 2000, fox: 100 };

const ALL_SEASONS = [0, 1, 2, 3];

/** Trả về bản sao của dữ liệu loài đã chỉnh cho thí nghiệm con mồi–kẻ săn. */
export function lotkaVolterraData(defs: readonly SpeciesDef[]): SpeciesDef[] {
  const clone = JSON.parse(JSON.stringify(defs)) as SpeciesDef[];
  const keep = (def: AnimalDef, names: string[]): BehaviorUse[] =>
    def.behaviors.filter((behavior) => names.includes(behavior.use));
  for (const def of clone) {
    if (def.kind === 'field') {
      // Cỏ ít hơn để sức chứa của thỏ khi không có cáo ở mức ~14.000 con (không quá nặng cho máy).
      if (def.key === 'grass') def.params.capacity = 90;
      continue;
    }
    def.life.breedingSeasons = ALL_SEASONS;
    def.life.territory = 0;
    if (def.key === 'rabbit') {
      def.burrows = false;
      def.behaviors = keep(def, ['flee', 'nurse', 'forage', 'mate', 'rest', 'wander']);
      for (const behavior of def.behaviors) {
        if (behavior.use !== 'forage') continue;
        const params = behavior.params as { sources: { field: string }[] };
        params.sources = params.sources.filter((source) => source.field === 'grass');
      }
    } else if (def.key === 'fox') {
      // Cáo trong thí nghiệm lớn nhanh và đẻ dày hơn cáo thật: số cáo phải kịp tăng/giảm theo số thỏ thì mới có
      // dao động. Tìm bạn đời trên toàn bản đồ ≈ giả định "trộn đều" của Lotka–Volterra.
      // Chạy nhanh hơn hẳn thỏ để cả cáo non vừa cai sữa cũng tự săn được (không có thức ăn thay thế nào khác).
      def.body.runSpeed = 3.3;
      def.body.reserveRatio = 1.6;
      def.life.maturity = 500;
      def.life.weanAge = 300;
      def.life.lifespan = 6000;
      def.life.cooldown = 400;
      def.life.litter = 2;
      def.life.mateRange = 2000;
      def.behaviors = keep(def, ['nurse', 'hunt', 'mate', 'rest', 'wander']);
      for (const behavior of def.behaviors) {
        if (behavior.use === 'hunt') {
          // Chỉ săn thỏ, và chỉ săn con nào NHÌN THẤY (bỏ đánh hơi tầm xa): tần suất gặp mồi khi đó tỉ lệ với
          // mật độ thỏ — đúng giả định "tác dụng khối lượng" βNP của Lotka–Volterra.
          const params = behavior.params as { prey: string[]; trackRange: number };
          params.prey = ['rabbit'];
          params.trackRange = 0;
        }
        if (behavior.use === 'wander') behavior.params = { range: 160 };
      }
    }
  }
  return clone;
}
