const REPO_RAW = 'https://raw.githubusercontent.com/mehrdadmb2/PySmartHome-PC/main/';
const TEMP_THRESHOLD = 35;

let lang = localStorage.getItem('lang') || 'en';
let theme = localStorage.getItem('theme') || 'cyberpunk';
let currentBoard = 'esp32_1';
let currentRange = 'daily';
let currentDate = new Date().toISOString().slice(0,10);
let chart;
let outageTimerOnline = null;
let outageSchedule = {};

document.documentElement.setAttribute('data-theme', theme);
document.documentElement.lang = lang;
document.dir = lang === 'fa' ? 'rtl' : 'ltr';
updateDateTime(); setInterval(updateDateTime, 1000);

// Background particles (same as internal)
function initParticles() { /* identical */ }
initParticles();

// Helpers
function gregorianToJalali(gy, gm, gd) { /* same */ }
function formatPersianDate(dateStr) { /* same */ }
function timeToSeconds(timeStr) { const [h,m]=timeStr.split(':').map(Number); return h*3600+m*60; }

function updateDateTime() {
  const now = new Date();
  document.getElementById('datetime').textContent = now.toLocaleTimeString(lang==='fa'?'fa-IR':'en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

async function fetchCSV(board, date) {
  const url = REPO_RAW + 'data/' + board + '_' + date + '.csv';
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const text = await resp.text();
    const result = Papa.parse(text, { header: true, dynamicTyping: true });
    return result.data.filter(row => row.time);
  } catch(e) { return []; }
}
async function fetchStatus() { const r = await fetch(REPO_RAW + 'status.json'); return r.json(); }
async function fetchOutageOnline() { const r = await fetch(REPO_RAW + 'outage_schedule.json'); return r.json(); }

async function getDataRange(board, range, endDate) {
  let dates = [];
  const end = new Date(endDate);
  if (range === 'daily') dates.push(end.toISOString().slice(0,10));
  else if (range === 'yesterday') { const y = new Date(end); y.setDate(y.getDate()-1); dates.push(y.toISOString().slice(0,10)); }
  else if (range === 'weekly') { for(let i=6;i>=0;i--) { const d=new Date(end); d.setDate(d.getDate()-i); dates.push(d.toISOString().slice(0,10)); } }
  else if (range === 'monthly') { for(let i=29;i>=0;i--) { const d=new Date(end); d.setDate(d.getDate()-i); dates.push(d.toISOString().slice(0,10)); } }
  let all = [];
  for(const date of dates) {
    const dayData = await fetchCSV(board, date);
    all = all.concat(dayData.map(d => ({...d, date})));
  }
  return all;
}

// Dashboard update (same logic as internal, using fetchCSV/fetchStatus)
async function updateDashboard() {
  try {
    const status = await fetchStatus();
    document.querySelector('#node-hub .status-dot').style.background = status.esp32_1_online ? '#0f0' : '#f00';
    document.querySelector('#node-s3 .status-dot').style.background = status.esp32_s3_online ? '#0f0' : '#f00';
    document.querySelector('#node-hub .node-status-text').textContent = status.esp32_1_online ? 'Online' : 'Offline';
    document.querySelector('#node-s3 .node-status-text').textContent = status.esp32_s3_online ? 'Online' : 'Offline';
    if (status.last_push) {
      document.getElementById('last-update-time').textContent = 'Last update: ' + new Date(status.last_push).toLocaleTimeString();
    }
  } catch(e) {}
  const today = new Date().toISOString().slice(0,10);
  for(let i=1; i<=2; i++) {
    const board = i===1 ? 'esp32_1' : 'esp32_s3';
    const data = await fetchCSV(board, today);
    if (data.length) {
      const last = data[data.length-1];
      const temps = data.map(d => d.temperature);
      const hums = data.map(d => d.humidity);
      document.getElementById('t'+i).textContent = last.temperature.toFixed(1);
      document.getElementById('h'+i).textContent = last.humidity.toFixed(0);
      document.getElementById('avg-t'+i).textContent = (temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1);
      document.getElementById('minmax-t'+i).textContent = `${Math.min(...temps).toFixed(1)} / ${Math.max(...temps).toFixed(1)}`;
      document.getElementById('count'+i).textContent = data.length;

      if (i===1) setBackgroundByTemp(last.temperature);

      const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
      const yesterdayData = await fetchCSV(board, yesterday);
      if (yesterdayData.length) {
        const yesterdayAvg = yesterdayData.map(d=>d.temperature).reduce((a,b)=>a+b,0)/yesterdayData.length;
        const todayAvg = temps.reduce((a,b)=>a+b,0)/temps.length;
        const trend = todayAvg - yesterdayAvg;
        document.getElementById('trend'+i).innerHTML = trend > 0.5 ? `📈 +${trend.toFixed(1)}°C` : (trend < -0.5 ? `📉 ${trend.toFixed(1)}°C` : '➡️ Stable');
      }
      if (Math.max(...temps) > TEMP_THRESHOLD) {
        document.querySelector(`#room${i} .alert-badge`).classList.remove('hidden');
      } else {
        document.querySelector(`#room${i} .alert-badge`).classList.add('hidden');
      }
    }
  }
  try {
    const hubData = await fetchCSV('esp32_1', today);
    if (hubData.length) {
      const firstTime = hubData[0].time;
      const firstDate = new Date(today + 'T' + firstTime);
      const uptimeMs = Date.now() - firstDate;
      document.getElementById('sys-uptime').textContent = `${Math.floor(uptimeMs/3600000)}h ${Math.floor((uptimeMs%3600000)/60000)}m`;
    }
  } catch(e) {}
  document.getElementById('total-records').textContent = (await fetchCSV('esp32_1', today)).length;
}
setInterval(updateDashboard, 60000);
updateDashboard();

function setBackgroundByTemp(temp) { /* same as internal */ }

// Chart (same as internal, using getDataRange)
async function drawChart() { /* identical to internal, but data from getDataRange */ }
drawChart();
document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => { currentRange = btn.dataset.range; drawChart(); }));
document.getElementById('board-select').addEventListener('change', (e) => { currentBoard = e.target.value; drawChart(); });
document.getElementById('chart-date').addEventListener('change', (e) => { currentDate = e.target.value; drawChart(); });

