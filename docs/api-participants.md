# API lấy danh sách người chơi — `GET /api/admin/export/all`

Trả về **toàn bộ thông tin của từng lượt chơi** (mỗi lượt chơi = 1 session = 1 khách). Gồm tất cả cột đang
dùng khi xuất Excel/CSV (`/api/admin/report.xlsx`) cộng thêm tên quà và vài chỉ số lúc chơi.

API này **chỉ đọc**, không sửa hay xóa bất cứ dữ liệu nào.

## 1. Endpoint

```
GET {BASE_URL}/api/admin/export/all
```

`BASE_URL` là địa chỉ server (ví dụ `http://localhost:8788`). Nếu server nằm sau một đường dẫn con
(API Gateway…), thêm đường dẫn đó vào trước `/api/...`.

## 2. Xác thực

Chỉ chấp nhận header **`x-admin-key`** (biến môi trường `ADMIN_KEY`, mặc định `aepick-admin`).
PIN vận hành (`x-operator-pin`) **không** dùng được cho API này.

Thiếu hoặc sai header → `401 {"error":"UNAUTHORIZED","message":"관리자 인증이 필요합니다."}`.

## 3. Tham số truyền vào (query string)

Tất cả đều **tùy chọn**. Không truyền gì thì trả về các lượt chơi thật (không gồm test), mới nhất trước, tối đa 1000 dòng.

| Tham số | Kiểu | Mặc định | Giải thích |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | — | Chỉ lấy lượt chơi **tạo từ ngày này** (tính theo **giờ Việt Nam**, từ 00:00). |
| `to` | `YYYY-MM-DD` | — | Chỉ lấy lượt chơi **tạo đến hết ngày này** (giờ Việt Nam, gồm cả ngày `to`). |
| `status` | chuỗi | — | Lọc theo trạng thái. Truyền nhiều giá trị cách nhau dấu phẩy, ví dụ `PENDING_CLAIM,EXPIRED`. Xem bảng trạng thái ở mục 6. |
| `tier` | chuỗi | — | Lọc theo kết quả: `t1`, `t2`, `t3`, `t4`, `t5` hoặc `miss`. |
| `deviceId` | chuỗi | — | Lọc theo máy, ví dụ `Screen 1` (nhớ mã hóa URL: `Screen%201`). |
| `includeTest` | `1` | không gồm test | Truyền `1` để gồm cả lượt chơi test. |
| `limit` | số | `1000` | Số dòng tối đa mỗi lần gọi (từ 1 đến 20000). |
| `offset` | số | `0` | Bỏ qua bao nhiêu dòng đầu — dùng để phân trang. |

Lưu ý: khác với file Excel (luôn gồm cả test), API này **mặc định loại bỏ test**. Muốn giống Excel, truyền `includeTest=1`.

Ngày sai định dạng → `400 {"error":"BAD_DATE","message":"from/to must be YYYY-MM-DD"}`.

## 4. Ví dụ gọi

```bash
# Tất cả lượt chơi thật (tối đa 1000 dòng)
curl -H "x-admin-key: aepick-admin" "http://localhost:8788/api/admin/export/all"

# Những người đã trúng nhưng chưa nhận quà, ngày 13/10/2026 (giờ VN)
curl -H "x-admin-key: aepick-admin" \
  "http://localhost:8788/api/admin/export/all?from=2026-10-13&to=2026-10-13&status=PENDING_CLAIM,EXPIRED"

# Người trúng giải nhất, kể cả test
curl -H "x-admin-key: aepick-admin" "http://localhost:8788/api/admin/export/all?tier=t1&includeTest=1"

# Trang 2 (dòng 101–200)
curl -H "x-admin-key: aepick-admin" "http://localhost:8788/api/admin/export/all?limit=100&offset=100"
```

## 5. Response (200 OK)

Ví dụ rút gọn (dữ liệu thật từ DB local, 2 dòng):

