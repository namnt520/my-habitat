# Kế hoạch thực hiện — My Habitat

Mô phỏng hệ sinh thái tiến hoá chạy trên trình duyệt. Tài liệu này được viết **trước khi viết code**
và là bản đồ cho các giai đoạn. Mỗi giai đoạn kết thúc bằng: chạy test → commit (Conventional Commits).

## 1. Các quyết định kiến trúc chốt từ đầu

| Chủ đề                            | Quyết định                                                                                                                                                                         | Lý do                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Lõi mô phỏng                      | TypeScript thuần trong `src/sim` + `src/species`, biên dịch với `lib: ES2022` (không có DOM)                                                                                       | Trình biên dịch tự chặn mọi phụ thuộc DOM; cùng một mã chạy trong Node, Worker và test                         |
| Tất định                          | Một RNG `sfc32` duy nhất có seed; **cấm** `Math.random`, `Date`, và các hàm siêu việt (`Math.sin/exp/pow…`) trong lõi bằng luật ESLint; dùng `detmath.ts` (đa thức, chỉ + − × ÷ √) | `+ − × ÷ √` được IEEE‑754 quy định chính xác; `sin/exp/pow` thì không → kết quả có thể lệch giữa các engine JS |
| Dữ liệu cá thể                    | Structure of Arrays (typed array), khe trống tái sử dụng, dung lượng tự nở                                                                                                         | Thân thiện cache, chuyển sang Worker không cần copy đối tượng                                                  |
| Hàng xóm                          | Spatial hash đều (ô 40 đơn vị), dựng lại mỗi tick bằng counting sort O(n)                                                                                                          | Không có vòng lặp O(n²)                                                                                        |
| Sinh vật sản xuất, côn trùng, nấm | Trường mật độ trên lưới 200×200 (ô 10×10 đơn vị)                                                                                                                                   | Đề bài cho phép với côn trùng; với cỏ/tảo/nấm, mật độ là mô hình tự nhiên                                      |
| Động vật                          | 9 loài mô phỏng từng cá thể, mỗi cá thể có bộ gen lưỡng bội                                                                                                                        | Chọn lọc tự nhiên tác động lên cá thể                                                                          |
| Loài = dữ liệu                    | Mỗi loài một file JSON trong `src/species/data`; hành vi là danh sách module (`flee`, `forage`, `packHunt`, `hibernate`…) có tham số                                               | Thêm loài mới không cần sửa lõi                                                                                |
| AI                                | Utility AI: mỗi module trả điểm, module điểm cao nhất được thực thi                                                                                                                | Đổi thức ăn theo mùa (gấu) tự xuất hiện từ điểm số, không cần lịch viết cứng                                   |
| Năng lượng                        | Mọi dòng năng lượng đi qua `Ledger.flow(from, to, amount)`; mọi kho năng lượng dùng `Float64Array`                                                                                 | Kiểm toán được từng kho; sai số bảo toàn ~1e‑9                                                                 |
| Dinh dưỡng                        | Tỉ lệ N:E cố định cho mọi chất hữu cơ; quang hợp rút N khỏi đất tại ô, hô hấp/phân huỷ trả N về đất tại ô                                                                          | Vòng khép kín, động vật vận chuyển dinh dưỡng theo không gian                                                  |
| Vẽ                                | Worker gửi _snapshot_ (typed array, transferable). Renderer 2D/3D chỉ đọc snapshot                                                                                                 | Đổi 2D↔3D không đụng tới mô phỏng                                                                              |
| Bước thời gian                    | Tick cố định; Worker tự chạy theo tốc độ ticks/giây; renderer nội suy theo vận tốc                                                                                                 | Tốc độ mô phỏng độc lập với FPS                                                                                |
| Chạy TS trong Node                | `scripts/run.mjs` dùng Module Runner có sẵn của Vite                                                                                                                               | Không thêm dependency (không cần tsx/ts-node)                                                                  |

Dependency: `vite`, `typescript`, `vitest`, `three` (+ `@types/three`), `eslint` + `typescript-eslint`,
`prettier`. Không dùng framework UI — DOM + Canvas thuần.

## 2. Mô hình sinh thái (tóm tắt, chi tiết ở `docs/MODELS.md`)

- **Thời gian:** 1 ngày = 120 tick, 1 mùa = 600 tick, 1 năm = 2400 tick.
- **Địa hình:** fBm value‑noise theo seed, chuẩn hoá theo hạng (để mọi seed có cùng tỉ lệ nước/núi);
  một con sông Bắc–Nam uốn khúc được khắc xuyên bản đồ; rừng theo một lớp noise riêng.
- **Sản xuất:** cỏ (logistic, lan sang ô bên), cây bụi (sinh khối + quả theo mùa + ngân hàng hạt do
  động vật phát tán), tảo (trong nước).
