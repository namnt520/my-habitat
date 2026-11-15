/**
 * Renderer 2D (chế độ chính): nhìn từ trên xuống, zoom và kéo được, ba mức chi tiết (LOD).
 *
 *  - LOD 0 (zoom xa): mỗi cá thể là một ô vuông màu loài, gom theo loài để vẽ nhanh.
 *  - LOD 1 (zoom vừa): thân + đầu theo màu gen, có hướng.
 *  - LOD 2 (zoom gần): vẽ đầy đủ bằng code — chân, tai, đuôi, cánh, hoạt ảnh — phản ánh từng gen.
 *
 * Chỉ đọc `RenderSnapshot`; không có logic mô phỏng nào ở đây.
 */
import { CELL_SIZE, GRID, MOUNTAIN_LEVEL, WORLD_SIZE } from '../sim/constants';
import { State } from '../sim/entities';
import {
  CORPSE_STRIDE,
  type RenderSnapshot,
  SNAPSHOT_STRIDE,
  SNAP_FLAGS,
  SNAP_GENE_COLD,
  SNAP_GENE_HUE,
  SNAP_GENE_LIGHT,
  SNAP_GENE_SPECIAL,
  SNAP_GENE_SPEED,
  SNAP_GENE_VISION,
  SNAP_HEADING_X,
  SNAP_HEADING_Y,
  SNAP_ID,
  SNAP_MASS,
  SNAP_SPECIES,
  SNAP_STATE,
  SNAP_VX,
  SNAP_VY,
  SNAP_X,
  SNAP_Y,
} from '../sim/snapshot';
import { BODY_LENGTH, SPECIES_COLORS, type WorldRenderer, hash01 } from '../render/common';
import type { WorldMeta } from '../worker/protocol';
import { type CreatureLook, drawCreature, drawSimple } from './creatures';
import { GroundLayer } from './ground';

/** Ngưỡng zoom (px mỗi đơn vị bản đồ) giữa các mức chi tiết. */
const LOD_SIMPLE = 0.9;
const LOD_FULL = 2.4;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 14;
/** Chim đang bay được vẽ lệch lên trên chừng này (u) so với bóng của nó, cho cảm giác độ cao. */
const FLIGHT_HEIGHT = 9;

