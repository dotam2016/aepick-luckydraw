# Hướng dẫn set tỷ lệ ở tab "확률 설정" (Cấu hình xác suất)

> Nguồn: `server/src/pages.ts` (UI + JS), `server/src/adminRoutes.ts:179-249` (API),
> `packages/shared/src/rules.ts` (luật validate).

## 1. Truy cập

1. Chạy server (`npm run dev:server` hoặc `START.bat`).
2. Mở `http://localhost:8788/admin`.
3. Nhập **admin key** (mặc định `aepick-admin`, đổi qua env `ADMIN_KEY`) — dùng chung ô
   nhập cho cả header `x-admin-key` lẫn `x-operator-pin` (`pages.ts:239`), nên chỉ cần
   nhập admin key là đủ quyền cho mọi thao tác, kể cả 검증/게시.
4. Vào tab **확률 설정**.

## 2. Các nhóm field trong tab

| Nhóm | Field | Ý nghĩa |
|---|---|---|
| **Xác suất từng giải** | 1등 % … 5등 %, 꽝 % | Tỷ lệ trúng mỗi hạng + tỷ lệ trượt (đơn vị %, cho phép tới 3 số thập phân) |
| **소진 정책** (chính sách hết hàng) | `toMiss` (꽝 귀속 — khuyến nghị) / `renormalize` (비례 재정규화) | Khi 1 giải hết hàng: `toMiss` dồn tỷ lệ giải đó sang trượt; `renormalize` chia lại tỷ lệ đó cho các giải còn hàng theo tỷ lệ tương ứng |
| **페이싱** (pacing / dàn trải theo thời gian) | 사용/미사용, 버킷(phút), 쿼터 해제(phút trước giờ đóng), 이월/고정, 대상 등급 | Chia ngày ra từng "bucket" thời gian để rải quota trúng thưởng đều hơn thay vì phát hết sớm. Xem thêm §5 trong `docs/04_검증보고서.md` (QA từng phát hiện scope mặc định chỉ áp cho t1-t3 là chưa đủ, còn t4 dồn late-event) |
| **Cấu hình game** | 조준(초), 당첨/꽝 노출(초), 구슬 수, 결과 공개 연출 (A/B) | Không liên quan xác suất trúng thưởng, chỉ là timing/hiệu ứng UI |
| **사유 변경** | bắt buộc khi 게시 | Lý do thay đổi, lưu vào lịch sử để audit |

## 3. Ý nghĩa 2 nút chính

### 검증 (Validate) — kiểm tra khô, không lưu gì cả

- Gọi `POST /api/admin/rules/validate`.
- Không ghi DB, không ảnh hưởng hệ thống đang chạy — chỉ để thử trước khi chốt số.
- Trả về:
  - `ok` / `issues[]` — danh sách lỗi nếu có (xem bảng luật ở mục 4).
  - `preview` — mô phỏng **1.000 lượt chơi** sẽ ra bao nhiêu lượt mỗi hạng
    (`per1000 = probability × 10`), hiển thị ngay dưới form.

### 게시 (Publish) — xác nhận và áp dụng thật ngay lập tức

- Gọi `POST /api/admin/rules/publish`.
- Validate lại lần nữa ở server (không tin client), nếu fail thì trả lỗi 400 và **không** ghi gì.
- Nếu pass: mở transaction — set mọi bản ghi `rule_versions` cũ về `is_active = 0`,
  insert bản mới với `is_active = 1` (`adminRoutes.ts:230-248`).
- **Hiệu lực ngay lập tức cho phiên chơi mới** — `getActiveRule()` (`server/src/db.ts`)
  luôn query bản active mới nhất từ DB, không cache, không cần restart server hay
  chạy lệnh gì thêm.
- Phiên đang chơi dở (session đã tạo trước khi publish) vẫn giữ nguyên rule cũ theo
  `rule_version` đã gán lúc tạo — không bị đổi giữa chừng.
- Bắt buộc phải điền "사유 변경", nếu để trống sẽ báo lỗi `REASON_REQUIRED`.
- Nút 게시 tự động bị disable nếu tổng xác suất chưa đúng 100.000% (`updateSum()`
  ở `pages.ts:398-405`, kiểm tra phía client song song với validate phía server).

## 4. Luật validate (bắt buộc để 게시 được chấp nhận)

Từ `packages/shared/src/rules.ts`:

**Xác suất (`validateProbabilities`)**
- Phải có đủ và đúng 6 tier: `t1, t2, t3, t4, t5, miss` — không thiếu, không trùng, không lạ.
- Mỗi giá trị phải ≥ 0, ≤ 100, và **tối đa 3 số thập phân** (dùng số nguyên milli-percent
  nội bộ để tránh sai số float).
- **Tổng phải đúng 100.000%** — đây là điều kiện chặn 게시 quan trọng nhất, sai dù chỉ
  0.001% cũng bị từ chối.

**Pacing (`validatePacing`)**
- `bucketMinutes`: 5–240 phút.
- `finalReleaseMinutes`: 0–480 phút.
- Tier trong danh sách pacing chỉ được là tier trúng thưởng (`t1`-`t5`), không được chứa `miss`.

**Game config (`validateGameConfig`)**
- `aimSeconds`: 8–20 giây.
- `resultSecondsWin`: 5–20 giây.
- `resultSecondsMiss`: 3–20 giây.
- `ballCount`: 25–140.
- `bgmVolume`, `sfxVolume`: 0–1.

Nếu bất kỳ luật nào fail, `검증`/`게시` đều trả về danh sách `issues` kèm message tiếng Hàn
cụ thể field nào sai — hiển thị trực tiếp trong khung xem trước (`#preview`) hoặc banner
thông báo trên UI.

## 5. Quy trình khuyến nghị khi đổi tỷ lệ thật

1. Sửa số ở các ô % → theo dõi ô **합계** (tổng) phía trên phải chuyển màu xanh (đúng 100%).
2. Bấm **검증** — đọc phần "예상 1,000회" để hình dung tỷ lệ ra prize thực tế.
3. (Khuyến nghị) chạy offline `npm run sim -- --pacing-tiers t1,t2,t3,t4,t5` để kiểm tra
   đường cong trúng thưởng theo thời gian trước khi chốt số liệu thật (script này không
   đụng vào DB thật, chỉ mô phỏng ngoài).
4. Điền lý do vào **사유 변경**.
5. Bấm **게시** → xác nhận popup → áp dụng ngay cho lượt chơi tiếp theo.
6. Kiểm tra lại bảng "설정 버전 이력" phía dưới để thấy version mới đã lên `활성` (active).
