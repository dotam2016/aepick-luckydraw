# AEPICK LUCKY DRAW

**Trò chơi gắp vật phẩm dạng kiosk dọc dành cho pop-up store — Bốc thăm theo xác suất + hiệu ứng dựa trên vật lý.**

Lập kế hoạch: [Tài liệu kế hoạch phát triển ứng dụng v1.2] (bản đã phản ánh implementation) · [v1.1] · [v1.0 bản gốc)
Kiểm chứng: [Báo cáo kiểm chứng] · [Kết quả Visual Spike] · [Lịch sử chuyển đổi 3D]

## Nguyên tắc số 1

> Mô phỏng vật lý không tạo ra kết quả. Nó chỉ thể hiện một cách thuyết phục kết quả đã được quyết định trước.

Ngay khi operator phê duyệt **Start**, **server** sẽ kiểm tra xác suất, tồn kho, giới hạn số lượng và quota theo khung giờ để xác định kết quả.

Client không nhận thông tin về tier (등급), mà chỉ nhận `motion` (`win / missVariant / effectLevel`) để điều khiển phần trình diễn.

---

## Cấu trúc

| Đường dẫn            | Nội dung                                                                                              | Trạng thái |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| `packages/shared`    | Type · engine bốc thăm · pacing theo khung giờ · session code · validation cấu hình · i18n (vi/en/ko) | Hoàn thành |
| `server`             | Game API + state machine tồn kho/phát thưởng + web admin (`/admin`) + trình mô phỏng bốc thăm         | Hoàn thành |
| `tools/e2e.mjs`      | Bộ kiểm thử API E2E (64 hạng mục)                                                                     | Hoàn thành |
| `apps/kiosk`         | Ứng dụng trải nghiệm kiosk (React + Vite + **Three.js + Rapier 3D**, 3 màn hình · 6 phase)            | Hoàn thành |
| `tools/autoplay.mts` | Harness tự động — tự động kiểm tra tính nhất quán giữa kết quả và hiệu ứng, độ ổn định vật lý         | Hoàn thành |
| `apps/spike-3d`      | Visual Spike — kiểm chứng khả năng đạt được visual look tham chiếu bằng Three.js                      | Hoàn thành |
| `android-shell`      | (Giai đoạn 2) Kotlin WebView kiosk shell                                                              | Dự kiến    |

---

## Chạy ứng dụng

```bash
npm install
npm run dev:server   # http://localhost:8788 (API + Admin)
npm run dev:kiosk    # http://localhost:5174 (Kiosk, /api proxy tới 8788)
```

* **Admin:** `http://localhost:8788/admin` — Key mặc định `aepick-admin` (`ADMIN_KEY`), PIN operator `1234` (`OPERATOR_PIN`)
* **Unit Test:** `npm test` (100.000 lượt kiểm tra phân phối bốc thăm · pacing · validation cấu hình · tạo code — 39 hạng mục)
* **API E2E:** Sau khi khởi động server, chạy `npm run e2e` (64 hạng mục)
* **Trình mô phỏng bốc thăm:** `npm run sim`
* **Autoplay Harness:** `npm run autoplay` (mặc định 500 lượt · CSV kết quả được lưu trong `reports/`)
* **Visual Spike:** `npm run dev -w @aepick/spike-3d` → `http://localhost:5175`
* **Chụp màn hình Kiosk:** `node tools/kiosk-shot.mjs --tier t1` (điều khiển toàn bộ flow và chụp màn hình bằng headless)
* **Render video màn hình chờ:** `node tools/render-attract.mjs --seconds 8 --fps 30`

---

## Autoplay Harness (§15.1)

Harness chạy game engine thực tế mà không cần rendering, sử dụng **virtual clock cố định 1/60 giây**, đồng thời tự động đánh giá các tiêu chí nghiệm thu trong §16.2.

Server vẫn được gọi thực tế, vì vậy session, bốc thăm, metrics và truy vấn kết quả đều sử dụng cùng một flow như môi trường vận hành thực tế.

Tốc độ nhanh hơn khoảng **45 lần so với thời gian thực**.