```json
{
  "total": 28,
  "limit": 2,
  "offset": 0,
  "items": [
    {
      "sessionId": "cfbe8430-ed2b-4ad8-832d-ac11b0b3ee8c",
      "deviceId": "Screen 1",
      "operatorId": "operator",
      "isTest": false,
      "status": "EXPIRED",
      "ruleVersion": 2,
      "createdAt": "2026-10-06T10:19:40.533Z",
      "playedAt": "2026-10-06T10:19:51.138Z",
      "closedAt": null,
      "expiresAt": "2026-10-06T13:00:00.000Z",
      "resultTier": "t2",
      "win": true,
      "prizeName": { "vi": "Quà Giải Nhì", "en": "2nd Prize", "ko": "2등 경품" },
      "claimCode": "AXSYMG",
      "claimedAt": null,
      "claimedBy": null,
      "voidReason": null,
      "aimDurationMs": 4237,
      "catchX": 0.5,
      "autoCatch": false,
      "minFps": 59.9,
      "fpsBucket": "55+"
    },
    {
      "sessionId": "a4e028fe-18ea-44e1-b022-02faded9bce1",
      "deviceId": "Screen 2",
      "operatorId": "operator",
      "isTest": false,
      "status": "CLAIMED",
      "ruleVersion": 3,
      "createdAt": "2026-10-07T01:16:16.434Z",
      "playedAt": "2026-10-07T01:16:25.168Z",
      "closedAt": "2026-10-07T01:16:25.168Z",
      "expiresAt": null,
      "resultTier": "miss",
      "win": false,
      "prizeName": null,
      "claimCode": null,
      "claimedAt": null,
      "claimedBy": null,
      "voidReason": null,
      "aimDurationMs": 2352,
      "catchX": 0.9949,
      "autoCatch": false,
      "minFps": 59.9,
      "fpsBucket": "55+"
    }
  ]
}
```

(Trong dữ liệu thật của DB local, `deviceId` còn là chuỗi ngẫu nhiên kiểu `kiosk-59510pft`; ở ví dụ trên tôi
đổi thành `Screen 1`/`Screen 2` để minh họa kết quả của tham số `?m=` trên kiosk.)

### 5.1. Phần bao ngoài

| Field | Kiểu | Giải thích |
|---|---|---|
| `total` | số | Tổng số dòng khớp bộ lọc (không bị `limit` cắt). Dùng để biết còn bao nhiêu trang. |
| `limit` | số | Giá trị `limit` thực tế đã áp dụng. |
| `offset` | số | Giá trị `offset` thực tế đã áp dụng. |
| `items` | mảng | Danh sách lượt chơi, **mới nhất trước** (sắp theo `createdAt` giảm dần). |

### 5.2. Từng phần tử trong `items`

Các giờ đều là **UTC dạng ISO 8601** (kết thúc bằng `Z`). Giờ Việt Nam = UTC + 7 giờ.

