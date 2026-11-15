/**
 * Vẽ sinh vật bằng code (không dùng ảnh): thân, đầu, chân/cánh/vây, đuôi — nhìn từ trên xuống.
 *
 * Mọi hàm vẽ tại gốc toạ độ với đầu hướng theo trục +x; renderer lo việc tịnh tiến và xoay.
 * Ngoại hình phản ánh gen:
 *   - kích thước  → chiều dài thân (tham số `length`)
 *   - màu lông    → sắc độ + độ sáng của thân
 *   - tốc độ      → chân (hoặc vây đuôi) dài hơn
 *   - tầm nhìn    → mắt to hơn (và tai thỏ dài hơn)
 *   - chịu lạnh   → thân xù to hơn, có viền lông sáng; đuôi cáo bông hơn
 *   - gen đặc thù → sải cánh (chim), độ béo (gấu), gạc (hươu đực)…
 */
import { State } from '../sim/entities';
import { coatColor } from '../render/common';

export interface CreatureLook {
  shape: string;
  /** Chiều dài thân tính bằng điểm ảnh. */
  length: number;
  hue: number;
  saturation: number;
  lightness: number;
  /** Gen (kiểu hình): tốc độ, tầm nhìn quanh 1; chịu lạnh và gen đặc thù trong [0, 1]. */
  speed: number;
  vision: number;
  cold: number;
  special: number;
  male: boolean;
  juvenile: boolean;
  pregnant: boolean;
  sick: boolean;
  state: number;
  /** Đang di chuyển nhanh cỡ nào so với đi bộ (0 = đứng yên). */
  motion: number;
  /** Pha hoạt ảnh (radian). */
  phase: number;
}

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rotation = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, TAU);
  ctx.fill();
}

function eyes(ctx: Ctx, x: number, spread: number, radius: number): void {
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(x, -spread, radius, 0, TAU);
  ctx.arc(x, spread, radius, 0, TAU);
  ctx.fill();
}

interface QuadrupedShape {
  width: number;
  neck: number;
  headLength: number;
  headWidth: number;
  legLength: number;
  legWidth: number;
  ears: 'long' | 'pointed' | 'round' | 'side' | 'none';
  tail: 'puff' | 'bushy' | 'thin' | 'short' | 'none';
  snout: number;
}

const QUADRUPEDS: Record<string, QuadrupedShape> = {
  rabbit: {
    width: 0.56,
    neck: 0,
    headLength: 0.36,
    headWidth: 0.32,
    legLength: 0.16,
    legWidth: 0.09,
    ears: 'long',
    tail: 'puff',
    snout: 0,
  },
  deer: {
    width: 0.34,
    neck: 0.12,
    headLength: 0.26,
    headWidth: 0.16,
    legLength: 0.24,
    legWidth: 0.05,
    ears: 'side',
    tail: 'short',
    snout: 0.06,
  },
  fox: {
    width: 0.32,
    neck: 0.04,
    headLength: 0.3,
    headWidth: 0.24,
    legLength: 0.17,
    legWidth: 0.055,
    ears: 'pointed',
    tail: 'bushy',
    snout: 0.1,
  },
  wolf: {
    width: 0.36,
    neck: 0.06,
    headLength: 0.3,
    headWidth: 0.25,
    legLength: 0.2,
    legWidth: 0.06,
    ears: 'pointed',
    tail: 'thin',
    snout: 0.1,
  },
  bear: {
    width: 0.6,
    neck: 0,
    headLength: 0.3,
    headWidth: 0.3,
    legLength: 0.14,
    legWidth: 0.11,
    ears: 'round',
    tail: 'none',
    snout: 0.07,
  },
  boar: {
    width: 0.5,
    neck: 0,
    headLength: 0.3,
    headWidth: 0.26,
    legLength: 0.13,
    legWidth: 0.07,
    ears: 'side',
    tail: 'thin',
    snout: 0.14,
  },
};

