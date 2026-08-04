const REPO_RAW = 'https://raw.githubusercontent.com/mehrdadmb2/PySmartHome-PC/main/';
const THRESHOLD_TEMP = 35; // آستانه هشدار دما
let currentTheme = localStorage.getItem('theme') || 'dark';
let lang = localStorage.getItem('lang') || 'fa';
let fontScale = 1;
let baseFontSize = 16;
let fullscreen = false;

// اعمال تم اولیه
document.documentElement.setAttribute('data-theme', currentTheme);
document.documentElement.style.fontSize = baseFontSize + 'px';

// ===================== تاریخ شمسی =====================
function gregorianToJalali(gy, gm, gd) {
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + Math.floor((153 * (gm > 2 ? (gm - 3) : (gm + 9)) + 2) / 5);
  let jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return { year: jy, month: jm, day: jd };
}
function updateDateTime() {
  const now = new Date();
  const j = gregorianToJalali(now.getFullYear(), now.getMonth()+1, now.getDate());
  document.getElementById('datetime').textContent = `📅 ${j.year}/${String(j.month).padStart(2,'0')}/${String(j.day).padStart(2,'0')} ${now.toLocaleTimeString('fa-IR')}`;
}
setInterval(updateDateTime, 1000);
updateDateTime();

// ===================== ابزارهای کمکی =====================
function parseTime(str) { return str.split(':').reduce((a,b) => a*60 + +b, 0); }
function formatPersianDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const j = gregorianToJalali(d.getFullYear(), d.getMonth()+1, d.getDate());
  return `${j.year}/${j.month}/${j.day}`;
}

// ===================== Fetch CSV & داده‌ها =====================
async function fetchCSV(board, date) {
  const url = REPO_RAW + 'data/' + board + '_' + date + '.csv';
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const text = await resp.text();
    const result = Papa.parse(text, { header: true, dynamicTyping: true });
    return result.data.filter(row => row.time);
  } catch (e) { return []; }
}

async function getDataRange(board, range, endDate) {
  let dates = [];
  const end = new Date(endDate);
  if (range === 'daily') dates.push(end.toISOString().slice(0,10));
  else if (range === 'hourly') dates.push(end.toISOString().slice(0,10));
  else if (range === 'yesterday') {
    const y = new Date(end); y.setDate(y.getDate()-1); dates.push(y.toISOString().slice(0,10));
  } else if (range === 'last_week') {
    for (let i=6; i>=0; i--) { const d = new Date(end); d.setDate(d.getDate()-i); dates.push(d.toISOString().slice(0,10)); }
  } else if (range === 'last_month') {
    for (let i=29; i>=0; i--) { const d = new Date(end); d.setDate(d.getDate()-i); dates.push(d.toISOString().slice(0,10)); }
  } else {
    const days = range === 'weekly' ? 7 : 30;
    for (let i=days-1; i>=0; i--) {
      const d = new Date(end); d.setDate(d.getDate()-i);
      dates.push(d.toISOString().slice(0,10));
    }
  }
  let all = [];
  for (const date of dates) {
    const dayData = await fetchCSV(board, date);
    all = all.concat(dayData.map(d => ({...d, date})));
  }
  if (range === 'hourly' && all.length) {
    const last = all[all.length-1];
    const cutoff = parseTime(last.time) - 3600;
    all = all.filter(d => parseTime(d.time) >= cutoff);
  }
  return all;
}

// Downsample data to maxPoints by averaging
function downsample(data, maxPoints = 200) {
  if (data.length <= maxPoints) return data;
  const factor = Math.ceil(data.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < data.length; i += factor) {
    const chunk = data.slice(i, i + factor);
    const avgTemp = chunk.reduce((s,x)=>s+x.temperature,0)/chunk.length;
    const avgHum = chunk.reduce((s,x)=>s+x.humidity,0)/chunk.length;
    sampled.push({ time: chunk[0].time, temperature: avgTemp, humidity: avgHum });
  }
  return sampled;
}

