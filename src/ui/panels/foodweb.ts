import { POOL_CORPSE, POOL_DETRITUS, POOL_HEAT, POOL_SUN } from '../../sim/ledger';
import { SPECIES_COLORS } from '../../render/common';
import type { App, Panel } from '../app';
import { prepareCanvas } from '../charts';
import { h, setChildren } from '../dom';

interface WebNode {
  pool: number;
  label: string;
  color: string;
  /** Vị trí chuẩn hoá trong [0, 1]. */
  x: number;
  y: number;
}

interface WebEdge {
  from: number;
  to: number;
  rate: number;
}

/** Vị trí các nút: trục dọc là bậc dinh dưỡng (dưới: sản xuất; trên: ăn thịt), cột phải là vòng phân huỷ. */
const LAYOUT: Record<string, [number, number]> = {
  sun: [0.06, 0.93],
  grass: [0.22, 0.86],
  shrub: [0.42, 0.86],
  algae: [0.62, 0.86],
  insects: [0.12, 0.62],
  rabbit: [0.3, 0.6],
  deer: [0.47, 0.62],
  fish: [0.64, 0.6],
  boar: [0.38, 0.47],
  frog: [0.14, 0.4],
  bear: [0.58, 0.38],
  fox: [0.26, 0.2],
  wolf: [0.44, 0.14],
  eagle: [0.62, 0.16],
  corpse: [0.86, 0.34],
  vulture: [0.86, 0.12],
  detritus: [0.88, 0.62],
  fungi: [0.88, 0.86],
};
const LABELS: Record<string, string> = { sun: 'Mặt trời', corpse: 'Xác', detritus: 'Mùn bã' };

/**
 * Sơ đồ lưới thức ăn trực tiếp. Độ dày mũi tên tỉ lệ (theo log) với dòng năng lượng đo được trong sổ cái
 * ở vài trăm tick gần nhất; các vạch đứt chạy theo chiều dòng chảy.
 */
export class FoodWebPanel implements Panel {
  readonly id = 'foodweb';
  readonly title = 'Lưới thức ăn';
  readonly element: HTMLElement;
  private readonly canvas = h('canvas', { class: 'chart tall' });
  private readonly detail = h('div', { class: 'readout' });
  private hover = -1;
  private nodes: WebNode[] = [];

  constructor(private readonly app: App) {
    this.canvas.addEventListener('mousemove', (event) => {
      const width = this.canvas.clientWidth;
      const height = this.canvas.clientHeight;
      let best = -1;
      let bestDistance = 22 * 22;
      this.nodes.forEach((node, index) => {
        const dx = node.x * width - event.offsetX;
        const dy = node.y * height - event.offsetY;
        if (dx * dx + dy * dy < bestDistance) {
          bestDistance = dx * dx + dy * dy;
          best = index;
        }
      });
      if (best !== this.hover) {
        this.hover = best;
        this.update();
      }
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.hover = -1;
      this.update();
    });
    this.element = h(
      'div',
      {},
      h('h3', {}, 'Dòng sinh khối giữa các loài (E mỗi tick)'),
      this.canvas,
      this.detail,
      h(
        'p',
        { class: 'note' },
        'Mũi tên xanh: ăn thực vật; cam: săn mồi; đỏ: ăn xác; nâu: thành mùn bã và được nấm phân huỷ. Rê chuột lên một nút để xem dòng vào/ra của nó. ',
        'Số liệu lấy trực tiếp từ sổ cái năng lượng của mô phỏng.',
      ),
    );
  }

  reset(): void {
    this.nodes = [];
  }

  private buildNodes(): void {
    const meta = this.app.meta!;
    const add = (key: string, pool: number, label: string): void => {
      const position = LAYOUT[key];
      if (position)
        this.nodes.push({
          pool,
          label,
          color: SPECIES_COLORS[key] ?? '#999',
          x: position[0],
          y: position[1],
        });
    };
    this.nodes = [];
    add('sun', POOL_SUN, LABELS.sun);
    add('corpse', POOL_CORPSE, LABELS.corpse);
    add('detritus', POOL_DETRITUS, LABELS.detritus);
    for (const field of meta.fields)
      add(field.key, field.pool, field.name === 'Cây bụi có quả' ? 'Cây bụi' : field.name);
    for (const species of meta.animals) add(species.key, species.pool, species.name);
  }

