/**
 * Spatial hash dạng lưới đều, dựng lại bằng counting sort trong O(n).
 *
 * Dùng để tìm hàng xóm trong bán kính r mà không cần duyệt mọi cặp (tránh O(n²)).
 * Thứ tự phần tử trong mỗi ô là thứ tự chỉ số tăng dần → kết quả truy vấn tất định.
 */
export class SpatialHash {
  readonly cellSize: number;
  readonly side: number;
  private readonly cellStart: Int32Array;
  private readonly cellFill: Int32Array;
  private items: Int32Array;

  constructor(worldSize: number, cellSize: number) {
    this.cellSize = cellSize;
    this.side = Math.ceil(worldSize / cellSize);
    this.cellStart = new Int32Array(this.side * this.side + 1);
    this.cellFill = new Int32Array(this.side * this.side);
    this.items = new Int32Array(1024);
  }

  private bucket(x: number, y: number): number {
    let bx = (x / this.cellSize) | 0;
    let by = (y / this.cellSize) | 0;
    if (bx < 0) bx = 0;
    else if (bx >= this.side) bx = this.side - 1;
    if (by < 0) by = 0;
    else if (by >= this.side) by = this.side - 1;
    return by * this.side + bx;
  }

  /**
   * Dựng lại chỉ mục cho các phần tử 0..count−1 còn sống.
   * @param alive khác 0 nghĩa là phần tử tồn tại
   */
  build(count: number, alive: Uint8Array, x: Float32Array, y: Float32Array): void {
    const start = this.cellStart;
    start.fill(0);
    let living = 0;
    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) continue;
      start[this.bucket(x[i], y[i]) + 1]++;
      living++;
    }
    for (let c = 0; c < start.length - 1; c++) start[c + 1] += start[c];
    if (this.items.length < living) this.items = new Int32Array(Math.max(living, this.items.length * 2));
    const fill = this.cellFill;
    fill.fill(0);
    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) continue;
      const b = this.bucket(x[i], y[i]);
      this.items[start[b] + fill[b]++] = i;
    }
  }

  /**
   * Ghi vào `out` chỉ số mọi phần tử nằm trong các ô chạm hình vuông bao quanh đường tròn (x, y, radius).
   * Người gọi tự kiểm tra khoảng cách chính xác. Trả về số phần tử đã ghi (bị cắt ở out.length).
   */
  query(x: number, y: number, radius: number, out: Int32Array): number {
    const side = this.side;
    const size = this.cellSize;
    let bx0 = ((x - radius) / size) | 0;
    let bx1 = ((x + radius) / size) | 0;
    let by0 = ((y - radius) / size) | 0;
    let by1 = ((y + radius) / size) | 0;
    if (bx0 < 0) bx0 = 0;
    if (by0 < 0) by0 = 0;
    if (bx1 >= side) bx1 = side - 1;
    if (by1 >= side) by1 = side - 1;
    const start = this.cellStart;
    const items = this.items;
    const limit = out.length;
    let n = 0;
    for (let by = by0; by <= by1; by++) {
      const row = by * side;
      const from = start[row + bx0];
      const to = start[row + bx1 + 1];
      for (let k = from; k < to; k++) {
        if (n >= limit) return n;
        out[n++] = items[k];
      }
    }
    return n;
  }
}
