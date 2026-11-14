/**
 * Mọi hằng số của mô phỏng nằm ở đây, kèm ý nghĩa và đơn vị.
 *
 * Đơn vị dùng chung:
 *  - chiều dài: "đơn vị bản đồ" (u); bản đồ 2000×2000 u
 *  - thời gian: tick (bước cố định của mô phỏng)
 *  - năng lượng: E (đơn vị trừu tượng; 1 con thỏ trưởng thành ≈ 20 E cấu trúc cơ thể)
 *  - dinh dưỡng: N (đơn vị trừu tượng; mọi chất hữu cơ chứa NUTRIENT_PER_ENERGY N cho mỗi E)
 *  - nhiệt độ: °C
 *
 * Tham số riêng của từng loài KHÔNG nằm ở đây mà ở `src/species/data/*.json`.
 * Tham số người dùng chỉnh được khi đang chạy nằm trong `SimParams` (xem `params.ts`).
 */

// ───────────────────────────── Không gian ─────────────────────────────

/** Cạnh bản đồ (u). */
export const WORLD_SIZE = 2000;
/** Cạnh một ô lưới của các trường (cỏ, đất, nước…) (u). */
export const CELL_SIZE = 10;
/** Số ô lưới mỗi chiều. */
export const GRID = WORLD_SIZE / CELL_SIZE;
/** Tổng số ô lưới. */
export const CELLS = GRID * GRID;
/** Cạnh ô của spatial hash cho động vật (u). Gần bằng tầm nhìn của loài đông nhất (cá, ếch) để truy vấn ít quét thừa. */
export const HASH_CELL = 25;

// ───────────────────────────── Thời gian ─────────────────────────────

/** Số tick trong một chu kỳ ngày/đêm. */
export const TICKS_PER_DAY = 120;
/** Số tick mỗi mùa (5 ngày). */
export const TICKS_PER_SEASON = 600;
/** Số tick mỗi năm (4 mùa). Tick 0 là đầu xuân. */
export const TICKS_PER_YEAR = 4 * TICKS_PER_SEASON;
/** Động vật "suy nghĩ" (cảm nhận + quyết định + trao đổi chất) mỗi N tick, lệch pha theo số khe. */
export const THINK_INTERVAL = 6;
/** Mỗi tick chỉ cập nhật 1/N số hàng của lưới trường; mỗi ô được cập nhật mỗi N tick với dt = N. */
export const FIELD_STRIPES = 12;
/** Chu kỳ cập nhật thời tiết (tick). */
export const WEATHER_INTERVAL = 40;
/** Chu kỳ tính lại trường khoảng cách tới nước (tick). */
export const WATER_FIELD_INTERVAL = 120;
/** Chu kỳ cập nhật bầy/đàn có tổ chức (tick). */
export const GROUP_INTERVAL = 30;
/** Chu kỳ lấy mẫu thống kê (tick). */
export const STATS_INTERVAL = 60;

// ───────────────────────────── Địa hình ─────────────────────────────
// Độ cao được chuẩn hoá theo hạng nên phân bố đều trong [0, 1]: "mực nước 0,07" nghĩa là 7% diện tích
// thấp nhất là hồ, với mọi seed.

/** Mực nước nền (đơn vị độ cao chuẩn hoá). */
export const WATER_LEVEL_BASE = 0.07;
/** Mực nước thấp nhất/cao nhất mà thời tiết và thảm hoạ có thể đẩy tới. */
export const WATER_LEVEL_MIN = 0.03;
export const WATER_LEVEL_MAX = 0.11;
/** Nước sâu hơn mức này thì động vật trên cạn không biết bơi không qua được. */
export const WADE_DEPTH = 0.008;
/** Cá cần nước sâu ít nhất mức này. */
export const FISH_MIN_DEPTH = 0.002;
/** Trên độ cao này là núi đá: động vật đi bộ không vượt qua được. */
export const MOUNTAIN_LEVEL = 0.93;
/** Trên độ cao này là đồi: đi chậm hơn, cỏ thưa hơn. */
export const HILL_LEVEL = 0.8;
/** Nửa bề rộng lòng sông (u), dao động theo noise quanh giá trị này. */
export const RIVER_HALF_WIDTH = 30;
/** Độ sâu giữa dòng ở đoạn sông thường, và ở các "chỗ cạn" (chỉ lội qua được khi hạn hán). */
export const RIVER_DEPTH = 0.06;
export const RIVER_FORD_DEPTH = 0.022;
/**
 * Ao nhỏ: được thêm lần lượt vào nơi xa nước nhất cho tới khi không ô đất nào cách nước quá POND_MAX_DISTANCE ô
 * (hoặc đã đủ POND_MAX_COUNT ao). Ao nông nên cạn khi hạn hán.
 */
