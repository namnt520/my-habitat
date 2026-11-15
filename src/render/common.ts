/**
 * Phần dùng chung của hai renderer (2D và 3D). Renderer chỉ đọc `RenderSnapshot` và `WorldMeta`.
 */
import type { RenderSnapshot } from '../sim/snapshot';
import type { WorldMeta } from '../worker/protocol';

/** Giao diện chung để giao diện người dùng đổi qua lại 2D ↔ 3D khi đang chạy. */
export interface WorldRenderer {
  /** Phần tử canvas của renderer (được gắn vào trang). */
  readonly canvas: HTMLCanvasElement;
  /** Nhận dữ liệu tĩnh của thế giới (gọi lại mỗi khi khởi tạo mô phỏng mới). */
  setWorld(meta: WorldMeta): void;
  resize(width: number, height: number, pixelRatio: number): void;
  /**
   * Vẽ một khung hình.
   * @param alpha số tick (có thể lẻ) đã trôi qua kể từ ảnh chụp — dùng để nội suy vị trí theo vận tốc
   * @param time đồng hồ thực (giây) cho hoạt ảnh
   */
  render(snapshot: RenderSnapshot, alpha: number, time: number, selectedId: number): void;
  /** Mã định danh của cá thể tại toạ độ màn hình (px), hoặc 0. */
  pick(snapshot: RenderSnapshot, screenX: number, screenY: number): number;
  /** Toạ độ thế giới tại toạ độ màn hình (để đặt thảm hoạ bằng chuột); null nếu không trúng mặt đất. */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } | null;
  /** Bật/tắt bám theo cá thể đang chọn. */
  setFollow(follow: boolean): void;
  /** Đưa camera về nhìn một điểm của thế giới. */
  lookAt(x: number, y: number): void;
  dispose(): void;
}

/** Đổi HSL (mỗi thành phần trong [0, 1]) sang RGB (mỗi thành phần trong [0, 1]). */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

/** Chuỗi màu CSS từ gen màu của một cá thể. */
export function coatColor(hue: number, saturation: number, lightness: number, lighten = 0): string {
  const l = Math.min(0.95, Math.max(0.05, lightness + lighten));
  return `hsl(${(hue * 360).toFixed(0)} ${(saturation * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

/** Chiều dài thân chuẩn (u) của từng kiểu hình dạng, cho con trưởng thành có gen kích thước = 1. */
export const BODY_LENGTH: Record<string, number> = {
  rabbit: 4.2,
  deer: 13,
  fox: 7,
  wolf: 10,
  bear: 15,
  eagle: 6,
  vulture: 7,
  frog: 2.6,
  fish: 4,
  boar: 10,
};

/** Màu đại diện của loài trên biểu đồ và ở mức chi tiết thấp nhất. */
export const SPECIES_COLORS: Record<string, string> = {
  grass: '#7cb342',
  shrub: '#b06cd0',
  algae: '#26a69a',
  insects: '#fdd835',
  fungi: '#bcaaa4',
  rabbit: '#ead7b2',
  deer: '#c98b4b',
  fox: '#ff7a2f',
  wolf: '#9fb1c1',
  eagle: '#f6c445',
  bear: '#a0705a',
  frog: '#58c26b',
  fish: '#3fb8f5',
  vulture: '#c9a0dc',
  boar: '#e0669c',
  corpse: '#e05252',
  detritus: '#8d6e63',
  sun: '#ffca28',
};

/** Băm nguyên → số trong [0, 1) — để rải chi tiết trang trí (cây, bụi cỏ) cố định theo ô. */
export function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