function drawQuadruped(ctx: Ctx, look: CreatureLook, shape: QuadrupedShape): void {
  const L = look.length;
  const body = coatColor(look.hue, look.saturation, look.lightness);
  const dark = coatColor(look.hue, look.saturation, look.lightness, -0.16);
  const light = coatColor(look.hue, look.saturation * 0.6, look.lightness, 0.22);
  const fat = look.shape === 'bear' ? 0.85 + 0.35 * look.special : 1;
  const halfWidth = (shape.width * L * (1 + 0.22 * look.cold) * fat * (look.pregnant ? 1.14 : 1)) / 2;
  const swing = Math.sin(look.phase) * Math.min(1, look.motion) * 0.13 * L;
  const resting = look.state === State.REST || look.state === State.HIBERNATE;

  // Bóng đổ mờ dưới thân giúp con vật tách khỏi nền.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  ellipse(ctx, 0.03 * L, 0.05 * L, 0.52 * L, halfWidth * 1.08);

  // Chân: nhìn từ trên xuống chỉ thấy phần bàn chân thò ra khỏi thân, choãi về trước/sau theo nhịp bước.
  // Gen tốc độ làm chân dài ra.
  if (!resting) {
    const reach = shape.legLength * L * (0.35 + 0.55 * (look.speed - 0.6));
    ctx.strokeStyle = dark;
    ctx.lineWidth = shape.legWidth * L;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [x, side, direction] of [
      [0.3, 1, 1],
      [0.3, -1, -1],
      [-0.3, 1, -1],
      [-0.3, -1, 1],
    ] as const) {
      const lean = (x > 0 ? 0.06 : -0.06) * L;
      ctx.moveTo(x * L, side * halfWidth * 0.55);
      ctx.lineTo(x * L + lean + swing * direction, side * (halfWidth * 0.9 + reach));
    }
    ctx.stroke();
  }

  // Đuôi.
  const wag = Math.sin(look.phase * 0.7) * 0.12;
  switch (shape.tail) {
    case 'puff':
      ctx.fillStyle = '#f4f1ea';
      ellipse(ctx, -0.52 * L, 0, 0.11 * L, 0.11 * L);
      break;
    case 'bushy': {
      const thickness = (0.13 + 0.12 * look.cold) * L;
      ctx.fillStyle = body;
      ellipse(ctx, -0.74 * L, wag * L, 0.34 * L, thickness, wag);
      ctx.fillStyle = '#f4f1ea';
      ellipse(ctx, -1.0 * L, wag * 1.9 * L, 0.11 * L, thickness * 0.7, wag);
      break;
    }
    case 'thin':
      ctx.strokeStyle = dark;
      ctx.lineWidth = (0.06 + 0.05 * look.cold) * L;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-0.46 * L, 0);
      ctx.quadraticCurveTo(-0.66 * L, wag * L, -0.84 * L, wag * 1.6 * L);
      ctx.stroke();
      break;
    case 'short':
      ctx.fillStyle = '#f4f1ea';
      ellipse(ctx, -0.5 * L, 0, 0.07 * L, 0.05 * L);
      break;
    case 'none':
      break;
  }

  // Thân; lông dày (gen chịu lạnh) thêm một viền sáng xù.
  if (look.cold > 0.45) {
    ctx.fillStyle = light;
    ellipse(ctx, 0, 0, 0.5 * L + look.cold * 0.05 * L, halfWidth + look.cold * 0.06 * L);
  }
  ctx.fillStyle = body;
  ellipse(ctx, 0, 0, 0.5 * L, halfWidth);
  if (look.shape === 'wolf' || look.shape === 'boar') {
    ctx.fillStyle = dark;
    ellipse(ctx, -0.04 * L, 0, 0.4 * L, halfWidth * 0.42);
  }
  if (look.shape === 'deer' && look.juvenile) {
    // Hươu non có đốm trắng.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    for (let k = 0; k < 5; k++)
      ctx.rect((-0.3 + 0.14 * k) * L, (k % 2 === 0 ? -0.3 : 0.2) * halfWidth, 0.05 * L, 0.05 * L);
    ctx.fill();
  }

  // Cổ và đầu.
  const headX = (0.5 + shape.neck + shape.headLength * 0.35) * L;
  if (shape.neck > 0) {
    ctx.fillStyle = body;
    ellipse(ctx, (0.42 + shape.neck * 0.5) * L, 0, (shape.neck + 0.12) * L, shape.headWidth * 0.42 * L);
  }
  const headHalfLength = (shape.headLength * L) / 2;
  const headHalfWidth = (shape.headWidth * L) / 2;
  const earSize = 0.8 + 0.5 * (look.vision - 0.6);
  ctx.fillStyle = dark;
  switch (shape.ears) {
    case 'long': {
      // Tai thỏ ngả ra sau; thỏ tinh mắt thính tai (gen tầm nhìn) thì tai dài hơn.
      const earLength = 0.2 * L * earSize;
      ellipse(ctx, headX - earLength * 0.9, -headHalfWidth * 0.55, earLength, 0.055 * L, 0.25);
      ellipse(ctx, headX - earLength * 0.9, headHalfWidth * 0.55, earLength, 0.055 * L, -0.25);
      break;
    }
    case 'pointed':
      ctx.beginPath();
      for (const side of [-1, 1]) {
        ctx.moveTo(headX - headHalfLength * 0.2, side * headHalfWidth * 0.5);
        ctx.lineTo(headX - headHalfLength * 0.9, side * (headHalfWidth + 0.09 * L * earSize));
        ctx.lineTo(headX - headHalfLength * 1.0, side * headHalfWidth * 0.3);
      }
      ctx.fill();
      break;
    case 'round':
      ellipse(ctx, headX - headHalfLength * 0.5, -headHalfWidth * 0.95, 0.07 * L, 0.07 * L);
      ellipse(ctx, headX - headHalfLength * 0.5, headHalfWidth * 0.95, 0.07 * L, 0.07 * L);
      break;
    case 'side':
      ellipse(ctx, headX - headHalfLength * 0.5, -headHalfWidth * 1.25, 0.09 * L * earSize, 0.04 * L, -0.6);
      ellipse(ctx, headX - headHalfLength * 0.5, headHalfWidth * 1.25, 0.09 * L * earSize, 0.04 * L, 0.6);
      break;
    case 'none':
      break;
  }
  ctx.fillStyle = body;
  if (shape.snout > 0) {
    // Đầu thuôn về phía mõm.
    ctx.beginPath();
    ctx.moveTo(headX - headHalfLength, -headHalfWidth);
    ctx.quadraticCurveTo(
      headX + headHalfLength * 0.4,
      -headHalfWidth,
      headX + headHalfLength + shape.snout * L,
      0,
    );
    ctx.quadraticCurveTo(headX + headHalfLength * 0.4, headHalfWidth, headX - headHalfLength, headHalfWidth);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ellipse(ctx, headX + headHalfLength + shape.snout * L * 0.85, 0, 0.03 * L, 0.03 * L);
  } else {
    ellipse(ctx, headX, 0, headHalfLength, headHalfWidth);
  }
  if (look.shape === 'boar') {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.03 * L;
    ctx.beginPath();
    ctx.moveTo(headX + headHalfLength * 0.9, -headHalfWidth * 0.5);
    ctx.lineTo(headX + headHalfLength * 1.5, -headHalfWidth * 0.9);
    ctx.moveTo(headX + headHalfLength * 0.9, headHalfWidth * 0.5);
    ctx.lineTo(headX + headHalfLength * 1.5, headHalfWidth * 0.9);
    ctx.stroke();
  }
  if (look.shape === 'deer' && look.male && !look.juvenile) {
    // Gạc hươu đực.
    ctx.strokeStyle = '#e8dcc0';
    ctx.lineWidth = 0.035 * L;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const side of [-1, 1]) {
      const baseY = side * headHalfWidth * 0.6;
      ctx.moveTo(headX - headHalfLength * 0.3, baseY);
      ctx.lineTo(headX - headHalfLength * 0.9, side * 0.2 * L);
      ctx.lineTo(headX - headHalfLength * 0.2, side * 0.3 * L);
      ctx.moveTo(headX - headHalfLength * 0.9, side * 0.2 * L);
      ctx.lineTo(headX - headHalfLength * 1.6, side * 0.26 * L);
    }
    ctx.stroke();
  }
  // Mắt: gen tầm nhìn làm mắt to hơn.
  eyes(
    ctx,
    headX + headHalfLength * 0.2,
    headHalfWidth * 0.62,
    0.028 * L * (0.5 + 0.9 * (look.vision - 0.4)),
  );
}

