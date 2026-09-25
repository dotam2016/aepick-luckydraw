# Thiết lập CI/CD cho AEPICK Lucky Draw

Project sử dụng GitHub Actions theo cùng mô hình với AEPICK Survey:

- `CI`: tự động chạy khi mở Pull Request hoặc push code liên quan lên `main`.
- `Deploy EC2`: chạy thủ công trên self-hosted runner đặt tại EC2.

## 1. CI

Workflow `.github/workflows/ci.yml` thực hiện:

```bash
npm ci
npm test
npm run build
```

Không cần cấu hình GitHub Secret cho CI.

## 2. Chuẩn bị source trên EC2

CD mặc định sử dụng thư mục sau:

```text
/home/ec2-user/aepick-luckydraw
```

Kiểm tra trên EC2:

```bash
cd ~/aepick-luckydraw
git remote -v
git checkout main
git pull --ff-only origin main
bash ./deploy-ec2.sh
```

Chỉ cấu hình CD sau khi lệnh deploy thủ công trên chạy thành công. File `.env` phải nằm trong thư mục project trên EC2; workflow không lưu hoặc ghi đè secret của ứng dụng.

## 3. Đăng ký self-hosted runner

Trong repository GitHub `aepick-luckydraw`:

1. Mở `Settings` → `Actions` → `Runners`.
2. Chọn `New self-hosted runner`.
3. Chọn Linux và kiến trúc của EC2, thông thường là `x64`.
4. Chạy các lệnh GitHub cung cấp trực tiếp trên EC2.

Nếu runner hiện tại của Survey được đăng ký ở cấp repository, không dùng chung thư mục runner đó. Tạo instance riêng, ví dụ:

```bash
mkdir -p ~/actions-runner-luckydraw
cd ~/actions-runner-luckydraw
```

Sau khi chạy lệnh `config.sh` do GitHub cung cấp, cài runner thành service theo phần hướng dẫn được GitHub hiển thị:

```bash
sudo ./svc.sh install ec2-user
sudo ./svc.sh start
sudo ./svc.sh status
```

Runner phải hiển thị trạng thái `Idle` trong trang `Settings` → `Actions` → `Runners` của repository Lucky Draw.

## 4. Chạy deployment

Sau khi workflow đã có trên nhánh `main`:

1. Mở tab `Actions` của repository.
2. Chọn workflow `Deploy EC2`.
3. Chọn `Run workflow`.
4. Chọn nhánh `main` và xác nhận chạy.

Workflow sẽ cập nhật source từ `main`, build image trên EC2, khởi động container và chờ health check.

Kiểm tra sau deployment:

```bash
docker compose -f ~/aepick-luckydraw/compose.yaml ps
curl --fail http://127.0.0.1:8788/api/health
docker ps
```

Kết quả mong đợi:

- Lucky Draw chạy tại cổng `8788` và có trạng thái `healthy`.
- Survey tiếp tục chạy tại cổng `8787`.
- Volume `aepick-luckydraw-data` tiếp tục giữ database SQLite qua các lần deploy.

## 5. Xử lý lỗi thường gặp

Nếu job chờ runner quá lâu, kiểm tra runner có trạng thái `Idle` và được đăng ký đúng repository Lucky Draw.

Nếu `git pull` thất bại, kiểm tra working tree trên EC2 bằng:

```bash
cd ~/aepick-luckydraw
git status
```

Nếu deployment không healthy, xem log:

```bash
cd ~/aepick-luckydraw
docker compose ps
docker compose logs --tail=200 app
```