export const POND_MAX_DISTANCE = 24;
export const POND_MAX_COUNT = 48;
/** Bán kính ao (u): [nhỏ nhất, lớn nhất]; độ sâu giữa ao: [nông nhất, sâu nhất]. */
export const POND_RADIUS = [14, 30] as const;
export const POND_DEPTH = [0.02, 0.045] as const;
/** Tỉ lệ diện tích có tán rừng dày (theo hạng noise). */
export const FOREST_FRACTION = 0.3;

// ───────────────────────────── Khí hậu ─────────────────────────────

/** Nhiệt độ trung bình năm (°C) và biên độ theo mùa, theo ngày/đêm. */
export const TEMP_MEAN = 13;
export const TEMP_SEASON_AMPLITUDE = 10;
export const TEMP_DAY_AMPLITUDE = 3;
/** Dưới nhiệt độ trung bình ngày này thì mặt đất phủ tuyết (ảnh hưởng nguỵ trang và hình ảnh). */
export const SNOW_TEMPERATURE = 4.5;
/**
 * Mùa đông ôn hoà: thực vật vẫn quang hợp chậm thay vì ngừng hẳn.
 * Ánh sáng hữu hiệu = LIGHT_BASE + LIGHT_SEASONAL × (dao động mùa ∈ [−1, 1]) → 0,4 giữa đông … 1,0 giữa hạ.
 * Vì sao: nếu mùa đông năng suất bằng 0, mọi quần thể (vốn lớn lên theo sự dư dả mùa hạ) gặm thức ăn tới sàn
 * rồi chết đói hàng loạt mỗi mùa xuân — hệ dao động rất mạnh và các loài ít cá thể tuyệt chủng.
 */
export const LIGHT_BASE = 0.7;
export const LIGHT_SEASONAL = 0.3;
/** Giảm nhiệt theo độ cao: °C cho mỗi đơn vị độ cao chuẩn hoá phía trên 0,5. */
export const TEMP_LAPSE = 8;
/** Xác suất bắt đầu mưa mỗi chu kỳ thời tiết, theo mùa [xuân, hạ, thu, đông]. */
export const RAIN_START_CHANCE = [0.16, 0.09, 0.14, 0.1] as const;
/** Xác suất tạnh mưa mỗi chu kỳ thời tiết. */
export const RAIN_STOP_CHANCE = 0.3;
/** Xác suất tự phát một đợt hạn mỗi chu kỳ thời tiết mùa hạ (≈ 1 đợt mỗi ~7 năm). */
export const DROUGHT_CHANCE = 0.0015;
/** Độ dài một đợt hạn tự phát (tick): [ngắn nhất, dài nhất]. */
export const DROUGHT_DURATION = [500, 1100] as const;
/** Độ ẩm đất tăng mỗi chu kỳ mưa, và tỉ lệ bốc hơi mỗi chu kỳ ở 20 °C. */
export const SOIL_WETTING = 0.1;
export const SOIL_DRYING = 0.035;
/** Mực nước: tăng mỗi chu kỳ mưa, bốc hơi mỗi chu kỳ ở 20 °C, tốc độ hồi về mực nền. */
export const WATER_RAIN_GAIN = 0.0012;
export const WATER_EVAPORATION = 0.00035;
export const WATER_RELAXATION = 0.012;

// ───────────────────────────── Dinh dưỡng ─────────────────────────────