function drawBird(ctx: Ctx, look: CreatureLook): void {
  const L = look.length;
  const vulture = look.shape === 'vulture';
  const body = coatColor(look.hue, look.saturation, look.lightness);
  const dark = coatColor(look.hue, look.saturation, look.lightness, -0.12);
  const light = coatColor(look.hue, look.saturation * 0.5, look.lightness, 0.3);
  const perched = look.state === State.REST || look.state === State.HIBERNATE;
  // Gen sải cánh (0–1 sau chuẩn hoá) quyết định độ dài cánh.
  const span = (vulture ? 1.35 : 1.2) * L * (0.72 + 0.56 * look.special);
  const tailSpread = 0.22 * L;

  // Đuôi xoè.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(-0.35 * L, 0);
  ctx.lineTo(-0.82 * L, -tailSpread);
  ctx.lineTo(-0.9 * L, 0);
  ctx.lineTo(-0.82 * L, tailSpread);
  ctx.fill();

  if (perched) {
    // Cánh khép dọc thân.
    ctx.fillStyle = dark;
    ellipse(ctx, -0.1 * L, -0.2 * L, 0.42 * L, 0.11 * L, 0.12);
    ellipse(ctx, -0.1 * L, 0.2 * L, 0.42 * L, 0.11 * L, -0.12);
  } else {
    // Cánh dang: vỗ làm cánh ngắn lại khi nhìn từ trên xuống.
    const flap = 0.78 + 0.22 * Math.cos(look.phase);
    const reach = span * flap;
    ctx.fillStyle = body;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0.22 * L, side * 0.1 * L);
      ctx.quadraticCurveTo(0.34 * L, side * reach * 0.6, 0.05 * L, side * reach);
      ctx.lineTo(-0.16 * L, side * reach * 0.97);
      ctx.quadraticCurveTo(-0.22 * L, side * reach * 0.45, -0.28 * L, side * 0.1 * L);
      ctx.fill();
    }
    // Lông cánh sơ cấp sẫm màu ở đầu cánh.
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.05 * L;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const side of [-1, 1]) {
      for (let k = 0; k < (vulture ? 5 : 3); k++) {
        const x = (0.02 - 0.05 * k) * L;
        ctx.moveTo(x, side * reach * 0.8);
        ctx.lineTo(x - 0.03 * L, side * (reach + 0.07 * L));
      }
    }
    ctx.stroke();
  }

  // Thân; lông dày thêm viền sáng.
  if (look.cold > 0.45) {
    ctx.fillStyle = light;
    ellipse(ctx, 0, 0, 0.45 * L, (0.17 + 0.05 * look.cold) * L);
  }
  ctx.fillStyle = body;
  ellipse(ctx, 0, 0, 0.42 * L, 0.16 * L * (1 + 0.2 * look.cold));
  // Đầu: đại bàng đầu sáng, kền kền đầu trọc đỏ hồng.
  ctx.fillStyle = vulture ? '#c8695a' : light;
  ellipse(ctx, 0.44 * L, 0, 0.13 * L, 0.11 * L);
  ctx.fillStyle = vulture ? '#3a3a3a' : '#f2b01e';
  ctx.beginPath();
  ctx.moveTo(0.54 * L, -0.045 * L);
  ctx.lineTo(0.7 * L, 0);
  ctx.lineTo(0.54 * L, 0.045 * L);
  ctx.fill();
  eyes(ctx, 0.48 * L, 0.07 * L, 0.022 * L * (0.5 + 0.9 * (look.vision - 0.4)));
}