- **Phân huỷ:** xác (thực thể) → mùn (trường) → nấm (trường) → N trong đất.
- **Động vật:** nhu cầu (đói, khát, sợ, sinh sản, ngủ) → utility AI → di chuyển/ăn/săn/giao phối.
- **Di truyền:** lưỡng bội, cộng gộp, phân li Mendel, đột biến Gauss; đánh đổi nằm trong công thức
  chuyển hoá chứ không nằm trong hàm thích nghi viết tay.
- **Phân loài:** quần thể con (deme) theo vùng liên thông; cách ly = không có dòng gen trong N tick;
  khoảng cách gen chuẩn hoá vượt ngưỡng → tách nhánh trong cây phát sinh.

## 3. Các giai đoạn

| #   | Giai đoạn        | Sản phẩm                                                                                                     | Kiểm chứng                                                                                  |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 0   | Khung dự án      | Vite + TS strict + ESLint + Prettier + Vitest, `PLAN.md`                                                     | `pnpm lint`, `pnpm typecheck` sạch                                                          |
| 1   | Nền tảng lõi     | `rng`, `detmath`, `noise`, `terrain`, `ledger`, `spatial`, `genetics`                                        | Unit test từng module; test "sông chia đôi bản đồ"                                          |
| 2   | Hệ sinh thái nền | `environment`, `fields` (cỏ, bụi, tảo, côn trùng, nấm), CLI `pnpm sim`                                       | Test bảo toàn năng lượng + dinh dưỡng trên trường; chạy 20k tick chỉ có thực vật            |
| 3   | Động vật         | SoA, giác quan, 12+ module hành vi, sinh sản, chiến đấu, xác, bầy/đàn, phân loài, thống kê                   | Test tất định (2 lần chạy cùng seed → cùng hash), test bảo toàn với động vật                |
| 4   | Cân chỉnh        | Tham số mặc định                                                                                             | `pnpm stability`: 20 seed × 20.000 tick; phân tích nguyên nhân thất bại; **không gian lận** |
| 5   | Worker + 2D      | Cầu nối Worker, renderer Canvas có LOD, loài vẽ bằng code theo gen                                           | Chạy thật trong trình duyệt, đo FPS với 5.000 cá thể                                        |
| 6   | Giao diện        | Biểu đồ quần thể, histogram gen, lưới thức ăn, inspector + phả hệ, cây phân loài, thanh trượt, thảm hoạ, CSV | Thao tác thật trong trình duyệt                                                             |
| 7   | 3D               | Three.js: heightmap, nước, cây, InstancedMesh, camera tự do/bám theo                                         | Đo FPS với 2.000 cá thể; đổi 2D↔3D lúc đang chạy, hash không đổi                            |
| 8   | Thí nghiệm       | Chế độ Lotka–Volterra: khớp tham số, vẽ chồng nghiệm ODE                                                     | `pnpm lv` xuất số liệu; giải thích độ lệch                                                  |
| 9   | Đo đạc           | Hiệu năng (tick ms, FPS), chạy 50.000 tick, so hash Node ↔ Worker                                            | Số liệu thật ghi vào báo cáo                                                                |
| 10  | Tài liệu         | `README.md`, `docs/MODELS.md`, `docs/REPORT.md`                                                              | Đối chiếu từng mục yêu cầu                                                                  |

## 4. Rủi ro đã thấy trước và cách xử lý

1. **Ổn định 14 loài qua 20.000 tick là phần khó nhất.** Quần thể kẻ săn đỉnh nhỏ (sói, gấu, đại bàng,
   kền kền) dễ tuyệt chủng ngẫu nhiên. Cách xử lý hợp lệ về sinh thái: nơi ẩn náu cho con mồi (rừng,
   nguỵ trang), kẻ săn no thì không săn, kẻ săn có thức ăn thay thế, dự trữ mỡ lớn, tín hiệu tìm bạn đời
   tầm xa, tính lãnh thổ. **Không** chặn số lượng, **không** tự sinh thêm cá thể.
2. **Tất định giữa Node và Worker:** cùng mã, cùng thứ tự duyệt, không hàm siêu việt. Kiểm chứng bằng
   cách so hash trạng thái thật giữa CLI và trình duyệt.
3. **Hiệu năng 2D:** Canvas 2D với 5.000 cá thể → LOD ba mức + cắt theo khung nhìn + gom lệnh vẽ.
4. **Thời gian cân chỉnh:** CLI chạy song song nhiều seed bằng tiến trình con; lõi phải < ~2 ms/tick.

## 5. Điều đã biết là sẽ đơn giản hoá (sẽ ghi lại trong REPORT)

- Côn trùng, cỏ, cây bụi, tảo, nấm là trường mật độ, không có bộ gen từng cá thể.
- Cây rừng là cấu trúc địa hình tĩnh (che tầm nhìn), không tham gia dòng năng lượng.
- Không tìm đường (pathfinding) toàn cục: động vật lái tham lam + trường hướng tới nước.
- Chăm sóc con non (bú sữa) không được mô phỏng; con non nhận vốn năng lượng lúc sinh.