/** N chứa trong mỗi E chất hữu cơ. Tỉ lệ cố định giúp bảo toàn N suy ra trực tiếp từ sổ năng lượng. */
export const NUTRIENT_PER_ENERGY = 0.01;
/** N khoáng trung bình mỗi ô đất lúc khởi tạo. */
export const SOIL_NUTRIENT_INITIAL = 4.5;
/** Hằng số bán bão hoà của giới hạn dinh dưỡng với thực vật (N/ô). */
export const NUTRIENT_HALF_SATURATION = 1.2;
/** Khuếch tán N giữa hai ô kề nhau mỗi tick: đất–đất, nước–nước, và rửa trôi xuống dốc khi mưa. */
export const NUTRIENT_DIFFUSION_LAND = 0.0006;
export const NUTRIENT_DIFFUSION_WATER = 0.02;
export const NUTRIENT_LEACHING = 0.0012;

// ───────────────────────────── Động vật: trao đổi chất ─────────────────────────────

/** Chuyển hoá cơ bản: E mỗi tick cho mỗi (E cấu trúc)^0,75 (định luật Kleiber). */
export const BASAL_METABOLISM = 0.0052;
/** Chi phí di chuyển: E mỗi tick = hệ số × khối lượng × tốc độ². */
export const MOVE_COST = 0.0006;
/** Gen tốc độ lớn hơn 1 làm tăng chuyển hoá cơ bản (cơ bắp phải nuôi kể cả khi đứng yên). */
export const SPEED_UPKEEP = 0.35;
/** Gen tầm nhìn lớn hơn 1 làm tăng chuyển hoá cơ bản (mô thần kinh/võng mạc đắt). */
export const VISION_UPKEEP = 0.3;
/** Lông dày tốn năng lượng nuôi: hệ số nhân chuyển hoá cho gen chịu lạnh = 1. */
export const INSULATION_UPKEEP = 0.1;
/** Lông dày hạ ngưỡng lạnh xuống ngần này °C, nhưng cũng hạ ngưỡng nóng xuống ngần này °C. */
export const INSULATION_COLD_SHIFT = 16;
export const INSULATION_HEAT_SHIFT = 10;
/** Chuyển hoá tăng thêm cho mỗi °C dưới ngưỡng lạnh / trên ngưỡng nóng. */
export const COLD_STRESS = 0.06;
export const HEAT_STRESS = 0.045;
/** Hệ số chuyển hoá khi nghỉ và khi ngủ đông. */
export const REST_METABOLISM = 0.7;
export const HIBERNATE_METABOLISM = 0.07;
/** Hiệu suất chuyển dự trữ thành mô cơ thể khi lớn (phần còn lại thành nhiệt). */
export const GROWTH_EFFICIENCY = 0.75;
/** Con non chỉ lớn khi dự trữ vượt tỉ lệ này của sức chứa (giữ đệm mỡ trước, lớn sau — nếu không sẽ chết đói mùa đông đầu đời). */
export const GROWTH_RESERVE_FRACTION = 0.45;
/** Tốc độ ăn xác so với ăn cỏ (thịt đậm năng lượng, ăn nhanh hơn). */
export const CARCASS_INTAKE_MULTIPLIER = 6;

// ───────────────────────────── Động vật: sức khoẻ, cái chết ─────────────────────────────

/** Máu mất mỗi tick khi hết dự trữ năng lượng / hết nước (tỉ lệ của máu tối đa). */
export const STARVATION_DAMAGE = 0.012;
export const DEHYDRATION_DAMAGE = 0.01;
/** Máu hồi mỗi tick khi no đủ. */
export const HEALTH_REGEN = 0.0015;
/** Tuổi (theo tỉ lệ tuổi thọ) bắt đầu lão hoá, và cường độ nguy cơ chết già. */
export const SENESCENCE_START = 0.6;
export const SENESCENCE_HAZARD = 3;
/** Máu mất mỗi tick khi ở trong nước sâu (loài không bơi) hoặc cá mắc cạn. */
export const DROWN_DAMAGE = 0.03;
/** Tốc độ thối rữa của xác (tỉ lệ năng lượng mỗi tick, ở 20 °C). */
export const CORPSE_DECAY = 0.0022;

// ───────────────────────────── Động vật: giác quan, chiến đấu ─────────────────────────────

