// آدرس خام مخزن گیت‌هاب
const REPO_RAW = 'https://raw.githubusercontent.com/mehrdadmb2/PySmartHome-PC/main/';

// ---------- تاریخ شمسی ----------
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
  const jstr = `${j.year}/${String(j.month).padStart(2,'0')}/${String(j.day).padStart(2,'0')} ${now.toLocaleTimeString('fa-IR')}`;
  document.getElementById('datetime').textContent = '📅 ' + jstr;
}
setInterval(updateDateTime, 1000);
updateDateTime();

// ---------- دریافت CSV و تبدیل به آرایه ----------
async function fetchCSV(board, date) {
  const url = REPO_RAW + 'data/' + board + '_' + date + '.csv';
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const text = await resp.text();
    const result = Papa.parse(text, { header: true, dynamicTyping: true });
    return result.data.filter(row => row.time);
  } catch (e) {
    return [];
  }
}

// ---------- بازه‌های مختلف ----------
async function getDataRange(board, range, endDate) {
  let dates = [];
  const end = new Date(endDate);
  if (range === 'daily') {
    dates.push(end.toISOString().slice(0,10));
  } else if (range === 'hourly') {
    dates.push(end.toISOString().slice(0,10));
  } else {
    const days = range === 'weekly' ? 7 : 30;
    for (let i = days-1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0,10));
    }
  }

  let allData = [];
  for (const date of dates) {
    const dayData = await fetchCSV(board, date);
    allData = allData.concat(dayData.map(d => ({...d, date})));
  }

  if (range === 'hourly' && allData.length > 0) {
    const last = allData[allData.length-1];
    const lastSec = last.time.split(':').reduce((a,b) => a*60 + +b, 0);
    const cutoff = lastSec - 3600;
    allData = allData.filter(d => d.time.split(':').reduce((a,b) => a*60 + +b, 0) >= cutoff);
  }
  return allData;
}

// ---------- مقادیر زنده از آخرین رکورد امروز ----------
async function updateLiveValues() {
  const today = new Date().toISOString().slice(0,10);
  const s1 = await fetchCSV('esp32_1', today);
  if (s1.length) {
    document.getElementById('t1').textContent = s1[s1.length-1].temperature.toFixed(1);
    document.getElementById('h1').textContent = s1[s1.length-1].humidity.toFixed(0);
    const avgT = s1.reduce((s,x)=>s+x.temperature,0)/s1.length;
    const avgH = s1.reduce((s,x)=>s+x.humidity,0)/s1.length;
    document.getElementById('avg-t1').textContent = avgT.toFixed(1);
    document.getElementById('avg-h1').textContent = avgH.toFixed(0);
  }
  const s2 = await fetchCSV('esp32_s3', today);
  if (s2.length) {
    document.getElementById('t2').textContent = s2[s2.length-1].temperature.toFixed(1);
    document.getElementById('h2').textContent = s2[s2.length-1].humidity.toFixed(0);
    const avgT = s2.reduce((s,x)=>s+x.temperature,0)/s2.length;
    const avgH = s2.reduce((s,x)=>s+x.humidity,0)/s2.length;
    document.getElementById('avg-t2').textContent = avgT.toFixed(1);
    document.getElementById('avg-h2').textContent = avgH.toFixed(0);
  }
}
setInterval(updateLiveValues, 60000);
updateLiveValues();

// ---------- وضعیت نودها ----------
async function updateNodeStatus() {
  try {
    const resp = await fetch(REPO_RAW + 'status.json');
    const d = await resp.json();
    const setDot = (id, online) => {
      const dot = document.getElementById(id);
      if (dot) {
        dot.style.background = online ? '#0f0' : '#f00';
        dot.style.boxShadow = online ? '0 0 10px #0f0' : '0 0 5px #f00';
      }
    };
    setDot('status-hub', d.esp32_1_online);
    setDot('status-s3', d.esp32_s3_online);
  } catch (e) {}
}
setInterval(updateNodeStatus, 30000);
updateNodeStatus();

// ---------- نمودارها ----------
const charts = {};
async function drawChart(board, canvasId, range, refDate) {
  const data = await getDataRange(board, range, refDate || new Date().toISOString().slice(0,10));
  const labels = data.map(d => d.time);
  const temps = data.map(d => d.temperature);
  const hums = data.map(d => d.humidity);

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'دما (°C)', data: temps, borderColor: '#ff6ec7', backgroundColor: 'rgba(255,110,199,0.2)', yAxisID: 'y' },
        { label: 'رطوبت (%)', data: hums, borderColor: '#0ff', backgroundColor: 'rgba(0,255,255,0.2)', yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: { type:'linear', position:'left', title:{display:true, text:'دما'} },
        y1: { type:'linear', position:'right', title:{display:true, text:'رطوبت'}, grid:{drawOnChartArea:false} }
      }
    }
  });
}

// رویدادها
document.querySelectorAll('.range-select, .date-picker').forEach(el => {
  el.addEventListener('change', () => {
    const board = el.dataset.board;
    const range = document.querySelector(`.range-select[data-board="${board}"]`).value;
    const date = document.querySelector(`.date-picker[data-board="${board}"]`).value || new Date().toISOString().slice(0,10);
    drawChart(board, board==='esp32_1'?'chart1':'chart2', range, date);
  });
  if (el.classList.contains('range-select')) {
    const board = el.dataset.board;
    const date = new Date().toISOString().slice(0,10);
    drawChart(board, board==='esp32_1'?'chart1':'chart2', el.value, date);
  }
});

// تم و زبان
let theme = localStorage.getItem('theme') || 'dark';
let lang = localStorage.getItem('lang') || 'fa';
document.documentElement.setAttribute('data-theme', theme);
document.documentElement.lang = lang;
document.dir = lang === 'fa' ? 'rtl' : 'ltr';

document.getElementById('theme-toggle').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
};
document.getElementById('lang-toggle').onclick = () => {
  lang = lang === 'fa' ? 'en' : 'fa';
  document.documentElement.lang = lang;
  document.dir = lang === 'fa' ? 'rtl' : 'ltr';
  localStorage.setItem('lang', lang);
};