  update(): void {
    const { history, meta } = this.app;
    if (!history || !meta) return;
    if (this.nodes.length === 0) this.buildNodes();
    const { ctx, width, height } = prepareCanvas(this.canvas);
    const flow = history.flowRate;
    const intake = history.intakeRate;
    if (!flow || !intake) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px system-ui';
      ctx.fillText('Đang đo dòng năng lượng…', 12, 22);
      return;
    }
    const P = meta.pools.length;
    const nodeOf = new Map(this.nodes.map((node, index) => [node.pool, index]));
    const producers = new Set(
      meta.fields
        .filter((field) => field.key !== 'insects' && field.key !== 'fungi')
        .map((field) => field.pool),
    );
    const edges: (WebEdge & { kind: 'plant' | 'prey' | 'carrion' | 'decay' | 'sun' })[] = [];
    const push = (from: number, to: number, rate: number, kind: (typeof edges)[number]['kind']): void => {
      if (rate > 1e-4 && nodeOf.has(from) && nodeOf.has(to))
        edges.push({ from: nodeOf.get(from)!, to: nodeOf.get(to)!, rate, kind });
    };
    // Quang hợp.
    for (const pool of producers) push(POOL_SUN, pool, flow[POOL_SUN * P + pool], 'sun');
    // Ai ăn ai (ma trận intake: [kẻ ăn][nguồn]).
    for (let consumer = 0; consumer < P; consumer++) {
      for (let source = 0; source < P; source++) {
        const rate = intake[consumer * P + source];
        if (rate <= 0) continue;
        push(
          source,
          consumer,
          rate,
          source === POOL_CORPSE ? 'carrion' : producers.has(source) ? 'plant' : 'prey',
        );
      }
    }
    // Côn trùng ăn cỏ/cây bụi và nấm ăn mùn nằm trong sổ cái chung.
    const insects = meta.fields.find((field) => field.key === 'insects')!.pool;
    const fungi = meta.fields.find((field) => field.key === 'fungi')!.pool;
    for (const pool of producers) push(pool, insects, flow[pool * P + insects], 'plant');
    push(POOL_DETRITUS, fungi, flow[POOL_DETRITUS * P + fungi], 'decay');
    push(POOL_CORPSE, POOL_DETRITUS, flow[POOL_CORPSE * P + POOL_DETRITUS], 'decay');
    // Dòng "chết thành xác" và "thải thành mùn" gộp lại cho đỡ rối: chỉ vẽ các dòng lớn.
    let toDetritus = 0;
    for (let pool = 0; pool < P; pool++)
      if (pool !== POOL_CORPSE) toDetritus += flow[pool * P + POOL_DETRITUS];
    for (const pool of producers) push(pool, POOL_DETRITUS, flow[pool * P + POOL_DETRITUS], 'decay');

    const colors = {
      plant: '#6fcf97',
      prey: '#f2994a',
      carrion: '#eb5757',
      decay: '#a1887f',
      sun: '#ffca28',
    };
    const time = performance.now() / 1000;
    const hovered = this.hover;
    for (const edge of edges) {
      const a = this.nodes[edge.from];
      const b = this.nodes[edge.to];
      const active = hovered < 0 || edge.from === hovered || edge.to === hovered;
      const ax = a.x * width;
      const ay = a.y * height;
      const bx = b.x * width;
      const by = b.y * height;
      // Cong nhẹ để các cạnh chồng nhau vẫn phân biệt được.
      const mx = (ax + bx) / 2 + (by - ay) * 0.12;
      const my = (ay + by) / 2 - (bx - ax) * 0.12;
      ctx.strokeStyle = colors[edge.kind];
      ctx.globalAlpha = active ? 0.85 : 0.12;
      ctx.lineWidth = 0.7 + 1.9 * Math.log10(1 + edge.rate * 4);
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -time * 14;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.nodes.forEach((node, index) => {
      const x = node.x * width;
      const y = node.y * height;
      const dim =
        hovered >= 0 &&
        hovered !== index &&
        !edges.some(
          (edge) =>
            (edge.from === hovered && edge.to === index) || (edge.to === hovered && edge.from === index),
        );
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(x, y, index === hovered ? 12 : 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(node.label, x, y + 20);
    });
    ctx.globalAlpha = 1;

    if (hovered >= 0) {
      const node = this.nodes[hovered];
      const incoming = edges.filter((edge) => edge.to === hovered).sort((p, q) => q.rate - p.rate);
      const outgoing = edges.filter((edge) => edge.from === hovered).sort((p, q) => q.rate - p.rate);
      const heat = node.pool >= POOL_CORPSE ? flow[node.pool * P + POOL_HEAT] : 0;
      setChildren(
        this.detail,
        h('b', {}, node.label),
        incoming.length > 0
          ? ` ← ${incoming.map((edge) => `${this.nodes[edge.from].label} ${edge.rate.toFixed(2)}`).join(', ')}`
          : '',
        outgoing.length > 0
          ? ` → ${outgoing.map((edge) => `${this.nodes[edge.to].label} ${edge.rate.toFixed(2)}`).join(', ')}`
          : '',
        heat > 0 ? ` · hô hấp thành nhiệt ${heat.toFixed(2)}` : '',
      );
    } else {
      let npp = 0;
      for (const pool of producers) npp += flow[POOL_SUN * P + pool];
      this.detail.textContent = `Quang hợp toàn hệ: ${npp.toFixed(0)} E/tick · thành mùn bã: ${toDetritus.toFixed(0)} E/tick · nhiệt thải: ${sumColumn(flow, P, POOL_HEAT).toFixed(0)} E/tick`;
    }
  }
}

function sumColumn(matrix: Float64Array, size: number, column: number): number {
  let total = 0;
  for (let row = 0; row < size; row++) total += matrix[row * size + column];
  return total;
}
