import type { LineageNode } from '../../sim/speciation';
import type { App, Panel } from '../app';
import { prepareCanvas } from '../charts';
import { formatDate, formatYears, h, setChildren } from '../dom';

/** Cây phát sinh chủng loại: trục ngang là thời gian, mỗi dòng (loài hoặc phân loài) là một đường. */
export class PhylogenyPanel implements Panel {
  readonly id = 'phylogeny';
  readonly title = 'Phân loài';
  readonly element: HTMLElement;
  private readonly canvas = h('canvas', { class: 'chart' });
  private readonly list = h('div');

  constructor(private readonly app: App) {
    this.element = h(
      'div',
      {},
      h('h3', {}, 'Cây phát sinh chủng loại'),
      this.canvas,
      h(
        'p',
        { class: 'note' },
        'Một quần thể con tách thành phân loài khi (1) không trao đổi gen với phần còn lại của loài trong 6.000 tick và (2) khoảng cách gen vượt 1,2 độ lệch chuẩn. ',
        'Sau khi tách, hai phân loài không giao phối được với nhau. † = đã tuyệt chủng.',
      ),
      h('h3', {}, 'Các sự kiện phân loài'),
      this.list,
    );
  }

  update(): void {
    const { history, meta } = this.app;
    if (!history || !meta) return;
    const now = history.latest?.tick ?? 0;
    const nodes = history.lineages;
    // Thứ tự hàng: duyệt cây theo chiều sâu để nhánh con nằm ngay dưới dòng mẹ.
    const children = new Map<number, LineageNode[]>();
    for (const node of nodes) {
      if (node.parent < 0) continue;
      const list = children.get(node.parent) ?? [];
      list.push(node);
      children.set(node.parent, list);
    }
    const rows: { node: LineageNode; depth: number }[] = [];
    const visit = (node: LineageNode, depth: number): void => {
      rows.push({ node, depth });
      for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
    };
    for (const node of nodes) {
      if (node.parent < 0 && (node.population > 0 || node.extinctTick >= 0 || children.has(node.id)))
        visit(node, 0);
    }
    const rowHeight = 17;
    this.canvas.style.height = `${Math.max(120, rows.length * rowHeight + 34)}px`;
    const { ctx, width, height } = prepareCanvas(this.canvas);
    const pad = { left: 8, right: 104, top: 8, bottom: 20 };
    const plotW = width - pad.left - pad.right;
    const span = Math.max(now, 600);
    const toX = (tick: number): number => pad.left + (tick / span) * plotW;
    const rowOf = new Map(rows.map((row, index) => [row.node.id, index]));
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    rows.forEach((row, index) => {
      const node = row.node;
      const y = pad.top + index * rowHeight + rowHeight / 2;
      const color = this.app.speciesColor(node.species);
      const end = node.extinctTick >= 0 ? node.extinctTick : now;
      ctx.strokeStyle = color;
      ctx.lineWidth = node.parent < 0 ? 2.4 : 1.8;
      ctx.globalAlpha = node.extinctTick >= 0 ? 0.45 : 1;
      ctx.beginPath();
      ctx.moveTo(toX(node.bornTick), y);
      ctx.lineTo(toX(end), y);
      ctx.stroke();
      if (node.parent >= 0 && rowOf.has(node.parent)) {
        // Nối dọc từ dòng mẹ tại thời điểm tách.
        const parentY = pad.top + rowOf.get(node.parent)! * rowHeight + rowHeight / 2;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(toX(node.bornTick), parentY);
        ctx.lineTo(toX(node.bornTick), y);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(toX(node.bornTick), parentY, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = node.extinctTick >= 0 ? 'rgba(255,255,255,0.45)' : '#e6edf3';
      ctx.textAlign = 'left';
      ctx.fillText(`${node.name}${node.extinctTick >= 0 ? ' †' : ` · ${node.population}`}`, toX(end) + 6, y);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(formatYears(0), pad.left, height - pad.bottom + 5);
    ctx.textAlign = 'right';
    ctx.fillText(formatYears(now), pad.left + plotW, height - pad.bottom + 5);

    const branches = nodes.filter((node) => node.parent >= 0);
    if (branches.length === 0) {
      setChildren(
        this.list,
        h(
          'p',
          { class: 'note' },
          'Chưa có phân loài nào. Ứng viên sớm nhất thường là các quần thể nhỏ bị cô lập: cá và ếch trong ao hồ riêng, thỏ ở hai bờ sông.',
        ),
      );
      return;
    }
    setChildren(
      this.list,
      h(
        'table',
        { class: 'data' },
        h(
          'tr',
          {},
          h('th', {}, 'Phân loài'),
          h('th', {}, 'Tách từ'),
          h('th', {}, 'Lúc'),
          h('th', { class: 'num' }, 'Sáng lập'),
          h('th', { class: 'num' }, 'K/c gen'),
          h('th', { class: 'num' }, 'Hiện có'),
        ),
        ...branches.map((node) =>
          h(
            'tr',
            {},
            h(
              'td',
              {},
              h('i', {
                style: {
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  marginRight: '5px',
                  background: this.app.speciesColor(node.species),
                },
              }),
              node.name,
            ),
            h('td', {}, nodes[node.parent]?.name ?? '?'),
            h('td', {}, formatDate(node.bornTick)),
            h('td', { class: 'num' }, node.founders),
            h('td', { class: 'num' }, `${node.distance.toFixed(2)}σ`),
            h('td', { class: 'num' }, node.extinctTick >= 0 ? '†' : node.population),
          ),
        ),
      ),
    );
  }
}