function drawFish(ctx: Ctx, look: CreatureLook): void {
  const L = look.length;
  const body = coatColor(look.hue, look.saturation, look.lightness);
  const dark = coatColor(look.hue, look.saturation, look.lightness, -0.18);
  const wiggle = Math.sin(look.phase) * (0.1 + 0.25 * Math.min(1, look.motion));
  // Vây đuôi: cá bơi nhanh (gen tốc độ) có đuôi lớn hơn.
  const tail = 0.26 * L * (0.6 + 0.7 * (look.speed - 0.6));
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(-0.42 * L, 0);
  ctx.lineTo(-0.42 * L - tail, -tail * 0.8 + wiggle * L);
  ctx.lineTo(-0.42 * L - tail * 0.6, wiggle * L * 0.6);
  ctx.lineTo(-0.42 * L - tail, tail * 0.8 + wiggle * L);
  ctx.fill();
  // Vây ngực.
  ctx.beginPath();
  ctx.moveTo(0.1 * L, -0.13 * L);
  ctx.lineTo(-0.08 * L, -0.3 * L);
  ctx.lineTo(-0.06 * L, -0.12 * L);
  ctx.moveTo(0.1 * L, 0.13 * L);
  ctx.lineTo(-0.08 * L, 0.3 * L);
  ctx.lineTo(-0.06 * L, 0.12 * L);
  ctx.fill();
  // Thân hình thoi.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0.5 * L, 0);
  ctx.quadraticCurveTo(0.2 * L, -0.26 * L, -0.45 * L, wiggle * 0.3 * L);
  ctx.quadraticCurveTo(0.2 * L, 0.26 * L, 0.5 * L, 0);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.04 * L;
  ctx.beginPath();
  ctx.moveTo(0.25 * L, 0);
  ctx.lineTo(-0.3 * L, wiggle * 0.2 * L);
  ctx.stroke();
  eyes(ctx, 0.32 * L, 0.09 * L, 0.03 * L * (0.5 + 0.9 * (look.vision - 0.4)));
}