// ===================== مقادیر زنده و آمار =====================
let lastPushTime = null;
async function updateStatusAndLive() {
  try {
    const statusResp = await fetch(REPO_RAW + 'status.json');
    const status = await statusResp.json();
    const now = Date.now();
    
    // نودها
    const updateNode = (dotId, online, lastSeenId) => {
      const dot = document.getElementById(dotId);
      if (dot) {
        dot.style.background = online ? '#0f0' : '#f00';
        dot.style.boxShadow = online ? '0 0 10px #0f0' : '0 0 5px #f00';
      }
      if (lastSeenId) {
        const el = document.getElementById(lastSeenId);
        if (el && status[dotId==='status-hub'?'esp32_1_online':'esp32_s3_online']!==undefined) {
          // Extracting last seen not directly available, just show online status
          el.textContent = online ? 'آنلاین' : 'آفلاین';
        }
      }
    };
    updateNode('status-hub', status.esp32_1_online, 'hub-last-seen');
    updateNode('status-s3', status.esp32_s3_online, 's3-last-seen');

    // زمان آخرین push
    if (status.last_push) {
      lastPushTime = new Date(status.last_push);
      const minutesAgo = Math.floor((now - lastPushTime) / 60000);
      document.getElementById('last-update-time').textContent = `آخرین به‌روزرسانی: ${minutesAgo} دقیقه پیش`;
      
      // شمارش معکوس تا push بعدی
      const nextPush = new Date(lastPushTime.getTime() + 5 * 60000);
      const secLeft = Math.max(0, Math.floor((nextPush - now) / 1000));
      const minLeft = Math.floor(secLeft / 60);
      const secRem = secLeft % 60;
      document.getElementById('next-push-countdown').textContent = `⏳ آپلود بعدی: ${minLeft}:${String(secRem).padStart(2,'0')}`;
      
      // هشدار تأخیر
      const alertBanner = document.getElementById('global-alert');
      if (minutesAgo > 15) {
        alertBanner.textContent = '⚠️ هشدار: بیش از ۱۵ دقیقه از آخرین به‌روزرسانی گذشته است!';
        alertBanner.classList.remove('hidden');
      } else {
        alertBanner.classList.add('hidden');
      }
    }
  } catch(e) {}

  // داده‌های امروز
  const today = new Date().toISOString().slice(0,10);
  for (let i=1; i<=2; i++) {
    const board = i===1 ? 'esp32_1' : 'esp32_s3';
    const data = await fetchCSV(board, today);
    if (data.length) {
      const last = data[data.length-1];
      const temps = data.map(d => d.temperature);
      const hums = data.map(d => d.humidity);
      const avgT = temps.reduce((a,b)=>a+b,0)/temps.length;
      const avgH = hums.reduce((a,b)=>a+b,0)/hums.length;
      const minT = Math.min(...temps);
      const maxT = Math.max(...temps);
      const minH = Math.min(...hums);
      const maxH = Math.max(...hums);

      document.getElementById('t'+i).textContent = last.temperature.toFixed(1);
      document.getElementById('h'+i).textContent = last.humidity.toFixed(0);
      document.getElementById('avg-t'+i).textContent = avgT.toFixed(1);
      document.getElementById('avg-h'+i).textContent = avgH.toFixed(0);
      document.getElementById('minmax-t'+i).textContent = `${minT.toFixed(1)} / ${maxT.toFixed(1)}`;
      document.getElementById('minmax-h'+i).textContent = `${minH.toFixed(0)} / ${maxH.toFixed(0)}`;
      document.getElementById('count'+i).textContent = data.length;

      // روند نسبت به دیروز
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
      const yesterdayData = await fetchCSV(board, yesterday);
      if (yesterdayData.length) {
        const yesterdayAvg = yesterdayData.map(d=>d.temperature).reduce((a,b)=>a+b,0)/yesterdayData.length;
        const trend = avgT - yesterdayAvg;
        const trendEl = document.getElementById('trend'+i);
        trendEl.innerHTML = trend > 0.5 ? `📈 +${trend.toFixed(1)}°C` : (trend < -0.5 ? `📉 ${trend.toFixed(1)}°C` : '➡️ ثابت');
      }

      // هشدار دما
      const alertEl = document.getElementById('alert-room'+i);
      if (maxT > THRESHOLD_TEMP) {
        alertEl.classList.remove('hidden');
      } else {
        alertEl.classList.add('hidden');
      }
    }
  }
}
setInterval(updateStatusAndLive, 60000);
updateStatusAndLive();