```bash
npm run autoplay -- --runs 600 --real 40   # 600 lượt test + 40 session thực tế
npm run autoplay -- --mode capsuleOpen     # Chỉ test mode trình diễn cụ thể
npm run autoplay -- --runs 60 --fault 50   # Tự kiểm tra harness (fault injection)
```

Các hạng mục kiểm tra:

* Không nhất quán giữa kết quả và hiệu ứng
* Thoát khỏi màn hình
* Vật thể bị bật/văng bất thường
* NaN
* Rung động vĩnh viễn
* Rò rỉ bóng
* Ma trận coverage giữa tier × mode trình diễn
* Phân bố vị trí ngắm

`--fault N` sẽ đảo ngược giá trị `win` truyền vào engine ở **N% số lượt**, nhằm kiểm tra xem harness có thực sự phát hiện được sự không nhất quán hay không.

> **Một công cụ kiểm chứng chỉ luôn PASS thì thực tế không đảm bảo được điều gì.**

---

## Tham số URL của Kiosk

| Tham số                                    | Mục đích                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `?debug=1`                                 | Debug HUD (§15.3) — phase · FPS · seed · contract trình diễn · trạng thái test                             |
| `?noTimeout=1`                             | Vô hiệu hóa timeout khi không có thao tác và tự động quay về sau khi hiển thị kết quả (dùng cho auto test) |
| `?reveal=grabMiss` / `?reveal=capsuleOpen` | Bắt buộc sử dụng phương án A/B tương ứng trong §4.3 (bỏ qua thiết lập từ server)                           |

### Cấu trúc màn hình

* Khu vực 3D phía trên: **1080 × 1344**
* Khu vực điều khiển phía dưới: **1080 × 576**
* Khu vực điều khiển gồm nút trái, nút phải và nút hạ xuống
* Màn hình chờ sử dụng video loop pre-render `public/assets/attract.mp4`

### Truy cập Operator

**Nhấn giữ 2 giây tại hotspot ẩn ở góc trên bên trái** → nhập PIN → phê duyệt 1 lượt chơi / tạo test session.

Trong panel Test Session có thể:

* Ép chỉ định tier
* Chuyển đổi A/B option trong runtime
* Kiểm tra phần trình diễn

---

# Trình mô phỏng bốc thăm

Trước khi sự kiện mở cửa, simulator được sử dụng để xác định các giá trị **xác suất · tồn kho · pacing** và tạo ra cơ sở dữ liệu/định lượng làm căn cứ vận hành. (§15.2)

```bash
npm run sim -- --visitors 900 --iterations 200 --t1 3 --t2 10 --t3 30 --t4 120 --t5 300
npm run sim -- --pacing-tiers t1,t2,t3,t4,t5   # So sánh các tier áp dụng pacing
npm run sim -- --no-pacing                     # Đối chiếu khi không áp dụng pacing
npm run sim -- --renormalize                   # Chính sách tái chuẩn hóa theo tỷ lệ đối với phần đã hết
```

### Output

* Kiểm chứng phân phối với 100.000 lượt (đánh giá 4σ)
* Thời điểm hết tồn kho theo từng tier
* **Đường cong tỷ lệ trúng theo từng khung giờ**

---

# Thiết kế cốt lõi

## State Machine hai tầng (Tài liệu kế hoạch §11, Phụ lục A·B)

|                   | Layer 1 — Trạng thái màn hình | Layer 2 — Trạng thái session                       |
| ----------------- | ----------------------------- | -------------------------------------------------- |
| Chủ sở hữu        | Client (volatile)             | Server / DB (persistent)                           |
| Giá trị           | WAITING → … → RESULT          | CREATED → DRAWN → PLAYED → PENDING_CLAIM → CLAIMED |
| Chuyển trạng thái | Input · Timer · Animation     | Chỉ thông qua API của `sessionService.ts`          |

Ngay cả khi màn hình quay từ **RESULT → WAITING**, session vẫn được giữ ở trạng thái **PENDING_CLAIM**.

Việc tách biệt hai tầng này cho phép đồng thời thực hiện:

* Tự động quay về màn hình kết quả
* Xử lý payout queue bất đồng bộ

---

# Mối quan hệ giữa vật lý và kết quả (§7.1)

