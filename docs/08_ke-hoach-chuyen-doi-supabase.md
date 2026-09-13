# Đánh giá & Kế hoạch chuyển đổi sang Supabase

> Tài liệu này ghi lại kết quả kiểm tra code (2026-09-13) và kế hoạch đề xuất để chuyển
> dữ liệu quản lý (admin) từ SQLite local sang Supabase, cùng đề xuất tính năng export Excel.

## 1. Kiến trúc hiện tại (đã đọc code)

- **Server**: Fastify, single Node process (`server/src/`), dùng **`node:sqlite`** (SQLite
  built-in của Node 22.13+, không cần native binding).
- **Admin page**: `server/src/pages.ts` — 1 file HTML server-render + vanilla JS fetch SPA,
  gồm các tab: Tình trạng phát thưởng (queue), Dashboard, Kho quà, Cấu hình xác suất,
  Log phiên, Log audit. Không có React admin riêng trong `apps/kiosk`.
- **Auth**: không có hệ thống user — chỉ 1 `ADMIN_KEY` + 1 `OPERATOR_PIN` tĩnh gửi qua header
  (`x-admin-key`, `x-operator-pin`).
- **Điểm mấu chốt về mặt an toàn**: việc trừ tồn kho khi bốc thăm dùng transaction
  `BEGIN IMMEDIATE` đồng bộ tại chỗ (`server/src/db.ts:383`) để **đảm bảo tuyệt đối không bao
  giờ âm kho** — đây là yêu cầu nghiệp vụ cứng (checked constraint `CHECK (remaining_qty >= 0)`
  + transaction serialize).
- **Triển khai thực tế**: đây là app **kiosk tại quầy pop-up**, chạy local
  (`localhost:8788`), có sẵn `tools/tunnel.mjs` / `SHARE-ONLINE.bat` chỉ để demo/chia sẻ tạm
  qua Cloudflare Tunnel — không phải mô hình vận hành chính thức. README nói rõ: game được
  thiết kế chạy độc lập không cần internet.
- **CSV export đã có sẵn**: `GET /api/admin/report.csv` (`server/src/adminRoutes.ts:387`) —
  xuất session/draw/claim/metrics ra CSV, nút bấm ngay trong tab "Session Log".

## 2. Có chuyển sang Supabase được không?

**Được**, về mặt kỹ thuật hoàn toàn khả thi — schema hiện tại (`rule_versions`, `prizes`,
`sessions`, `draws`, `claims`, `play_metrics`, `session_events`, `audit_log`, `app_errors`)
là schema SQL chuẩn, port sang Postgres không có gì đặc biệt khó.

Nhưng có **một rủi ro nghiệp vụ thật**, không phải lý thuyết: nếu thay thế SQLite local bằng
Supabase (Postgres qua internet) làm nguồn dữ liệu chính cho luồng chơi/bốc thăm, thì **mất
mạng tại sự kiện = kiosk đứng hình, khách không chơi được, không phát thưởng được**.

**Bối cảnh đã xác nhận với chủ dự án:** mạng tại venue không chắc chắn, và kiosk **bắt buộc
phải chạy được khi mất mạng**. Nên full-replace (thay SQLite bằng Supabase làm nguồn dữ liệu
chính cho luồng chơi) là phương án rủi ro cao, **không phù hợp**.

## 3. Kiến trúc đề xuất: Hybrid (an toàn nhất)

**Giữ SQLite làm "nguồn sự thật" tại kiosk cho toàn bộ luồng chơi/bốc thăm/phát thưởng**
(không đổi `db.ts`, không đổi transaction). **Thêm một lớp đồng bộ (sync) một chiều lên
Supabase** chạy nền, chỉ phục vụ mục đích báo cáo/xem từ xa — không nằm trên đường găng
(critical path) của game.

```
Kiosk (tablet)                          Supabase (cloud)
┌─────────────────────┐                 ┌──────────────────────┐
│ Fastify + SQLite     │  sync worker    │ Postgres (mirror)     │
│  - tạo session       │ ───────────────▶│  - sessions           │
│  - bốc thăm (atomic) │  push mỗi N giây│  - draws / claims      │
│  - trừ kho (atomic)  │  hoặc theo event│  - prizes (snapshot)   │
│  - admin queue/dash  │                 │  - audit_log           │
│  (vẫn hoạt động khi  │                 │                        │
│   mất mạng)          │                 │  → Dashboard/Export    │
└─────────────────────┘                 │    xem từ xa qua       │
                                          │    internet            │
                                          └──────────────────────┘
```

Cách này đáp ứng đúng mục tiêu "an toàn nhất": kiosk không phụ thuộc Supabase để hoạt động,
nhưng vẫn có dữ liệu tập trung trên cloud để xem báo cáo/xuất Excel từ xa mà không cần đứng
cạnh máy kiosk hay mở tunnel.

