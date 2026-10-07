│ Set ADMIN_KEY và OPERATOR_PIN qua env - Hiện đang fallback về default 'aepick-admin' / '1234' (routes.ts:27-28) — để mặc định là lỗ hổng bảo mật khi public
│ DASHBOARD_KEY (mật khẩu /admin/dashboard) không dùng env — cố định trong code bằng bcrypt hash (DASHBOARD_PASSWORD_HASH, routes.ts) vì project chỉ dùng trong vài ngày sự kiện rồi bỏ.

