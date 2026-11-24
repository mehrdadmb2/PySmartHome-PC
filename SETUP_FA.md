# راهنمای اصلاح نسخه 4.1.1

## رفع خطای MarketState
در هر دو پوشه Firmware فایل `MarketState.h` اضافه شده است. فایل `.ino` همان پوشه را Include می‌کند. هنگام کپی دستی، فایل Header را کنار فایل `.ino` نگه دار؛ فقط کپی‌کردن فایل `.ino` کافی نیست.

## اصلاح خطای Timeout در Python
خطای `Read timed out` به معنی دیر پاسخ‌دادن منبع بازار است. نسخه جدید دو منبع (Raw GitHub و GitHub Pages) را با سه تلاش محدود برای هر منبع امتحان می‌کند. آخرین Snapshot معتبر در `data/market_snapshot_cache.json` ذخیره می‌شود و بعد از Restart هم بازیابی می‌شود. در زمان قدیمی‌شدن داده، API پرچم‌های `usd_stale` و `gold_stale` را فعال می‌کند.

## ترتیب GitHub Actions
1. `Project CI and firmware verification`: ابتدا تست‌های Python و بررسی JavaScript را اجرا می‌کند.
2. فقط پس از موفقیت مرحله اول، هر دو Firmware را کامپایل می‌کند.
3. پس از موفقیت کامل CI روی شاخه main، رویداد `workflow_run`، Market Snapshot را اجرا می‌کند.
4. Market Snapshot علاوه بر این، طبق زمان‌بندی هر پنج دقیقه اجرا می‌شود و از اجرای هم‌زمان جلوگیری می‌کند.

اگر CI یا کامپایل Firmware شکست بخورد، اجرای زنجیره‌ای Market پس از آن اجرا نمی‌شود؛ اجرای زمان‌بندی مستقل بازار همچنان طبق برنامه فعال است.

## تنظیمات ضروری شبکه و قیمت در `.env`

اگر در لاگ برنامه `Server: http://127.0.0.1:5000` دیده می‌شود، سرور فقط روی خود کامپیوتر گوش می‌دهد و ESP32 به آن دسترسی ندارد. برای دسترسی بردها، فایل `.env` را کنار `server.py` بساز/ویرایش کن و IP کامپیوتر را در Firmware تنظیم کن.

```ini
PYSMART_HOME_HOST=0.0.0.0
PYSMART_HOME_PORT=5000
PYSMART_MARKET_HTTP_TIMEOUT=8
PYSMART_MARKET_CONNECT_TIMEOUT=4
PYSMART_MARKET_MAX_AGE_SECONDS=900
PYSMART_MARKET_FALLBACK_URLS=https://mehrdadmb2.github.io/PySmartHome-PC/market/esp32.json
```

## فایروال ویندوز

PowerShell را با دسترسی Administrator باز کن و فقط برای شبکه Private این قانون را اضافه کن:

```powershell
New-NetFirewallRule -DisplayName "PySmartHome-PC LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 -Profile Private
```

پورت 5000 را روی اینترنت عمومی Port Forward نکن. پس از تغییر `.env`، برنامه Python را کامل ببند و دوباره اجرا کن.

## تست پس از اجرا
- `http://127.0.0.1:5000/api/health` وضعیت Proxy و Cache را نشان می‌دهد.
- `http://127.0.0.1:5000/api/market` باید JSON کم‌حجم قیمت‌ها را برگرداند.
- همان مسیر را با IP LAN کامپیوتر نیز باز کن؛ مثلاً `http://192.168.1.100:5000/api/market`. اگر از IP LAN باز نشد، مقدار HOST یا Windows Firewall هنوز درست نیست.
- در `http://127.0.0.1:5000/api/diagnostics` خطای آخر، عمر Cache و وضعیت سرویس را بررسی کن.

**نکته:** برای هر برد، فایل `.ino` و `MarketState.h` را با هم در Arduino IDE نگه دار.
