/**
 * Tham số chỉnh được khi mô phỏng đang chạy (thanh trượt trên giao diện) và các công tắc kịch bản.
 * Đây là một phần của "đầu vào": cùng seed + cùng tham số ⇒ cùng kết quả.
 */
export interface SimParams {
  /** Hệ số nhân tốc độ quang hợp của mọi thực vật. */
  sunlight: number;
  /** Hệ số nhân xác suất mưa. */
  rainfall: number;
  /** Độ lệch nhiệt độ toàn cục (°C). */
  temperatureOffset: number;
  /** Hệ số nhân chi phí chuyển hoá của động vật. */
  metabolism: number;
  /** Xác suất đột biến của mỗi alen khi sinh sản. */
  mutationRate: number;
  /** Độ lệch chuẩn của đột biến, theo tỉ lệ biên độ gen. */
  mutationScale: number;
  /** Công tắc kịch bản (chế độ thí nghiệm tắt bớt). */
  seasons: boolean;
  dayNight: boolean;
  weather: boolean;
  thirst: boolean;
  /** Tắt thì quần thể khởi tạo đồng nhất về gen (vẫn cần mutationRate = 0 để giữ nguyên). */
  geneticVariation: boolean;
  speciation: boolean;
}

export const DEFAULT_PARAMS: SimParams = {
  sunlight: 1,
  rainfall: 1,
  temperatureOffset: 0,
  metabolism: 1,
  mutationRate: 0.1,
  mutationScale: 0.04,
  seasons: true,
  dayNight: true,
  weather: true,
  thirst: true,
  geneticVariation: true,
  speciation: true,
};

/** Biên của các tham số số học mà giao diện cho chỉnh. */
export const PARAM_RANGES: Record<
  'sunlight' | 'rainfall' | 'temperatureOffset' | 'metabolism' | 'mutationRate' | 'mutationScale',
  { min: number; max: number; step: number; label: string }
> = {
  sunlight: { min: 0.3, max: 2, step: 0.05, label: 'Ánh sáng (quang hợp)' },
  rainfall: { min: 0, max: 3, step: 0.05, label: 'Lượng mưa' },
  temperatureOffset: { min: -10, max: 10, step: 0.5, label: 'Nhiệt độ (± °C)' },
  metabolism: { min: 0.5, max: 2, step: 0.05, label: 'Chuyển hoá động vật' },
  mutationRate: { min: 0, max: 0.5, step: 0.01, label: 'Tỉ lệ đột biến' },
  mutationScale: { min: 0, max: 0.2, step: 0.005, label: 'Biên độ đột biến' },
};