/** Tán rừng dày giảm tầm phát hiện của kẻ nhìn từ mặt đất / từ trên không tới ngần này. */
export const CANOPY_COVER_GROUND = 0.5;
export const CANOPY_COVER_AIR = 0.9;
/** Nguỵ trang hoàn hảo (màu lông trùng màu nền) giảm tầm bị phát hiện tới ngần này. */
export const CAMOUFLAGE_STRENGTH = 0.4;
/** Con mồi đứng im/ngủ khó bị phát hiện hơn; con ngủ đông gần như vô hình (trong hang, dưới bùn). */
export const STILLNESS_COVER = 0.25;
export const HIBERNATION_COVER = 0.9;
/** Sát thương một cú đánh trúng = hệ số × attack × (khối lượng kẻ săn / khối lượng con mồi). */
export const ATTACK_DAMAGE = 0.55;
/** Sát thương phản đòn = hệ số × defense × (khối lượng con mồi / khối lượng kẻ săn). */
export const RETALIATION_DAMAGE = 0.2;
/** Số tick giữa hai cú đánh của cùng một kẻ săn. */
export const STRIKE_COOLDOWN = 12;
/** Xác suất đánh trúng cơ bản khi đã áp sát. */
export const STRIKE_HIT_CHANCE = 0.7;
/** Con mồi ở dưới nước khó bị kẻ săn trên cạn bắt hơn (hệ số nhân xác suất trúng). */
export const WATER_REFUGE = 0.35;
/**
 * Đuối sức: chạy nước rút (trốn/đuổi) quá `endurance` tick của loài thì tốc độ giảm dần, tới mức giảm tối đa này
 * khi đã chạy gấp đôi sức bền. Nhờ vậy loài dai sức (sói) hạ được con mồi nhanh ngang mình bằng cách đuổi cho kiệt.
 */
export const FATIGUE_SLOWDOWN = 0.35;
/** Kẻ săn từ trên không chỉ bắt được con mồi dưới nước ở chỗ nông hơn mức này; nước sâu là nơi trú ẩn của cá. */
export const AERIAL_STRIKE_DEPTH = 0.03;
/** Tốc độ tối đa giảm khi kiệt sức/già/non: hệ số tối thiểu. */
export const WEAK_SPEED_FACTOR = 0.6;

// ───────────────────────────── Di truyền, phân loài ─────────────────────────────

/** Số gen tối đa của một loài (7 gen chung + tối đa 3 gen đặc thù). */
export const MAX_GENES = 10;
/** Chu kỳ kiểm tra phân loài (tick). */
export const SPECIATION_INTERVAL = 600;
/** Hai quần thể phải không trao đổi gen trong ít nhất ngần này tick mới được coi là cách ly. */
export const ISOLATION_TICKS = 6000;
/** Khoảng cách gen chuẩn hoá (đơn vị: độ lệch chuẩn gộp, RMS qua các gen) để tách phân loài. */
export const SPECIATION_DISTANCE = 1.2;
/** Một quần thể con cần ít nhất ngần này cá thể mới được xét tách. */
export const MIN_DEME_SIZE = 30;
/** Sàn của độ lệch chuẩn khi chuẩn hoá khoảng cách gen (tỉ lệ của biên độ gen) — tránh chia cho ~0. */
export const DISTANCE_SD_FLOOR = 0.03;

// ───────────────────────────── Thảm hoạ ─────────────────────────────

/** Chu kỳ lan của lửa (tick) và số chu kỳ một ô cháy. */
export const FIRE_INTERVAL = 4;
export const FIRE_BURN_STEPS = 6;
/** Máu mất mỗi lần suy nghĩ khi đứng trong ô đang cháy. */
export const FIRE_DAMAGE = 0.5;
/** Dịch bệnh: thời gian nhiễm (tick), máu mất mỗi tick, xác suất lây mỗi lần tiếp xúc, bán kính lây (u). */
export const DISEASE_DURATION = 360;
export const DISEASE_DAMAGE = 0.0022;
export const DISEASE_TRANSMISSION = 0.12;
export const DISEASE_RADIUS = 14;