`apps/kiosk/src/game/clawGame.ts` quản lý phần vật lý bằng **Rapier 3D**.

Việc các quả bóng trong đống bóng bị đẩy, xoay và va chạm dây chuyền được tính toán bằng Rigidbody. Tuy nhiên, **việc quả bóng mục tiêu có được gắp hay không không được quyết định bởi vật lý**.

Kết quả được xác định trước từ `motion.win` do server gửi xuống, sau đó hệ thống **kết nối/ngắt spherical joint** tương ứng với quả bóng để tạo ra hiệu ứng phù hợp.

Do đó, **không tồn tại đường dẫn mà kết quả có thể bị thay đổi bởi yếu tố ngẫu nhiên của physics**.

### Đặc điểm vật lý

* Chuyển động của claw chỉ theo **1 trục (X)**.
* Chiều vật lý và trục điều khiển là hai quyết định độc lập.
* Chỉ riêng đống bóng được dựng và mô phỏng dưới dạng 3D.
* Physics step cố định ở **1/60 giây** — biến động FPS không ảnh hưởng đến kết quả.
* Có cơ chế an toàn cách ly: nếu bóng đi ra ngoài khu vực box, hệ thống sẽ đưa bóng trở lại vị trí an toàn.
* Việc bố trí bóng và randomization của hiệu ứng sử dụng `physicsSeed` do server cung cấp, vì vậy có thể tái hiện lại cùng một trạng thái.
* `ClawGame.verifyOutcome()` tự động kiểm tra tính nhất quán giữa hiệu ứng và kết quả sau mỗi lượt chơi.
* Nếu phát hiện không nhất quán, hệ thống gửi lỗi `REVEAL_MISMATCH` về server. (§16.2)

### Bảo mật kết quả

Client **không nhận tier, tên phần thưởng hoặc code** tại thời điểm tạo session.

Client chỉ nhận `motion` cần thiết cho phần trình diễn:

```text
win
missVariant
effectLevel
```

Thông tin chi tiết về kết quả chỉ được truy vấn tại thời điểm **REVEAL**, thông qua `resultToken`.

---

# Tính toàn vẹn hệ thống

* Mọi session creation bắt buộc phải có `idempotencyKey`.
* Nếu gửi lại request với cùng một key, hệ thống trả về chính xác response của request đầu tiên.
* Việc reserve tồn kho sử dụng `BEGIN IMMEDIATE` + `UPDATE ... WHERE remaining_qty > 0`, do đó không tồn tại trường hợp tồn kho bị âm.
* Toàn bộ phép tính xác suất sử dụng **milli-percent integer (0~100000)**, không sử dụng floating point nên không xảy ra sai số tích lũy.
* Nếu tổng xác suất không bằng **100.000%**, Publish API sẽ từ chối request.
* Nếu state transition vi phạm bảng transition trong Phụ lục B, API sẽ từ chối với HTTP **409**.

---

# Test Mode (§5.6)

Session được tạo với `isTest: true` sẽ:

* Không reserve hoặc trừ tồn kho
* Không được tính vào thống kê
* Có thể ép chỉ định tier bằng `forceTier` để kiểm tra hiệu ứng
* Hiển thị watermark **`TEST`** trên màn hình kết quả

---

# Environment Variables (Server)

| Biến           | Giá trị mặc định               | Mô tả                    |
| -------------- | ------------------------------ | ------------------------ |
| `PORT`         | 8788                           | API port                 |
| `ADMIN_KEY`    | aepick-admin                   | Admin authentication key |
| `OPERATOR_PIN` | 1234                           | PIN của operator         |
| `DB_PATH`      | `server/data/luckydraw.sqlite` | Đường dẫn file SQLite    |

---

# Yêu cầu Node

**Node 22.13+**

Sử dụng `node:sqlite` được tích hợp sẵn, không có dependency yêu cầu native build.

Môi trường phát triển và kiểm chứng đã được thực hiện trên **Node 24.14**.

---

## Deploy bằng Docker trên EC2

Xem [DEPLOY_EC2.md](DEPLOY_EC2.md). Cấu hình mặc định publish Lucky Draw ở cổng `8788` và lưu SQLite trong Docker volume riêng.