function drawFrog(ctx: Ctx, look: CreatureLook): void {
  const L = look.length;
  const body = coatColor(look.hue, look.saturation, look.lightness);
  const dark = coatColor(look.hue, look.saturation, look.lightness, -0.16);
  if (look.juvenile && look.length < 6 && look.state !== State.HIBERNATE) {
    // Nòng nọc / ếch con: thân bầu dục và cái đuôi ngoe nguẩy.
    const wiggle = Math.sin(look.phase * 1.5) * 0.25 * L;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.14 * L;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.2 * L, 0);
    ctx.quadraticCurveTo(-0.6 * L, wiggle, -0.9 * L, -wiggle);
    ctx.stroke();
    ctx.fillStyle = dark;
    ellipse(ctx, 0.1 * L, 0, 0.36 * L, 0.26 * L);
    return;
  }
  // Chân sau gập hình chữ Z; lúc nhảy thì duỗi thẳng. Gen tốc độ làm chân dài hơn.
  const stretch = Math.max(0, Math.sin(look.phase)) * Math.min(1, look.motion);
  const leg = 0.42 * L * (0.6 + 0.7 * (look.speed - 0.6));
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.12 * L;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(-0.25 * L, side * 0.22 * L);
    ctx.lineTo(-0.25 * L - leg * (0.2 + 0.8 * stretch), side * (0.3 * L + leg * (1 - stretch) * 0.9));
    ctx.lineTo(-0.25 * L - leg * (0.9 + 0.6 * stretch), side * (0.26 * L + leg * (1 - stretch) * 0.3));
    ctx.moveTo(0.22 * L, side * 0.2 * L);
    ctx.lineTo(0.36 * L, side * 0.42 * L);
  }
  ctx.stroke();
  ctx.fillStyle = body;
  ellipse(ctx, 0, 0, 0.46 * L, 0.34 * L * (1 + 0.15 * look.cold) * (look.pregnant ? 1.12 : 1));
  // Mắt lồi trên đỉnh đầu.
  const eye = 0.09 * L * (0.6 + 0.6 * (look.vision - 0.4));
  ctx.fillStyle = coatColor(look.hue, look.saturation, look.lightness, 0.12);
  ellipse(ctx, 0.3 * L, -0.17 * L, eye, eye);
  ellipse(ctx, 0.3 * L, 0.17 * L, eye, eye);
  eyes(ctx, 0.32 * L, 0.17 * L, eye * 0.5);
}

/** Vẽ đầy đủ chi tiết một sinh vật tại gốc toạ độ, đầu hướng +x. */
export function drawCreature(ctx: Ctx, look: CreatureLook): void {
  const quadruped = QUADRUPEDS[look.shape];
  if (quadruped) drawQuadruped(ctx, look, quadruped);
  else if (look.shape === 'eagle' || look.shape === 'vulture') drawBird(ctx, look);
  else if (look.shape === 'fish') drawFish(ctx, look);
  else drawFrog(ctx, look);

  if (look.sick) {
    // Dấu hiệu bệnh: các chấm xanh lục.
    ctx.fillStyle = 'rgba(120, 220, 60, 0.9)';
    ctx.beginPath();
    ctx.arc(0.1 * look.length, -0.08 * look.length, 0.06 * look.length, 0, TAU);
    ctx.arc(-0.15 * look.length, 0.1 * look.length, 0.05 * look.length, 0, TAU);
    ctx.fill();
  }
}

/** Mức chi tiết trung bình: thân bầu dục + đầu tròn theo màu gen. */
export function drawSimple(ctx: Ctx, look: CreatureLook): void {
  const L = look.length;
  ctx.fillStyle = coatColor(look.hue, look.saturation, look.lightness);
  const bird = look.shape === 'eagle' || look.shape === 'vulture';
  if (bird && look.state !== State.REST) {
    // Chim đang bay: thêm vạch cánh.
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.18 * L, 1.1 * L * (0.72 + 0.56 * look.special), 0, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    0.5 * L,
    (look.shape === 'bear' ? 0.3 : look.shape === 'rabbit' ? 0.28 : 0.2) * L,
    0,
    0,
    TAU,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.5 * L, 0, 0.15 * L, 0, TAU);
  ctx.fill();
}
