# Mô hình sinh thái và các chỗ đơn giản hoá

Tài liệu này liệt kê từng mô hình mà mô phỏng dùng, công thức, và chỗ nào đã đơn giản hoá so với thực tế.
Hằng số nằm ở `src/sim/constants.ts`; tham số loài ở `src/species/data/*.json`.

## 1. Thời gian, khí hậu

| Mô hình | Công thức | Đơn giản hoá |
|---|---|---|
| Ngày/đêm | độ sáng = clamp(0,5 + 0,85·sin(2π(giờ − ¼))) | 1 ngày = 120 tick; không có trăng, mây |
| Mùa | nhiệt độ ngày = 13 + 10·sin(2π(pha năm − ⅛)) °C | 1 năm = 2400 tick (20 ngày). Mùa đông ôn hoà: thực vật vẫn mọc ~15–20% tốc độ mùa hạ |
| Thời tiết | chuỗi Markov mỗi 40 tick: mưa bắt đầu/tạnh theo xác suất theo mùa; hạn tự phát hiếm | Mưa đồng đều toàn bản đồ |
| Nước | mực nước tăng khi mưa, giảm do bốc hơi (∝ nhiệt độ), hồi về mực nền | Một mực nước chung cho mọi hồ; không có dòng chảy |
| Độ ẩm đất | biến toàn cục + cộng thêm gần nước, trừ bớt trên cao | Không có nước ngầm theo ô |

**Lệch thang thời gian (quan trọng):** vòng đời bị nén (thỏ sống ~1,5 năm = 3600 tick, một ngày dài 120 tick), nên
"một năm" chỉ có 20 ngày. Chuyển hoá được chỉnh theo vòng đời chứ không theo ngày.

## 2. Sinh vật sản xuất (trường mật độ trên lưới 200×200)

Tăng trưởng logistic bị giới hạn kiểu Liebig mềm:

    dB/dt = r · L(mùa) · f(nhiệt) · f(ẩm) · N/(N + K_N) · (B + s·B̄_kề) · (1 − B/K) − lụi tàn

- **Cỏ:** `s·B̄_kề` là cơ chế *mọc lan* (ô trống được ô bên gieo mầm). K giảm dưới tán rừng và trên đồi.
- **Cây bụi:** K cao nhất ở bìa rừng. Quả chỉ ra trong "mùa quả" (pha năm 0,28–0,72). Ô chưa có cây bụi chỉ
  mọc được nếu có **hạt** trong ngân hàng hạt; hạt đến từ quả rụng tại chỗ (15%) hoặc do động vật ăn quả thải ra
  (thời gian lưu trong ruột ~50 tick → hạt đi xa vài chục đến vài trăm đơn vị).
- **Tảo:** chỉ ở ô có nước; K giảm theo độ sâu (thiếu sáng). Hồ cạn → tảo chết thành mùn.
- Mỗi E quang hợp rút 0,01 N khỏi đất của chính ô đó.

*Đơn giản hoá:* không mô phỏng từng cây; cây rừng (tán) là địa hình tĩnh, không nằm trong dòng năng lượng;
hạt không mang năng lượng riêng (năng lượng của hạt nằm trong phân).

## 3. Côn trùng và nấm (trường mật độ)

- **Côn trùng:** ăn cỏ/lá bụi theo Holling II; đồng hoá 60%; hô hấp và hoạt động theo nhiệt độ (bất động dưới 2 °C,
  tối đa từ 13 °C); tử vong có số hạng phụ thuộc mật độ `c·I²` (bệnh, ký sinh — đóng kín mô hình cho một nhóm
  không được mô phỏng chi tiết); phát tán = khuếch tán sang ô kề.
- **Nấm:** hấp thụ mùn theo Monod, 35% thành sinh khối, phần còn lại hô hấp → nhiệt, N trả về đất. Mùn dưới nước
  được khoáng hoá với tốc độ bậc một (vi sinh vật thuỷ sinh không được mô phỏng riêng).

*Đơn giản hoá:* côn trùng và nấm không có bộ gen; đề bài cho phép mô phỏng côn trùng theo mật độ.

## 4. Năng lượng của động vật

    chuyển hoá cơ bản = 0,0052 · M^0,75 · hệ số loài · (1 + 0,35(tốc độ−1)) · (1 + 0,3(tầm nhìn−1)) · (1 + 0,1·lông)
    chi phí di chuyển = 0,0006 · M^0,75 · v² · hệ số loài
    stress nhiệt      = +6%/°C dưới ngưỡng lạnh, +4,5%/°C trên ngưỡng nóng (hằng nhiệt)

- **Kleiber (M^0,75)**: dùng năng lượng cấu trúc cơ thể làm khối lượng.
- **Đánh đổi gen** nằm hết trong các công thức trên — không có hàm thích nghi viết tay:
  nhanh → chạy tốn (v²) và nuôi cơ tốn; nhìn xa → chuyển hoá cơ bản tăng; to → M^0,75 lớn hơn, lớn lâu hơn, nhưng
  khó bị hạ, giữ nhiệt tốt; lông dày → chịu lạnh nhưng nóng mùa hạ và tốn nuôi lông; sải cánh dài → bay rẻ nhưng lao
  xuống kém chính xác; tích mỡ → chịu đói nhưng nặng; thiên ăn thịt (gấu) → đồng hoá thịt tốt, cỏ kém.
- **Ăn:** Holling II theo mật độ thức ăn tại ô; phần không đồng hoá thành mùn tại chỗ.
- **Lớn lên:** dự trữ → cấu trúc với hiệu suất 75%, chỉ khi dự trữ > 45% sức chứa.
- **Biến nhiệt** (ếch, cá): chuyển hoá và tốc độ ăn tỉ lệ với mức hoạt động theo nhiệt độ.