### Việc cần làm nếu triển khai hybrid này

1. **Tạo project Supabase** + port schema hiện tại sang Postgres (đổi kiểu dữ liệu:
   `INTEGER` bool → `boolean`, JSON text → `jsonb`, v.v.) — schema đơn giản, không có FK
   phức tạp ngoài những gì đã có.
2. **Viết sync worker** trong `server/` (chạy trong cùng process hoặc cron riêng):
   - Theo dõi bảng có thay đổi (dùng cột `created_at`/`updated_at` hoặc bảng outbox đơn giản)
     và `INSERT/UPSERT` lên Supabase qua `@supabase/supabase-js` hoặc `postgres` client.
   - Chạy **best-effort, không chặn** luồng chơi — nếu mất mạng, giữ trong hàng đợi, retry
     khi có mạng lại (giữ tinh thần offline-first).
3. **Không đổi gì trong `sessionService.ts` / `adminRoutes.ts`** cho phần transaction bốc
   thăm — giữ nguyên an toàn hiện có.
4. **Dashboard/báo cáo từ xa** (tuỳ chọn, giai đoạn 2): 1 trang admin nhẹ đọc thẳng từ
   Supabase (không cần đứng cạnh kiosk), dùng Supabase Auth thật thay vì key tĩnh nếu muốn
   nhiều người xem.
5. Ước lượng công sức: **schema + sync worker cơ bản (1 chiều, không xung đột)** — vừa phải,
   không lớn, vì không phải viết lại logic nghiệp vụ, chỉ thêm 1 module mới cạnh `db.ts`.

### Khi nào mới cần Supabase làm nguồn dữ liệu chính

Nếu sau này thật sự cần **nhiều kiosk chia sẻ chung 1 kho quà**, đó là bài toán khác hẳn —
kho dùng chung bắt buộc phải có nguồn dữ liệu tập trung, lúc đó mới cần cân nhắc để Supabase
làm nguồn chính và chấp nhận rủi ro mạng. Theo bối cảnh hiện tại (ưu tiên an toàn, một kiosk
đơn lẻ), **chưa cần đi hướng đó**.

## 4. Export Excel — ĐÃ TRIỂN KHAI (2026-09-13)

CSV endpoint vẫn giữ nguyên, đã bổ sung thêm **file Excel thật (.xlsx)** độc lập với việc có
Supabase hay không:

- Thêm thư viện `exceljs` vào `server` (`server/package.json`).
- Thêm route `GET /api/admin/report.xlsx` cạnh `report.csv` hiện có, tái dùng đúng query
  đang có trong `server/src/adminRoutes.ts`.
- 3 sheet: **Sessions** (session/draw/claim/metrics), **Prizes** (kho quà, tên vi/ko/en),
  **Audit Log** — header bôi đậm, freeze dòng đầu, autoFilter, định dạng ngày giờ đúng kiểu.
- Nút "Excel 내보내기" đã thêm cạnh nút "CSV 내보내기" trong tab Session Log
  (`server/src/pages.ts`).
- Đã test thực tế: chạy server, gọi endpoint, giải nén `.xlsx` kiểm tra 3 sheet và dữ liệu
  thật (tên quà tiếng Việt/Hàn/Anh, session thật) — OK.

## 5. Tóm tắt

| Việc | Khả thi | Rủi ro |
|---|---|---|
| Chuyển hoàn toàn sang Supabase (thay SQLite làm nguồn chính) | Được, nhưng **không khuyến nghị** với yêu cầu "phải chạy khi mất mạng" | Cao |
| Hybrid: SQLite tại kiosk (giữ nguyên) + đồng bộ 1 chiều lên Supabase để xem báo cáo | **Khuyến nghị** | Thấp |
| Export Excel (.xlsx) | **Đã làm xong**, không phụ thuộc Supabase | Không |

## 6. Câu hỏi đã trao đổi & quyết định

- **Mục tiêu chuyển sang Supabase**: chưa chắc chắn cụ thể — chọn phương án an toàn nhất.
- **Độ tin cậy mạng tại venue**: không chắc chắn — kiosk **bắt buộc phải chạy được khi mất
  mạng**. → Đây là ràng buộc quyết định chọn kiến trúc Hybrid ở mục 3 thay vì thay thế
  hoàn toàn.

## 7. Bước tiếp theo đề xuất

1. ~~Làm export Excel trước (độc lập, nhanh, có giá trị ngay).~~ — **Đã xong**, xem mục 4.
2. Triển khai sync worker lên Supabase theo kiến trúc Hybrid ở mục 3, nếu vẫn muốn có báo
   cáo/dashboard xem từ xa — chưa làm, chờ xác nhận có cần thiết hay không.
