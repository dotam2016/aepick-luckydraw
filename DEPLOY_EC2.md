# Deploy AEPICK Lucky Draw lên EC2

Lucky Draw chạy trong một container riêng tại cổng host `8788`. Cấu hình này không thay đổi hai container Survey hiện có ở cổng `8787` và PostgreSQL nội bộ.

## 1. Đưa source lên EC2

Clone repository hoặc copy thư mục project vào EC2, sau đó vào thư mục project:

```bash
cd ~/aepick-luckydraw
```

Máy EC2 cần có Docker Engine và Docker Compose v2 (`docker compose version`).

## Cách nhanh nhất

```bash
cd ~/aepick-luckydraw
chmod +x deploy-ec2.sh
./deploy-ec2.sh
```

Script tự thực hiện các bước sau:

- Tạo `.env` với Admin Key và Operator PIN ngẫu nhiên ở lần chạy đầu.
- Build image ngay trên EC2.
- Chạy Lucky Draw ở cổng `8788` bằng Compose project riêng.
- Chờ API healthy và in trạng thái container.

Chạy lại cùng lệnh khi cập nhật source. File `.env` và volume SQLite hiện có được giữ nguyên.

## Các lệnh thủ công tương đương

```bash
cp .env.example .env
nano .env
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

Khi trạng thái là `healthy`:

- Kiosk: `http://EC2_PUBLIC_IP:8788/kiosk/`
- Admin: `http://EC2_PUBLIC_IP:8788/admin`
- Health check: `http://EC2_PUBLIC_IP:8788/api/health`

Kiểm tra ngay trên EC2:

```bash
curl --fail http://127.0.0.1:8788/api/health
docker ps
```

Kết quả mong đợi là Survey vẫn ở `0.0.0.0:8787->8787`, còn Lucky Draw ở `0.0.0.0:8788->8788`.

## 4. AWS Security Group

Để thử trực tiếp bằng IP, thêm inbound rule TCP `8788` và giới hạn Source vào IP của bạn nếu có thể. Khi chạy chính thức trên Internet, nên đặt HTTPS reverse proxy phía trước và chỉ cho reverse proxy truy cập cổng ứng dụng. Trang `/admin` dùng chung cổng với kiosk, vì vậy cần giữ kín Admin Key và giới hạn mạng truy cập trang quản trị.

Nếu dùng reverse proxy trên cùng EC2, đổi trong `.env`:

```dotenv
BIND_ADDRESS=127.0.0.1
```

Sau đó route domain tới `http://127.0.0.1:8788`.

## 5. Dữ liệu và cập nhật

SQLite được lưu bền trong Docker volume `aepick-luckydraw-data`. Lệnh rebuild hoặc recreate container không xóa dữ liệu này.

Cập nhật phiên bản mới:

```bash
git pull
docker compose up -d --build
docker compose ps
```

Xem log:

```bash
docker compose logs -f --tail=200 app
```

Dừng riêng Lucky Draw:

```bash
docker compose down
```

Lệnh trên giữ nguyên volume dữ liệu. Không thêm `--volumes` trừ khi chủ đích là xóa toàn bộ database Lucky Draw.