// ===================== نمودارها =====================
const charts = {};
const chartRangeStore = {};
const MAX_CHART_POINTS = 200;

async function drawChart(board, canvasId, range, refDate) {
  const spinner = document.getElementById('spinner-' + canvasId);
  spinner.classList.remove('hidden');
  try {
    const data = await getDataRange(board, range, refDate || new Date().toISOString().slice(0,10));
    const sampled = downsample(data, MAX_CHART_POINTS);
    const labels = sampled.map(d => d.time);
    const temps = sampled.map(d => d.temperature);
    const hums = sampled.map(d => d.humidity);
    const avgTemp = temps.length ? temps.reduce((a,b)=>a+b,0)/temps.length : 0;

    if (charts[canvasId]) charts[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');
    charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'دما (°C)', data: temps, borderColor: '#ff6ec7', backgroundColor: 'rgba(255,110,199,0.2)', yAxisID: 'y',
            pointRadius: sampled.length > 100 ? 0 : 2 },
          { label: 'رطوبت (%)', data: hums, borderColor: '#0ff', backgroundColor: 'rgba(0,255,255,0.2)', yAxisID: 'y1',
            pointRadius: sampled.length > 100 ? 0 : 2 },
          { label: 'میانگین دما', data: Array(labels.length).fill(avgTemp), borderColor: '#fff', borderDash: [5,5],
            pointRadius: 0, yAxisID: 'y' }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => {
                if (items.length) {
                  const idx = items[0].dataIndex;
                  const time = sampled[idx].time;
                  const date = sampled[idx].date;
                  return `${formatPersianDate(date)} ${time}`;
                }
                return '';
              }
            }
          }
        },
        scales: {
          y: { type:'linear', position:'left', title:{display:true, text:'دما'} },
          y1: { type:'linear', position:'right', title:{display:true, text:'رطوبت'}, grid:{drawOnChartArea:false} }
        }
      }
    });

    // ذخیره بازه
    chartRangeStore[board] = range;
    localStorage.setItem('chartRange_'+board, range);
  } catch(e) { console.error(e); }
  spinner.classList.add('hidden');
}

// بازگردانی تنظیمات نمودار
function restoreChartSettings() {
  document.querySelectorAll('.range-select').forEach(sel => {
    const board = sel.dataset.board;
    const savedRange = localStorage.getItem('chartRange_'+board);
    if (savedRange) sel.value = savedRange;
  });
}
restoreChartSettings();

// رویدادها
document.querySelectorAll('.range-select, .date-picker').forEach(el => {
  el.addEventListener('change', () => {
    const board = el.dataset.board;
    const range = document.querySelector(`.range-select[data-board="${board}"]`).value;
    const date = document.querySelector(`.date-picker[data-board="${board}"]`).value || new Date().toISOString().slice(0,10);
    drawChart(board, board==='esp32_1'?'chart1':'chart2', range, date);
  });
});
// رسم اولیه
document.querySelectorAll('.range-select').forEach(sel => {
  const board = sel.dataset.board;
  const range = sel.value;
  drawChart(board, board==='esp32_1'?'chart1':'chart2', range, new Date().toISOString().slice(0,10));
});

// ===================== تم و زبان و سایر کنترلها =====================
document.getElementById('theme-toggle').onclick = () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('theme', currentTheme);
};
document.getElementById('retro-toggle').onclick = () => {
  currentTheme = 'retro';
  document.documentElement.setAttribute('data-theme', 'retro');
  localStorage.setItem('theme', 'retro');
};
document.getElementById('lang-toggle').onclick = () => {
  lang = lang === 'fa' ? 'en' : 'fa';
  document.documentElement.lang = lang;
  document.dir = lang === 'fa' ? 'rtl' : 'ltr';
  localStorage.setItem('lang', lang);
};
document.getElementById('fullscreen-btn').onclick = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
};
document.getElementById('font-size-up').onclick = () => {
  fontScale = Math.min(2, fontScale + 0.1);
  document.documentElement.style.fontSize = (baseFontSize * fontScale) + 'px';
};
document.getElementById('font-size-down').onclick = () => {
  fontScale = Math.max(0.7, fontScale - 0.1);
  document.documentElement.style.fontSize = (baseFontSize * fontScale) + 'px';
};
