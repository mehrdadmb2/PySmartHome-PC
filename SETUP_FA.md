# راهنمای نصب و اصلاح نسخه 4.1.2

## رفع خطای MarketState
در هر دو پوشه Firmware فایل `MarketState.h` اضافه شده است. فایل `.ino` همان پوشه را Include می‌کند. هنگام کپی دستی، فایل Header را کنار فایل `.ino` نگه دار؛ فقط کپی‌کردن فایل `.ino` کافی نیست.

## اصلاح مسیرهای واقعی قیمت و Timeout در Python

فایل کم‌حجم آماده در مخزن PySmartHome-PC موجود است:

- فایل مستقیم JSON: `https://raw.githubusercontent.com/mehrdadmb2/PySmartHome-PC/main/market/esp32.json`
- API رسمی GitHub (مسیر اصلی جدید): `https://api.github.com/repos/mehrdadmb2/PySmartHome-PC/contents/market/esp32.json?ref=main`
- فایل منبع ArzPulse: `https://raw.githubusercontent.com/mehrdadmb2/ArzPulse/main/docs/data/latest.json`
- مسیر Pages مخزن ArzPulse: `https://mehrdadmb2.github.io/ArzPulse/data/latest.json`

لینک `https://github.com/mehrdadmb2/PySmartHome-PC/tree/main/market` فقط صفحه HTML پوشه است و فایل JSON نیست. برنامه به‌جای آن، مستقیماً `market/esp32.json` را می‌خواند. اگر فایل کوچک PySmartHome در دسترس نباشد، فقط کامپیوتر می‌تواند به‌عنوان مسیر اضطراری دو نرخ را از ArzPulse استخراج کند؛ بردها هیچ‌وقت فایل ۴۴ کیلوبایتی ArzPulse را دانلود نمی‌کنند.

فایل محلی `config.txt` و `.env` را خارج از Git نگه دار؛ بستهٔ جدید `config.txt` شخصی را توزیع نمی‌کند. اگر این فایل را از قبل داری، هنگام استخراج نسخهٔ جدید آن را حفظ کن و مقدار Token معتبر را فقط در تنظیمات محلی نگه دار.

در شروع برنامه، `market/esp32.json` همراه پروژه به‌عنوان Cache اولیه بارگذاری می‌شود؛ بنابراین حتی پیش از موفقیت اولین درخواست اینترنتی، آخرین Snapshot موجود قابل ارائه است. سپس API رسمی GitHub، Raw GitHub، jsDelivr و مسیر ArzPulse به‌ترتیب امتحان می‌شوند. آخرین Snapshot معتبر در `data/market_snapshot_cache.json` نیز پایدار ذخیره می‌شود.

## ترتیب GitHub Actions
1. `Project CI and firmware verification`: ابتدا تست‌های Python و بررسی JavaScript را اجرا می‌کند.
2. فقط پس از موفقیت مرحله اول، هر دو Firmware را کامپایل می‌کند.
3. پس از موفقیت کامل CI روی شاخه main، رویداد `workflow_run`، Market Snapshot را اجرا می‌کند.
4. Market Snapshot علاوه بر این، طبق زمان‌بندی هر پنج دقیقه اجرا می‌شود و از اجرای هم‌زمان جلوگیری می‌کند.

اگر CI یا کامپایل Firmware شکست بخورد، اجرای زنجیره‌ای Market پس از آن اجرا نمی‌شود؛ اجرای زمان‌بندی مستقل بازار همچنان طبق برنامه فعال است.

## تنظیمات شبکه و قیمت

در نسخه 4.1.2، دسترسی LAN برای بردها به‌صورت پیش‌فرض فعال است. کد حتی اگر فایل `.env` قدیمی هنوز `PYSMART_HOME_HOST=127.0.0.1` داشته باشد، آن را در حالت LAN به `0.0.0.0` تبدیل می‌کند. برای اجرای کاملاً محلی، مقدار `PYSMART_HOME_LAN_ACCESS=0` را قرار بده.

```ini
PYSMART_HOME_LAN_ACCESS=1
PYSMART_HOME_HOST=0.0.0.0
PYSMART_HOME_PORT=5000
PYSMART_MARKET_SOURCE_URL=https://api.github.com/repos/mehrdadmb2/PySmartHome-PC/contents/market/esp32.json?ref=main
PYSMART_MARKET_REFRESH_SECONDS=300
PYSMART_MARKET_HTTP_TIMEOUT=5
PYSMART_MARKET_CONNECT_TIMEOUT=2
PYSMART_MARKET_MAX_AGE_SECONDS=900
```

در Firmware هر دو برد، مقدار `MARKET_SNAPSHOT_URL` باید IP واقعی کامپیوتر را داشته باشد؛ نمونه:

```cpp
static const char* MARKET_SNAPSHOT_URL =
    "http://192.168.1.100:5000/api/market";
```

به‌جای `192.168.1.100`، IPv4 کامپیوتر را از `ipconfig` بردار. آدرس `127.0.0.1` را در Firmware وارد نکن؛ این آدرس خود برد را هدف می‌گیرد، نه کامپیوتر.

## فایروال ویندوز

PowerShell را با دسترسی Administrator باز کن و فقط برای شبکه Private این قانون را اضافه کن:

```powershell
New-NetFirewallRule -DisplayName "PySmartHome-PC LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 -Profile Private -RemoteAddress LocalSubnet
```

پورت 5000 را روی اینترنت عمومی Port Forward نکن. پس از تغییر `.env`، برنامه Python را کامل ببند و دوباره اجرا کن.

## تست پس از اجرا
- `http://127.0.0.1:5000/api/health` وضعیت Proxy و Cache را نشان می‌دهد.
- `http://127.0.0.1:5000/api/market` باید JSON کم‌حجم قیمت‌ها را برگرداند.
- همان مسیر را با IP LAN کامپیوتر نیز باز کن؛ مثلاً `http://192.168.1.100:5000/api/market`. اگر از IP LAN باز نشد، مقدار HOST یا Windows Firewall هنوز درست نیست.
- در `http://127.0.0.1:5000/api/diagnostics` خطای آخر، عمر Cache و وضعیت سرویس را بررسی کن.

**نکته:** برای هر برد، فایل `.ino` و `MarketState.h` را با هم در Arduino IDE نگه دار.
