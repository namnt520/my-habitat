import { SPECIES_COLORS } from '../../render/common';
import type { App, Panel } from '../app';
import { type Series, drawLineChart } from '../charts';
import { formatDate, formatYears, h, setChildren } from '../dom';

const FIELD_LABELS: Record<string, string> = {
  grass: 'Cỏ',
  shrub: 'Cây bụi',
  fruit: 'Quả',
  algae: 'Tảo',
  insects: 'Côn trùng',
  fungi: 'Nấm',
  detritus: 'Mùn bã',
  corpses: 'Xác',
};

/** Biểu đồ quần thể theo thời gian của từng loài và từng phân loài, cộng sinh khối của các trường. */
export class PopulationPanel implements Panel {
  readonly id = 'population';
  readonly title = 'Quần thể';
  readonly element: HTMLElement;
  private readonly chart = h('canvas', { class: 'chart' });
  private readonly fieldChart = h('canvas', { class: 'chart short' });
  private readonly chips = h('div', { class: 'chips' });
  private readonly readout = h('div', { class: 'readout' });
  private hidden = new Set<number>();
  private logScale = true;
  private showLineages = true;
  private hoverX: number | null = null;

  constructor(private readonly app: App) {
    const track = (canvas: HTMLCanvasElement): void => {
      canvas.addEventListener('mousemove', (event) => {
        this.hoverX = event.offsetX;
        this.update();
      });
      canvas.addEventListener('mouseleave', () => {
        this.hoverX = null;
        this.update();
      });
    };
    track(this.chart);
    this.element = h(
      'div',
      {},
      h('h3', {}, 'Số cá thể theo thời gian'),
      h(
        'div',
        { class: 'row' },
        h(
          'label',
          { class: 'inline' },
          h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => this.toggle('log', e) }),
          'Thang log',
        ),
        h(
          'label',
          { class: 'inline' },
          h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => this.toggle('lineage', e) }),
          'Tách theo phân loài',
        ),
      ),
      this.chart,
      this.chips,
      this.readout,
      h('h3', {}, 'Sinh khối các trường (E, thang log)'),
      this.fieldChart,
      h(
        'p',
        { class: 'note' },
        'Cỏ, cây bụi, tảo, côn trùng và nấm được mô phỏng theo mật độ trên lưới 200×200 ô chứ không theo từng cá thể.',
      ),
    );
  }

  private toggle(which: 'log' | 'lineage', event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (which === 'log') this.logScale = checked;
    else this.showLineages = checked;
    this.update();
  }

  reset(): void {
    this.hidden.clear();
  }

  update(): void {
    const { history, meta } = this.app;
    if (!history || !meta) return;
    const present = meta.animals.filter((species) =>
      history.populations[species.index].some((count) => count > 0),
    );
    const series: Series[] = [];
    for (const species of present) {
      if (this.hidden.has(species.index)) continue;
      const color = this.app.speciesColor(species.index);
      const branches = history.lineages.filter((node) => node.species === species.index && node.parent >= 0);
      if (this.showLineages && branches.length > 0) {
        // Loài đã phân nhánh: vẽ dòng gốc nét liền, các phân loài nét đứt.
        const root = history.lineageSeries.get(species.index);
        if (root) series.push({ label: `${species.name} (gốc)`, color, values: root });
        for (const branch of branches) {
          const values = history.lineageSeries.get(branch.id);
          if (values) series.push({ label: branch.name, color, values, dashed: true, width: 1.2 });
        }
      } else {
        series.push({ label: species.name, color, values: history.populations[species.index] });
      }
    }
    const hover = drawLineChart(this.chart, {
      x: history.ticks,
      series,
      logScale: this.logScale,
      formatX: formatYears,
      hoverX: this.hoverX,
    });

    const latest = history.latest;
    setChildren(
      this.chips,
      ...present.map((species) =>
        h(
          'span',
          {
            class: `chip ${this.hidden.has(species.index) ? 'off' : ''}`,
            title: `${species.role} — ${species.mechanism}`,
            onclick: () => {
              if (this.hidden.has(species.index)) this.hidden.delete(species.index);
              else this.hidden.add(species.index);
              this.update();
            },
          },
          h('i', { style: { background: this.app.speciesColor(species.index) } }),
          `${species.name} ${latest ? latest.populations[species.index] : ''}`,
        ),
      ),
    );
    if (hover) {
      setChildren(
        this.readout,
        h('b', {}, formatDate(hover.x)),
        ': ',
        series
          .map((s) => `${s.label} ${Number.isNaN(s.values[hover.index]) ? '–' : s.values[hover.index]}`)
          .join(' · '),
      );
    } else {
      this.readout.textContent = 'Rê chuột lên biểu đồ để đọc số liệu; bấm vào tên loài để ẩn/hiện.';
    }

    const fieldSeries: Series[] = Object.keys(FIELD_LABELS).map((key) => ({
      label: FIELD_LABELS[key],
      color: SPECIES_COLORS[key === 'fruit' ? 'corpse' : key === 'corpses' ? 'vulture' : key] ?? '#aaa',
      values: history.fields[key],
      dashed: key === 'fruit' || key === 'corpses',
    }));
    drawLineChart(this.fieldChart, {
      x: history.ticks,
      series: fieldSeries,
      logScale: true,
      formatX: formatYears,
    });
  }
}
