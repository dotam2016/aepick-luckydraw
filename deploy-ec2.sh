#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker chưa được cài trên EC2." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 chưa được cài (cần lệnh: docker compose)." >&2
  exit 1
fi

created_env=0
if [[ ! -f .env ]]; then
  if command -v openssl >/dev/null 2>&1; then
    admin_key="$(openssl rand -hex 32)"
  else
    admin_key="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi

  random_number="$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')"
  operator_pin="$((random_number % 900000 + 100000))"

  cat > .env <<EOF
LUCKYDRAW_PORT=8788
BIND_ADDRESS=0.0.0.0
ADMIN_KEY=${admin_key}
OPERATOR_PIN=${operator_pin}
LOG_LEVEL=info
EOF
  chmod 600 .env
  created_env=1
  echo "Đã tạo .env với secret ngẫu nhiên (permission 600)."
fi

echo "Kiểm tra cấu hình..."
docker compose config --quiet

echo "Build image trên EC2..."
docker compose build --pull

echo "Khởi động Lucky Draw..."
docker compose up -d

echo "Chờ health check..."
healthy=0
for _ in $(seq 1 30); do
  if docker compose exec -T app node -e \
    "fetch('http://127.0.0.1:8788/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "$healthy" -ne 1 ]]; then
  echo "ERROR: ứng dụng chưa healthy sau 60 giây." >&2
  docker compose ps
  docker compose logs --tail=100 app
  exit 1
fi

docker compose ps
echo
echo "Deploy thành công."
echo "Kiosk : http://EC2_PUBLIC_IP:8788/kiosk/"
echo "Admin : http://EC2_PUBLIC_IP:8788/admin"
echo "Survey hiện tại vẫn dùng cổng 8787."

if [[ "$created_env" -eq 1 ]]; then
  echo
  echo "OPERATOR_PIN=${operator_pin}"
  echo "ADMIN_KEY=${admin_key}"
  echo "Hãy lưu hai giá trị này ở nơi an toàn."
fi
