import { hslToRgb } from '../../render/common';
import type { App, Panel } from '../app';
import { drawHeatmap, drawHistogram, drawLineChart } from '../charts';
import { formatYears, h, setChildren } from '../dom';

/** Phân bố gen của một loài: histogram hiện tại, trung bình ± độ lệch chuẩn theo thời gian, và bản đồ nhiệt. */
export class GenesPanel implements Panel {
  readonly id = 'genes';
  readonly title = 'Gen';
  readonly element: HTMLElement;
  private species = 0;
  private gene = 0;
  private readonly speciesSelect = h('select', { onchange: () => this.pick() });
  private readonly geneSelect = h('select', { onchange: () => this.pick() });
  private readonly histogram = h('canvas', { class: 'chart short' });
  private readonly trend = h('canvas', { class: 'chart short' });
  private readonly heatmap = h('canvas', { class: 'chart short' });
  private readonly table = h('div');

  constructor(private readonly app: App) {
    this.element = h(
      'div',
      {},
      h('h3', {}, 'Phân bố gen'),
      h('div', { class: 'row' }, this.speciesSelect, this.geneSelect),
      h('p', { class: 'note' }, 'Phân bố kiểu hình hiện tại trong quần thể (vạch đứt: trung bình).'),
      this.histogram,
      h('h3', {}, 'Trung bình ± độ lệch chuẩn theo thời gian'),
      this.trend,
      h('h3', {}, 'Phân bố theo thời gian'),
      this.heatmap,
      h(
        'p',
        { class: 'note' },
        'Mỗi cột là một thời điểm; càng đậm càng nhiều cá thể mang giá trị gen đó. Dải màu trôi lên/xuống là chọn lọc có hướng; tách làm hai là dấu hiệu phân hoá.',
      ),
      h('h3', {}, 'Mọi gen của loài: lúc đầu → hiện tại'),
      this.table,
    );
  }

  reset(): void {
    this.species = 0;
    this.gene = 0;
    this.speciesSelect.textContent = '';
  }

  private pick(): void {
    const species = Number(this.speciesSelect.value);
    if (species !== this.species) {
      this.species = species;
      this.gene = 0;
      this.geneSelect.textContent = '';
    } else {
      this.gene = Number(this.geneSelect.value);
    }
    this.update();
  }

  update(): void {
    const { history, meta } = this.app;
    if (!history || !meta) return;
    if (this.speciesSelect.options.length === 0) {
      const present = meta.animals.filter((species) =>
        history.populations[species.index].some((count) => count > 0),
      );
      if (present.length === 0) return;
      this.species = present[0].index;
      setChildren(
        this.speciesSelect,
        ...present.map((species) => h('option', { value: String(species.index) }, species.name)),
      );
    }
    const species = meta.animals[this.species];
    if (this.geneSelect.options.length === 0) {
      setChildren(
        this.geneSelect,
        ...species.genes.map((gene, index) => h('option', { value: String(index) }, gene.label)),
      );
      this.geneSelect.value = String(this.gene);
    }
    const spec = species.genes[this.gene];
    const color = this.app.speciesColor(this.species);
    const latest = history.histograms[history.histograms.length - 1];
    const means = history.geneMean[this.species][this.gene];
    const sds = history.geneSd[this.species][this.gene];
    if (latest)
      drawHistogram(
        this.histogram,
        latest.bins[this.species][this.gene],
        spec.min,
        spec.max,
        color,
        means[means.length - 1],
      );

    const upper = means.map((mean, k) => mean + sds[k]);
    const lower = means.map((mean, k) => mean - sds[k]);
    const low = Math.min(...lower.filter((value) => value > 0), spec.max);
    drawLineChart(this.trend, {
      x: history.ticks,
      series: [
        { label: '+1σ', color: 'rgba(255,255,255,0.35)', values: upper, width: 1 },
        { label: '−1σ', color: 'rgba(255,255,255,0.35)', values: lower, width: 1 },
        { label: 'Trung bình', color, values: means, width: 2 },
      ],
      formatX: formatYears,
      minY: Math.max(spec.min, low - (spec.max - spec.min) * 0.05),
    });

    const [r, g, b] = hslToRgb(0.4, 0.6, 0.6);
    drawHeatmap(
      this.heatmap,
      history.histograms.map((sample) => ({ tick: sample.tick, bins: sample.bins[this.species][this.gene] })),
      [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)],
      formatYears,
    );

    setChildren(
      this.table,
      h(
        'table',
        { class: 'data' },
        h(
          'tr',
          {},
          h('th', {}, 'Gen'),
          h('th', { class: 'num' }, 'Lúc đầu'),
          h('th', { class: 'num' }, 'Hiện tại'),
          h('th', { class: 'num' }, 'Thay đổi'),
        ),
        ...species.genes.map((gene, index) => {
          const series = history.geneMean[this.species][index];
          const first = series.find((value) => value !== 0) ?? 0;
          const last = series[series.length - 1] ?? 0;
          const change = ((last - first) / (gene.max - gene.min)) * 100;
          return h(
            'tr',
            {},
            h('td', {}, gene.label),
            h('td', { class: 'num' }, first.toFixed(3)),
            h('td', { class: 'num' }, last.toFixed(3)),
            h(
              'td',
              {
                class: 'num',
                style: { color: Math.abs(change) < 1 ? '' : change > 0 ? '#6fcf97' : '#f2994a' },
              },
              `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
            ),
          );
        }),
      ),
      h(
        'p',
        { class: 'note' },
        '"Thay đổi" tính theo % biên độ cho phép của gen. Không có hướng nào được cài sẵn: mọi xu hướng là do chọn lọc và trôi dạt.',
      ),
    );
  }
}