| Field | Kiểu | Giải thích |
|---|---|---|
| `sessionId` | chuỗi | Mã duy nhất của lượt chơi. |
| `deviceId` | chuỗi | Máy kiosk đã chơi. Là `Screen 1`, `Screen 2`… nếu máy được mở bằng `?m=1`, `?m=2`; nếu không là chuỗi ngẫu nhiên `kiosk-xxxxxxxx`. |
| `operatorId` | chuỗi | Người/nguồn duyệt lượt chơi. Kiosk hiện luôn gửi `operator`. |
| `isTest` | boolean | `true` nếu là lượt chơi test (không trừ kho). |
| `status` | chuỗi | Trạng thái hiện tại của lượt chơi, xem bảng mục 6. |
| `ruleVersion` | số | Phiên bản cấu hình xác suất đang áp dụng lúc rút thăm. |
| `createdAt` | chuỗi (giờ) | Lúc nhân viên bấm bắt đầu và hệ thống rút thăm. |
| `playedAt` | chuỗi (giờ) hoặc `null` | Lúc khách chơi xong. `null` nếu chưa chơi xong. |
| `closedAt` | chuỗi (giờ) hoặc `null` | Lúc lượt chơi đóng hẳn (đã trao quà, bị vô hiệu, hoặc thua). `null` nếu còn chờ trao quà. |
| `expiresAt` | chuỗi (giờ) hoặc `null` | Hạn nhận quà (24 giờ sau khi chơi hoặc giờ đóng sự kiện, lấy mốc sớm hơn). Chỉ có với người trúng. |
| `resultTier` | chuỗi hoặc `null` | Kết quả rút thăm: `t1`…`t5` (giải 1–5) hoặc `miss` (không trúng). |
| `win` | boolean | `true` nếu trúng giải (`resultTier` khác `miss`). |
| `prizeName` | object hoặc `null` | Tên quà theo 3 ngôn ngữ `{vi, en, ko}`. `null` nếu không trúng. |
| `claimCode` | chuỗi hoặc `null` | Mã nhận quà 6 ký tự. `null` nếu không trúng. |
| `claimedAt` | chuỗi (giờ) hoặc `null` | Lúc nhân viên bấm "đã trao". `null` nếu chưa trao. |
| `claimedBy` | chuỗi hoặc `null` | Người xử lý việc trao quà. |
| `voidReason` | chuỗi hoặc `null` | Lý do vô hiệu hóa (chỉ có khi `status = VOIDED`). |
| `aimDurationMs` | số hoặc `null` | Thời gian khách ngắm trước khi thả càng, tính bằng mili giây. `null` nếu chưa chơi. |
| `catchX` | số hoặc `null` | Vị trí ngang của càng lúc thả, từ `0` (sát trái) đến `1` (sát phải). |
| `autoCatch` | boolean hoặc `null` | `true` nếu khách **không bấm** CATCH và hết giờ nên máy tự gắp. |
| `minFps` | số hoặc `null` | FPS thấp nhất đo được lúc chơi (chỉ số hiệu năng). |
| `fpsBucket` | chuỗi hoặc `null` | Nhóm FPS: `55+`, `45-55`, `30-45` hoặc `<30`. |

## 6. Các giá trị của `status`

| Giá trị | Ý nghĩa |
|---|---|
| `CREATED` / `DRAWN` | Đã rút thăm, khách chưa chơi xong (đang chơi hoặc bị bỏ dở). |
| `PLAYED` | Đã chơi xong, hệ thống đang chuyển tiếp trạng thái (thường rất ngắn). |
| `PENDING_CLAIM` | Người trúng, **chưa nhận quà**. |
| `CLAIMED` | Đã xong. Với người trúng: **đã trao quà** (`claimedAt` có giá trị). Với người **không trúng** (`miss`): hệ thống tự đóng lượt chơi nên cũng là `CLAIMED` nhưng `claimedAt` là `null`. |
| `EXPIRED` | Quá hạn nhận quà (vẫn có thể trao nếu nhân viên xử lý). |
| `VOIDED` | Nhân viên đã vô hiệu hóa (kho được trả lại). |
| `ABORTED` | Bị hệ thống tự hủy vì bỏ dở quá 30 phút (kho được trả lại). |

Muốn lọc **đã trao quà thật**: `win == true` và `claimedAt != null`.

## 7. Lỗi

| Mã HTTP | Body | Khi nào |
|---|---|---|
| 400 | `{"error":"BAD_DATE","message":"from/to must be YYYY-MM-DD"}` | `from` hoặc `to` sai định dạng. |
| 401 | `{"error":"UNAUTHORIZED","message":"관리자 인증이 필요합니다."}` | Thiếu hoặc sai `x-admin-key`. |

## 8. Ghi chú

- `limit` tối đa 20000. Dữ liệu nhiều hơn thì dùng `offset` để lấy từng trang.
- Thứ tự dòng cố định (mới nhất trước), nhưng nếu có lượt chơi mới được tạo giữa các lần gọi thì trang sau có thể lệch dòng. Cần số liệu chính xác thì lọc theo `from`/`to` của một ngày đã kết thúc.
- Tên cột trong file Excel là `snake_case` (`session_id`, `claim_code`…), còn API này dùng `camelCase`
  (`sessionId`, `claimCode`…). Cột Excel `aim_duration_ms`, `auto_catch`, `min_fps` tương ứng `aimDurationMs`, `autoCatch`, `minFps`.