export class Renderer2D implements WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Gọi khi người dùng bấm (không kéo) lên bản đồ: toạ độ màn hình tính bằng px CSS. */
  onClick: ((screenX: number, screenY: number) => void) | null = null;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly ground = new GroundLayer();
  private meta: WorldMeta | null = null;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private cameraX = WORLD_SIZE / 2;
  private cameraY = WORLD_SIZE / 2;
  private zoom = 0.4;
  private follow = false;
  private groundTick = -1;
  private groundLevel = -1;
  private readonly look: CreatureLook = {
    shape: 'rabbit',
    length: 1,
    hue: 0,
    saturation: 0.5,
    lightness: 0.5,
    speed: 1,
    vision: 1,
    cold: 0.5,
    special: 0.5,
    male: false,
    juvenile: false,
    pregnant: false,
    sick: false,
    state: 0,
    motion: 0,
    phase: 0,
  };
  /** Bộ đệm toạ độ màn hình theo loài cho LOD 0. */
  private buckets: Float32Array[] = [];
  private bucketCounts: number[] = [];
  private readonly cleanup: (() => void)[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view-canvas';
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.bindInput();
  }

  // ───────────────────────────── Điều khiển camera ─────────────────────────────

  private bindInput(): void {
    const canvas = this.canvas;
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    const down = (event: PointerEvent): void => {
      dragging = true;
      moved = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent): void => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = event.clientX;
      lastY = event.clientY;
      if (moved > 4) {
        this.follow = false;
        this.cameraX -= dx / this.zoom;
        this.cameraY -= dy / this.zoom;
        this.clampCamera();
      }
    };
    const up = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      if (moved <= 4 && this.onClick) {
        const rect = canvas.getBoundingClientRect();
        this.onClick(event.clientX - rect.left, event.clientY - rect.top);
      }
    };
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const before = this.screenToWorld(sx, sy)!;
      this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * Math.exp(-event.deltaY * 0.0015)));
      // Giữ nguyên điểm dưới con trỏ khi zoom.
      this.cameraX = before.x - (sx - this.width / 2) / this.zoom;
      this.cameraY = before.y - (sy - this.height / 2) / this.zoom;
      this.clampCamera();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  private clampCamera(): void {
    this.cameraX = Math.min(WORLD_SIZE, Math.max(0, this.cameraX));
    this.cameraY = Math.min(WORLD_SIZE, Math.max(0, this.cameraY));
  }

  setWorld(meta: WorldMeta): void {
    this.meta = meta;
    this.ground.setWorld(meta);
    this.groundTick = -1;
    this.buckets = meta.animals.map(() => new Float32Array(2048));
    this.bucketCounts = meta.animals.map(() => 0);
    this.fitView();
  }

  /** Đặt camera để thấy trọn bản đồ. */
  fitView(): void {
    this.zoom = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, (Math.min(this.width, this.height) / WORLD_SIZE) * 0.98),
    );
    this.cameraX = WORLD_SIZE / 2;
    this.cameraY = WORLD_SIZE / 2;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.canvas.width = Math.round(this.width * pixelRatio);
    this.canvas.height = Math.round(this.height * pixelRatio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  setFollow(follow: boolean): void {
    this.follow = follow;
  }

  lookAt(x: number, y: number): void {
    this.cameraX = x;
    this.cameraY = y;
    if (this.zoom < 2) this.zoom = 3;
    this.clampCamera();
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } | null {
    return {
      x: this.cameraX + (screenX - this.width / 2) / this.zoom,
      y: this.cameraY + (screenY - this.height / 2) / this.zoom,
    };
  }

  /** Mức zoom hiện tại (px mỗi đơn vị) — để giao diện hiển thị và để đo đạc. */
  get zoomLevel(): number {
    return this.zoom;
  }

  /** Đặt zoom trực tiếp (dùng cho đo hiệu năng ở từng mức LOD). */
  setZoom(zoom: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  }

  pick(snapshot: RenderSnapshot, screenX: number, screenY: number): number {
    const world = this.screenToWorld(screenX, screenY)!;
    const animals = snapshot.animals;
    // Bán kính bắt chuột: tối thiểu 10 px để cá thể nhỏ vẫn bấm trúng được.
    const reach = Math.max(8, 12 / this.zoom);
    let best = 0;
    let bestDistance = reach * reach;
    for (let k = 0; k < snapshot.count; k++) {
      const o = k * SNAPSHOT_STRIDE;
      const dx = animals[o + SNAP_X] - world.x;
      const dy = animals[o + SNAP_Y] - world.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistance) {
        bestDistance = d2;
        best = animals[o + SNAP_ID];
      }
    }
    return best;
  }

  // ───────────────────────────── Vẽ ─────────────────────────────

  render(snapshot: RenderSnapshot, alpha: number, time: number, selectedId: number): void {
    const meta = this.meta;
    const ctx = this.ctx;
    if (!meta) return;
    const animals = snapshot.animals;

    // Lớp nền chỉ vẽ lại khi có trường mới hoặc mực nước/mùa đổi rõ rệt.
    if (
      snapshot.fields ||
      this.groundTick < 0 ||
      Math.abs(snapshot.climate.waterLevel - this.groundLevel) > 0.0008 ||
      snapshot.tick - this.groundTick > 240
    ) {
      this.ground.update(snapshot);
      this.groundTick = snapshot.tick;
      this.groundLevel = snapshot.climate.waterLevel;
    }

    if (this.follow && selectedId !== 0) {
      for (let k = 0; k < snapshot.count; k++) {
        const o = k * SNAPSHOT_STRIDE;
        if (animals[o + SNAP_ID] === selectedId) {
          this.cameraX += (animals[o + SNAP_X] + animals[o + SNAP_VX] * alpha - this.cameraX) * 0.15;
          this.cameraY += (animals[o + SNAP_Y] + animals[o + SNAP_VY] * alpha - this.cameraY) * 0.15;
          break;
        }
      }
    }

    const zoom = this.zoom;
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    const originX = halfW - this.cameraX * zoom;
    const originY = halfH - this.cameraY * zoom;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(this.ground.canvas, originX, originY, WORLD_SIZE * zoom, WORLD_SIZE * zoom);

    // Khung nhìn theo toạ độ thế giới (nới thêm một chút để vật thể ở mép không bị cắt cụt).
    const margin = 30;
    const left = this.cameraX - halfW / zoom - margin;
    const right = this.cameraX + halfW / zoom + margin;
    const top = this.cameraY - halfH / zoom - margin;
    const bottom = this.cameraY + halfH / zoom + margin;

    if (zoom >= 1.3) this.drawVegetation(snapshot, left, right, top, bottom, originX, originY);
    this.drawCorpses(snapshot, left, right, top, bottom, originX, originY);

    if (zoom < LOD_SIMPLE) {
      this.drawDots(snapshot, alpha, left, right, top, bottom, originX, originY, selectedId);
    } else {
      this.drawBodies(snapshot, alpha, time, left, right, top, bottom, originX, originY, selectedId);
    }

    // Đêm: phủ một lớp xanh thẫm; mưa: vài vệt xiên.
    const night = 1 - snapshot.climate.daylight;
    if (night > 0.02) {
      ctx.fillStyle = `rgba(8, 16, 48, ${(night * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (snapshot.climate.rain > 0) this.drawRain(snapshot.climate.rain, time);
  }

  /** Cây rừng, bụi cây và quả — rải cố định theo ô bằng hàm băm, chỉ vẽ ở zoom đủ gần. */
  private drawVegetation(
    snapshot: RenderSnapshot,
    left: number,
    right: number,
    top: number,
    bottom: number,
    originX: number,
    originY: number,
  ): void {
    const meta = this.meta!;
    const ctx = this.ctx;
    const zoom = this.zoom;
    const fields = this.ground.fields;
    const level = snapshot.climate.waterLevel;
    const cx0 = Math.max(0, Math.floor(left / CELL_SIZE));
    const cx1 = Math.min(GRID - 1, Math.floor(right / CELL_SIZE));
    const cy0 = Math.max(0, Math.floor(top / CELL_SIZE));
    const cy1 = Math.min(GRID - 1, Math.floor(bottom / CELL_SIZE));
    const autumn = snapshot.climate.season === 2;
    const winter = snapshot.climate.snow;
    const treeShades = winter
      ? ['#5d7a66', '#6f8c78', '#829c8a']
      : autumn
        ? ['#b06a1f', '#c8862a', '#8a5a1c']
        : ['#2f6e3a', '#3b8446', '#27592f'];

    // Bụi cây + quả (chỉ khi zoom gần).
    if (fields && zoom >= 2.2) {
      ctx.fillStyle = winter ? '#6b7f63' : '#3f7f45';
      ctx.beginPath();
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * GRID + cx;
          const shrub = fields.shrub[c];
          if (shrub < 40) continue;
          const bushes = shrub > 150 ? 2 : 1;
          for (let k = 0; k < bushes; k++) {
            const px = (cx + 0.15 + 0.7 * hash01(c * 7 + k)) * CELL_SIZE;
            const py = (cy + 0.15 + 0.7 * hash01(c * 13 + k + 5)) * CELL_SIZE;
            const radius = (1.4 + (shrub / 255) * 1.6) * zoom;
            ctx.moveTo(originX + px * zoom + radius, originY + py * zoom);
            ctx.arc(originX + px * zoom, originY + py * zoom, radius, 0, Math.PI * 2);
          }
        }
      }
      ctx.fill();
      ctx.fillStyle = '#c2185b';
      ctx.beginPath();
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * GRID + cx;
          const fruit = fields.fruit[c];
          if (fruit < 12 || fields.shrub[c] < 40) continue;
          const berries = Math.min(6, 1 + Math.floor(fruit / 30));
          const bx = (cx + 0.15 + 0.7 * hash01(c * 7)) * CELL_SIZE;
          const by = (cy + 0.15 + 0.7 * hash01(c * 13 + 5)) * CELL_SIZE;
          for (let k = 0; k < berries; k++) {
            const px = bx + (hash01(c * 31 + k) - 0.5) * 3.2;
            const py = by + (hash01(c * 37 + k) - 0.5) * 3.2;
            ctx.rect(
              originX + px * zoom - 0.3 * zoom,
              originY + py * zoom - 0.3 * zoom,
              0.6 * zoom,
              0.6 * zoom,
            );
          }
        }
      }
      ctx.fill();
    }

    // Tán cây: gom theo ba sắc độ để chỉ cần ba lần tô.
    for (let shade = 0; shade < 3; shade++) {
      ctx.fillStyle = treeShades[shade];
      ctx.beginPath();
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * GRID + cx;
          const cover = meta.canopy[c];
          if (cover < 0.3 || meta.elevation[c] < level || meta.elevation[c] > MOUNTAIN_LEVEL) continue;
          const trees = cover > 0.75 ? 2 : 1;
          for (let k = 0; k < trees; k++) {
            const seed = c * 3 + k;
            if (Math.floor(hash01(seed + 91) * 3) !== shade) continue;
            const px = (cx + hash01(seed)) * CELL_SIZE;
            const py = (cy + hash01(seed + 17)) * CELL_SIZE;
            const radius = (2.6 + 2.4 * hash01(seed + 29)) * (0.7 + 0.5 * cover) * zoom;
            ctx.moveTo(originX + px * zoom + radius, originY + py * zoom);
            ctx.arc(originX + px * zoom, originY + py * zoom, radius, 0, Math.PI * 2);
          }
        }
      }
      ctx.globalAlpha = 0.78;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawCorpses(
    snapshot: RenderSnapshot,
    left: number,
    right: number,
    top: number,
    bottom: number,
    originX: number,
    originY: number,
  ): void {
    const ctx = this.ctx;
    const zoom = this.zoom;
    const corpses = snapshot.corpses;
    ctx.fillStyle = '#7a1f1f';
    ctx.beginPath();
    for (let k = 0; k < snapshot.corpseCount; k++) {
      const x = corpses[k * CORPSE_STRIDE];
      const y = corpses[k * CORPSE_STRIDE + 1];
      if (x < left || x > right || y < top || y > bottom) continue;
      // Kích thước theo năng lượng còn lại (xác to rữa dần thì nhỏ đi).
      const size = Math.max(1.2, Math.min(7, Math.cbrt(corpses[k * CORPSE_STRIDE + 2]) * 0.7) * zoom);
      ctx.rect(originX + x * zoom - size / 2, originY + y * zoom - size / 2, size, size * 0.6);
    }
    ctx.fill();
    if (zoom >= LOD_FULL) {
      // Xương sườn trắng trên xác khi nhìn gần.
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = Math.max(1, 0.25 * zoom);
      ctx.beginPath();
      for (let k = 0; k < snapshot.corpseCount; k++) {
        const x = corpses[k * CORPSE_STRIDE];
        const y = corpses[k * CORPSE_STRIDE + 1];
        if (x < left || x > right || y < top || y > bottom) continue;
        const size = Math.max(1.2, Math.min(7, Math.cbrt(corpses[k * CORPSE_STRIDE + 2]) * 0.7) * zoom);
        for (let rib = -1; rib <= 1; rib++) {
          ctx.moveTo(originX + x * zoom + rib * size * 0.25, originY + y * zoom - size * 0.3);
          ctx.lineTo(originX + x * zoom + rib * size * 0.25, originY + y * zoom + size * 0.3);
        }
      }
      ctx.stroke();
    }
  }

  /** LOD 0: mỗi cá thể một ô vuông; gom theo loài để chỉ đổi màu tô vài lần. */
  private drawDots(
    snapshot: RenderSnapshot,
    alpha: number,
    left: number,
    right: number,
    top: number,
    bottom: number,
    originX: number,
    originY: number,
    selectedId: number,
  ): void {
    const meta = this.meta!;
    const ctx = this.ctx;
    const zoom = this.zoom;
    const animals = snapshot.animals;
    const counts = this.bucketCounts;
    counts.fill(0);
    let selectedX = -1;
    let selectedY = -1;
    for (let k = 0; k < snapshot.count; k++) {
      const o = k * SNAPSHOT_STRIDE;
      const x = animals[o + SNAP_X] + animals[o + SNAP_VX] * alpha;
      const y = animals[o + SNAP_Y] + animals[o + SNAP_VY] * alpha;
      if (x < left || x > right || y < top || y > bottom) continue;
      const species = animals[o + SNAP_SPECIES];
      let bucket = this.buckets[species];
      const n = counts[species];
      if (n * 2 + 2 > bucket.length) {
        const grown = new Float32Array(bucket.length * 2);
        grown.set(bucket);
        this.buckets[species] = bucket = grown;
      }
      bucket[n * 2] = originX + x * zoom;
      bucket[n * 2 + 1] = originY + y * zoom;
      counts[species] = n + 1;
      if (animals[o + SNAP_ID] === selectedId) {
        selectedX = bucket[n * 2];
        selectedY = bucket[n * 2 + 1];
      }
    }
    for (const species of meta.animals) {
      const n = counts[species.index];
      if (n === 0) continue;
      const bucket = this.buckets[species.index];
      const size = Math.max(1.6, (BODY_LENGTH[species.shape] ?? 5) * zoom * 0.9);
      const half = size / 2;
      ctx.fillStyle = SPECIES_COLORS[species.key] ?? '#fff';
      ctx.beginPath();
      for (let k = 0; k < n; k++) ctx.rect(bucket[k * 2] - half, bucket[k * 2 + 1] - half, size, size);
      ctx.fill();
    }
    if (selectedX >= 0) this.drawSelection(selectedX, selectedY, 9);
  }

  /** LOD 1 và 2: vẽ từng cá thể theo hướng nhìn; chim đang bay vẽ sau cùng, kèm bóng dưới đất. */
  private drawBodies(
    snapshot: RenderSnapshot,
    alpha: number,
    time: number,
    left: number,
    right: number,
    top: number,
    bottom: number,
    originX: number,
    originY: number,
    selectedId: number,
  ): void {
    const meta = this.meta!;
    const ctx = this.ctx;
    const zoom = this.zoom;
    const ratio = this.pixelRatio;
    const animals = snapshot.animals;
    const look = this.look;
    const full = zoom >= LOD_FULL;
    let selectedX = -1;
    let selectedY = -1;
    let selectedRadius = 10;

    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < snapshot.count; k++) {
        const o = k * SNAPSHOT_STRIDE;
        const species = meta.animals[animals[o + SNAP_SPECIES]];
        const state = animals[o + SNAP_STATE];
        const airborne =
          species.flying && state !== State.REST && state !== State.EAT && state !== State.HIBERNATE;
        if (airborne !== (pass === 1)) continue;
        const x = animals[o + SNAP_X] + animals[o + SNAP_VX] * alpha;
        const y = animals[o + SNAP_Y] + animals[o + SNAP_VY] * alpha;
        if (x < left || x > right || y < top || y > bottom) continue;

        const mass = animals[o + SNAP_MASS];
        const flags = animals[o + SNAP_FLAGS] | 0;
        const length = Math.max(3, (BODY_LENGTH[species.shape] ?? 5) * Math.cbrt(mass) * zoom);
        const sx = originX + x * zoom;
        const sy = originY + (airborne ? y - FLIGHT_HEIGHT : y) * zoom;
        const vx = animals[o + SNAP_VX];
        const vy = animals[o + SNAP_VY];
        const speed = Math.sqrt(vx * vx + vy * vy);

        if (airborne) {
          // Bóng của chim trên mặt đất.
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.beginPath();
          ctx.ellipse(originX + x * zoom, originY + y * zoom, length * 0.5, length * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        look.shape = species.shape;
        look.length = length;
        look.hue = animals[o + SNAP_GENE_HUE];
        look.saturation = species.saturation;
        look.lightness = animals[o + SNAP_GENE_LIGHT];
        look.speed = animals[o + SNAP_GENE_SPEED];
        look.vision = animals[o + SNAP_GENE_VISION];
        look.cold = animals[o + SNAP_GENE_COLD];
        look.special = animals[o + SNAP_GENE_SPECIAL];
        look.male = (flags & 1) !== 0;
        look.sick = (flags & 2) !== 0;
        look.pregnant = (flags & 4) !== 0;
        look.juvenile = (flags & 8) !== 0;
        look.state = state;
        look.motion = speed / 0.8;
        // Pha hoạt ảnh: bước chân nhanh theo tốc độ; mỗi cá thể lệch pha theo mã định danh.
        const id = animals[o + SNAP_ID];
        look.phase = time * (airborne ? 7 : 4 + speed * 9) + id * 1.7;

        const hx = animals[o + SNAP_HEADING_X];
        const hy = animals[o + SNAP_HEADING_Y];
        ctx.setTransform(hx * ratio, hy * ratio, -hy * ratio, hx * ratio, sx * ratio, sy * ratio);
        if (state === State.HIBERNATE) ctx.globalAlpha = 0.55;
        if (full) drawCreature(ctx, look);
        else drawSimple(ctx, look);
        ctx.globalAlpha = 1;

        if (id === selectedId) {
          selectedX = sx;
          selectedY = sy;
          selectedRadius = length * 0.9 + 6;
        }
      }
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (selectedX >= 0) this.drawSelection(selectedX, selectedY, selectedRadius);
  }

  private drawSelection(x: number, y: number, radius: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawRain(intensity: number, time: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(190, 215, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const drops = Math.floor(90 * intensity);
    for (let k = 0; k < drops; k++) {
      // Vị trí giả ngẫu nhiên trôi theo thời gian (chỉ là hiệu ứng hình ảnh).
      const x = ((hash01(k * 3 + 1) * 1.2 + time * 0.25) % 1.2) * this.width - this.width * 0.1;
      const y = ((hash01(k * 3 + 2) + time * (1.4 + hash01(k) * 0.6)) % 1) * this.height;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 12);
    }
    ctx.stroke();
  }

  dispose(): void {
    for (const off of this.cleanup) off();
    this.canvas.remove();
  }
}