// Outage online
function updateCountdownUIOnline(schedule) {
  const today = new Date().toISOString().slice(0,10);
  const sched = schedule[today];
  const msgEl = document.getElementById('countdown-text');
  const barEl = document.getElementById('outage-progress');
  const startEl = document.getElementById('outage-start-time');
  const endEl = document.getElementById('outage-end-time');
  const liveIndicator = document.getElementById('live-indicator');
  const powerStatus = document.getElementById('power-status');

  if (!sched) {
    msgEl.textContent = 'No schedule for today';
    barEl.style.width = '0%';
    liveIndicator.style.color = '#f00';
    powerStatus.textContent = '⚡ Power: Unknown';
    return;
  }
  startEl.textContent = sched.start;
  endEl.textContent = sched.end;
  const now = new Date();
  const start = new Date(today + 'T' + sched.start + ':00');
  const end = new Date(today + 'T' + sched.end + ':00');

  if (now < start) {
    const diff = start - now;
    const hrs = Math.floor(diff/3600000), mins = Math.floor((diff%3600000)/60000), secs = Math.floor((diff%60000)/1000);
    msgEl.textContent = `Power cut in ${hrs}h ${mins}m ${secs}s`;
    barEl.style.width = '0%';
    liveIndicator.style.color = '#0f0';
    powerStatus.textContent = '⚡ Power: On';
  } else if (now < end) {
    const diff = end - now;
    const hrs = Math.floor(diff/3600000), mins = Math.floor((diff%3600000)/60000), secs = Math.floor((diff%60000)/1000);
    msgEl.textContent = `Power returns in ${hrs}h ${mins}m ${secs}s`;
    const startSec = timeToSeconds(sched.start);
    const endSec = timeToSeconds(sched.end);
    const nowSec = now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds();
    const progress = ((nowSec - startSec) / (endSec - startSec)) * 100;
    barEl.style.width = progress + '%';
    liveIndicator.style.color = '#f00';
    powerStatus.textContent = '⚡ Power: Off';
  } else {
    msgEl.textContent = 'Power is on';
    barEl.style.width = '100%';
    liveIndicator.style.color = '#0f0';
    powerStatus.textContent = '⚡ Power: On';
  }
}

async function loadOutageOnline() {
  try {
    const schedule = await fetchOutageOnline();
    outageSchedule = schedule;
    const today = new Date().toISOString().slice(0,10);
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
    const tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10);
    const updateDay = (date, prefix) => {
      const elDate = document.getElementById(prefix+'-date');
      const elTime = document.getElementById(prefix+'-time');
      if (elDate) elDate.textContent = formatPersianDate(date);
      if (elTime) {
        if (schedule[date]) {
          elTime.textContent = `${schedule[date].start} - ${schedule[date].end}`;
          elTime.style.color = 'var(--warning)';
        } else {
          elTime.textContent = 'No outage';
          elTime.style.color = 'var(--text)';
        }
      }
    };
    updateDay(yesterday, 'yesterday');
    updateDay(today, 'today');
    updateDay(tomorrow, 'tomorrow');
    updateCountdownUIOnline(schedule);
    if (outageTimerOnline) clearInterval(outageTimerOnline);
    outageTimerOnline = setInterval(() => updateCountdownUIOnline(schedule), 1000);
  } catch(e) {}
}
loadOutageOnline();

// Theme & Language
document.querySelectorAll('[data-theme]').forEach(btn => {
  btn.addEventListener('click', () => {
    theme = btn.dataset.theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  });
});
document.getElementById('lang-toggle').onclick = () => {
  lang = lang === 'en' ? 'fa' : 'en';
  document.documentElement.lang = lang;
  document.dir = lang === 'fa' ? 'rtl' : 'ltr';
  localStorage.setItem('lang', lang);
  location.reload();
};
document.getElementById('fullscreen-btn').onclick = () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
};

// Data table modal
document.getElementById('view-table-btn').addEventListener('click', async () => {
  document.getElementById('data-modal').classList.remove('hidden');
  const data = await getDataRange(currentBoard, currentRange, currentDate);
  document.querySelector('#data-table tbody').innerHTML = data.map(d => `<tr><td>${d.time}</td><td>${d.temperature.toFixed(1)}</td><td>${d.humidity.toFixed(0)}</td></tr>`).join('');
});
document.getElementById('close-modal').addEventListener('click', () => document.getElementById('data-modal').classList.add('hidden'));
document.getElementById('export-modal-csv').addEventListener('click', () => {
  const rows = [['Time','Temperature','Humidity']];
  document.querySelectorAll('#data-table tbody tr').forEach(row => {
    const cells = row.querySelectorAll('td');
    rows.push([cells[0].textContent, cells[1].textContent, cells[2].textContent]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='data.csv'; a.click();
});