*Đơn giản hoá:* một "E" trừu tượng cho mọi dạng năng lượng; không tách protein/mỡ; nước cơ thể là một số [0, 1].

## 5. Dinh dưỡng (N)

Tỉ lệ N:E cố định (0,01) cho mọi chất hữu cơ. Quang hợp rút N khỏi ô; mọi hô hấp/phân huỷ/cháy trả N về **ô nơi nó
xảy ra** — nên động vật vận chuyển dinh dưỡng (ăn ở đồng cỏ, thải ở chỗ ngủ; đại bàng mang N từ hồ lên bờ). N khuếch
tán chậm giữa các ô và bị mưa rửa trôi xuống dốc.

*Đơn giản hoá:* một nguyên tố dinh dưỡng duy nhất; không có cố định đạm, không có thất thoát ra ngoài hệ.

## 6. Hành vi (utility AI)

Mỗi 6 tick một cá thể: sinh lý → cảm nhận (một lượt quét spatial hash) → mỗi module hành vi cho điểm → thực thi
module điểm cao nhất (trạng thái đang làm được cộng 0,06 để khỏi dao động). Thang điểm: ngủ đông 3 > chạy trốn
1,3–2,5 > khát/đói nguy kịch > ăn mồi vừa hạ 1,1 > đuổi mồi 0,95 > theo mẹ 0,85 > kiếm ăn (= cơn đói × độ giàu)
> tìm bạn 0,5–0,6 > ngủ 0,5 > nhập đàn 0,2–0,55 > lang thang 0,1.

**Giác quan:** tầm phát hiện = tầm nhìn × ánh sáng × tán rừng chỗ đứng × (1 − 0,7·tán rừng che mục tiêu; 0,9 nếu
nhìn từ trên không) × (1 − 0,4·nguỵ trang) × (đứng im/trong hang/ngủ đông) × kích thước mục tiêu.
Nguỵ trang = độ gần giữa màu lông (gen) và màu nền của ô (tuyết thì nền trắng).

**Săn mồi:** rình (đi chậm — con mồi chỉ hoảng khi kẻ săn vào "khoảng cách hoảng sợ") → bứt tốc → ra đòn khi áp
sát. Sát thương ∝ khối lượng kẻ săn / khối lượng con mồi; mồi lớn phản đòn. Chạy nước rút quá sức bền thì chậm dần
(sói dai sức hơn hươu → săn kiểu đuổi cho kiệt). Kẻ săn phải còn nhìn thấy con mồi mới đuổi tiếp. Kẻ săn đói
đánh hơi được mồi ngoài tầm nhìn, trừ khi mồi ở dưới tán rừng dày.

*Đơn giản hoá:* không tìm đường toàn cục (lái tham lam + trường hướng tới nước); không có trí nhớ ngoài "nhà";
phát hiện là ngưỡng tất định chứ không xác suất.

## 7. Di truyền

Lưỡng bội, cộng gộp: kiểu hình = trung bình hai alen. Mỗi bố mẹ truyền ngẫu nhiên một alen của từng gen (các gen
phân li độc lập — không có liên kết gen). Đột biến: mỗi alen xác suất 10%, cộng nhiễu "gần chuẩn" (tổng 4 số đều)
với σ = 4% biên độ gen. 7 gen chung (tốc độ, tầm nhìn, kích thước, ngưỡng sinh sản, sắc độ, độ sáng, chịu lạnh)
+ tối đa 3 gen đặc thù của loài.

*Đơn giản hoá:* không có trội/lặn, không có nhiễm sắc thể giới tính, không có liên kết gen hay tương tác gen.

## 8. Sinh sản và tự điều hoà mật độ

- Con cái sẵn sàng khi dự trữ ≥ gen ngưỡng × sức chứa và đang mùa giao phối; tìm bạn trong "tầm tín hiệu".
- Toàn bộ năng lượng của con non lấy từ dự trữ của mẹ; mẹ thiếu thì đẻ ít hơn.
- Con non theo mẹ và được nuôi tới tuổi cai sữa (sói: cả bầy cùng nuôi; con non ăn chung mồi của mẹ).
- **Lãnh thổ sinh sản** (cáo, sói, đại bàng, gấu): con cái chỉ đẻ nếu "nhà" của nó cách nhà của mọi con cái lớn tuổi
  hơn đang giữ lãnh thổ ít nhất R. Số lãnh thổ chứa được là hệ quả của hình học bản đồ, không phải một con số đặt sẵn.

*Đơn giản hoá:* không có chọn bạn tình; "bú" là chuyển năng lượng trực tiếp; trứng nở ngay khi đẻ.

## 9. Phân loài

Quần thể con = cá thể của một dòng đang ở cùng một vùng liên thông (đất liền giữa các vùng nước sâu/núi với thú
không bơi; từng thuỷ vực với cá; thuỷ vực gần nhất với ếch; cả bản đồ với chim). Tách phân loài khi (1) không có sự
kiện dòng gen vào/ra vùng đó trong 6.000 tick và (2) khoảng cách gen (RMS qua các gen của |Δ trung bình| / độ lệch
chuẩn gộp) giữa quần thể con và phần còn lại > 1,2. Sau đó hai dòng không giao phối được.

*Đơn giản hoá:* cách ly sinh sản là tức thời và tuyệt đối khi vượt ngưỡng (thực tế là dần dần); vùng địa lý xác định
theo mực nước nền.

## 10. So với Lotka–Volterra

Xem `docs/REPORT.md` mục 9 và bảng "Thí nghiệm" trong ứng dụng.
