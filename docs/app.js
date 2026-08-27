const REPO_RAW = 'https://raw.githubusercontent.com/mehrdadmb2/PySmartHome-PC/main/';
const TEMP_THRESHOLD = 35;
const PARTICLE_COUNT = 60;

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

// Particles (همان)
function initParticles() { /* کد مشابه نسخه داخلی */ }
initParticles();

// Helpers (همان)
function gregorianToJalali(gy, gm, gd) { /* ... */ }
function formatPersianDate(dateStr) { /* ... */ }
function timeToSeconds(timeStr) { /* ... */ }
function formatTime(seconds) { /* ... */ }
function updateDateTime() { /* ... */ }

// ========== Fetch from GitHub ==========
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

// ========== Dashboard ==========
async function updateDashboard() {
  try {
    const status = await fetchStatus();
    document.querySelector('#node-hub .status-dot').style.background = status.esp32_1_online ? '#0f0' : '#f00';
    document.querySelector('#node-s3 .status-dot').style.background = status.esp32_s3_online ? '#0f0' : '#f00';
    document.querySelector('#node-hub .node-status-text').textContent = status.esp32_1_online ? 'Online' : 'Offline';
    document.querySelector('#node-s3 .node-status-text').textContent = status.esp32_s3_online ? 'Online' : 'Offline';
    if (status.last_push) {
      document.getElementById('last-update-time').textContent = '🔄 Last update: ' + new Date(status.last_push).toLocaleTimeString();
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
      document.getElementById('sys-uptime').textContent = `⏱️ ${Math.floor(uptimeMs/3600000)}h ${Math.floor((uptimeMs%3600000)/60000)}m`;
      document.getElementById('total-records').textContent = `📊 ${hubData.length}`;
    }
  } catch(e) {}
}
setInterval(updateDashboard, 30000);
updateDashboard();

function setBackgroundByTemp(temp) { /* مشابه */ }

// ========== Chart ==========
async function drawChart() {
  const board = currentBoard; const range = currentRange; const date = currentDate;
  if (board === 'combined') {
    const [data1, data2] = await Promise.all([getDataRange('esp32_1',range,date), getDataRange('esp32_s3',range,date)]);
    const labels = data1.map(d => d.time);
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('mainChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Room1 Temp', data: data1.map(d=>d.temperature), borderColor:'#ff6ec7', yAxisID:'y', pointRadius:0, tension:0.3, borderWidth:2 },
          { label: 'Room2 Temp', data: data2.map(d=>d.temperature), borderColor:'#ff9900', yAxisID:'y', pointRadius:0, tension:0.3, borderWidth:2 },
          { label: 'Room1 Hum', data: data1.map(d=>d.humidity), borderColor:'#0ff', yAxisID:'y1', pointRadius:0, tension:0.3, borderWidth:2 },
          { label: 'Room2 Hum', data: data2.map(d=>d.humidity), borderColor:'#00ff99', yAxisID:'y1', pointRadius:0, tension:0.3, borderWidth:2 }
        ]
      },
      options: { responsive:true, maintainAspectRatio:true, aspectRatio:2, plugins:{ zoom:{ zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:'x'}, pan:{enabled:true, mode:'x'} } }, scales:{ y:{ type:'linear', position:'left', title:{display:true, text:'Temp (°C)'} }, y1:{ type:'linear', position:'right', title:{display:true, text:'Hum (%)'}, grid:{drawOnChartArea:false} } } }
    });
  } else {
    const data = await getDataRange(board, range, date);
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('mainChart'), {
      type: 'line',
      data: {
        labels: data.map(d=>d.time),
        datasets: [
          { label: 'Temperature', data: data.map(d=>d.temperature), borderColor:'#ff6ec7', yAxisID:'y', fill:true, backgroundColor:'rgba(255,110,199,0.1)', pointRadius:0, tension:0.3, borderWidth:2 },
          { label: 'Humidity', data: data.map(d=>d.humidity), borderColor:'#0ff', yAxisID:'y1', fill:true, backgroundColor:'rgba(0,255,255,0.1)', pointRadius:0, tension:0.3, borderWidth:2 }
        ]
      },
      options: { responsive:true, maintainAspectRatio:true, aspectRatio:2, plugins:{ zoom:{ zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:'x'}, pan:{enabled:true, mode:'x'} } }, scales:{ y:{ type:'linear', position:'left', title:{display:true, text:'Temp (°C)'} }, y1:{ type:'linear', position:'right', title:{display:true, text:'Hum (%)'}, grid:{drawOnChartArea:false} } } }
    });
  }
}
drawChart();
// event listeners same as internal

// ========== Outage (Online) ==========
function updateCountdownUIOnline(schedule) {
  const today = new Date().toISOString().slice(0,10);
  const sched = schedule[today];
  const msgEl = document.getElementById('countdown-text');
  const barEl = document.getElementById('outage-progress');
  const startEl = document.getElementById('outage-start-time');
  const endEl = document.getElementById('outage-end-time');
  const liveIndicator = document.getElementById('live-indicator');
  const powerStatus = document.getElementById('power-status');
  const countdownBadge = document.getElementById('outage-countdown');

  if (!sched) {
    msgEl.textContent = 'No schedule today';
    barEl.style.width = '0%';
    liveIndicator.style.color = '#f00';
    powerStatus.textContent = '⚡ Unknown';
    countdownBadge.textContent = '⏳ No data';
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
    const msg = `⏳ Power cut in ${hrs}h ${mins}m ${secs}s`;
    msgEl.textContent = msg;
    barEl.style.width = '0%';
    liveIndicator.style.color = '#0f0';
    powerStatus.textContent = '⚡ Power On';
    countdownBadge.textContent = msg;
  } else if (now < end) {
    const diff = end - now;
    const hrs = Math.floor(diff/3600000), mins = Math.floor((diff%3600000)/60000), secs = Math.floor((diff%60000)/1000);
    const msg = `⚡ Power returns in ${hrs}h ${mins}m ${secs}s`;
    msgEl.textContent = msg;
    const startSec = timeToSeconds(sched.start);
    const endSec = timeToSeconds(sched.end);
    const nowSec = now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds();
    const progress = ((nowSec - startSec) / (endSec - startSec)) * 100;
    barEl.style.width = Math.min(progress, 100) + '%';
    liveIndicator.style.color = '#f00';
    powerStatus.textContent = '⚡ Power Off';
    countdownBadge.textContent = msg;
  } else {
    msgEl.textContent = '✅ Power is on';
    barEl.style.width = '100%';
    liveIndicator.style.color = '#0f0';
    powerStatus.textContent = '⚡ Power On';
    countdownBadge.textContent = '✅ Power On';
  }
}

async function loadOutageOnline() {
  try {
    const schedule = await fetchOutageOnline();
    outageSchedule = schedule;
    const today = new Date().toISOString().slice(0,10);
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
    const tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10);
    const dayafter = new Date(Date.now()+2*86400000).toISOString().slice(0,10);

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
    updateDay(dayafter, 'dayafter');

    updateCountdownUIOnline(schedule);
    if (outageTimerOnline) clearInterval(outageTimerOnline);
    outageTimerOnline = setInterval(() => updateCountdownUIOnline(schedule), 1000);
  } catch(e) {}
}
loadOutageOnline();

// بقیه موارد (Theme, Lang, Fullscreen, Data Table) مشابه نسخه داخلی است.
// (دکمه ویرایش قطع برق در نسخه آنلاین مخفی می‌شود یا غیرفعال)
// Edit outage
document.getElementById('edit-outage-btn').addEventListener('click', () => {
  document.getElementById('outage-modal').classList.remove('hidden');
  document.getElementById('outage-date').value = new Date().toISOString().slice(0,10);
});
document.getElementById('close-outage-modal').addEventListener('click', () => document.getElementById('outage-modal').classList.add('hidden'));
document.getElementById('save-outage').addEventListener('click', async () => {
  const date = document.getElementById('outage-date').value;
  const start = document.getElementById('outage-start').value;
  const end = document.getElementById('outage-end').value;
  if (!date || !start || !end) { alert('Please fill all fields'); return; }
  await fetch(API+'/api/outage/update', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ date, start, end })
  });
  document.getElementById('outage-modal').classList.add('hidden');
  loadOutageSchedule();
});

// ========== File Manager ==========
async function loadFiles() {
  const files = await (await fetch(API+'/api/files')).json();
  const tbody = document.querySelector('#file-table tbody');
  tbody.innerHTML = files.map(f => `<tr><td>${f.name}</td><td>${(f.size/1024).toFixed(1)}</td><td><button onclick="window.open('${API}/api/download?path=${encodeURIComponent(f.path)}')">⬇️</button><button onclick="deleteFile('${f.path}')">🗑️</button></td></tr>`).join('');
}
async function deleteFile(path) { if(confirm('Delete?')) { await fetch(`${API}/api/delete?path=${encodeURIComponent(path)}`); loadFiles(); } }
document.getElementById('refresh-files').onclick = loadFiles;
document.getElementById('download-all').onclick = async () => {
  const files = await (await fetch(API+'/api/files')).json();
  files.forEach((f,i) => setTimeout(() => { const a=document.createElement('a'); a.href=API+'/api/download?path='+encodeURIComponent(f.path); a.download=f.name; a.click(); }, i*300));
};
document.getElementById('upload-input').onchange = async (e) => {
  const dir = document.getElementById('upload-dir').value || '/www/';
  for(const file of e.target.files) {
    const fd = new FormData(); fd.append('file', file); fd.append('dir', dir);
    await fetch(API+'/api/upload', {method:'POST', body:fd});
  }
  document.getElementById('upload-status').textContent = '✅ Upload complete.'; loadFiles();
};
loadFiles();

// ========== Theme & Lang ==========
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

// ========== Data Table Modal ==========
document.getElementById('view-table-btn').addEventListener('click', async () => {
  document.getElementById('data-modal').classList.remove('hidden');
  const data = await fetchDataRange(currentBoard, currentRange, currentDate);
  document.querySelector('#data-table tbody').innerHTML = data.map(d => `<tr><td>${d.time}</td><td>${d.temp.toFixed(1)}</td><td>${d.humidity.toFixed(0)}</td></tr>`).join('');
});
document.getElementById('close-modal').addEventListener('click', () => document.getElementById('data-modal').classList.add('hidden'));
document.getElementById('export-modal-csv').addEventListener('click', () => {
  const rows = [['Time','Temperature','Humidity']];
  document.querySelectorAll('#data-table tbody tr').forEach(row => { const cells = row.querySelectorAll('td'); rows.push([cells[0].textContent, cells[1].textContent, cells[2].textContent]); });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'data.csv'; a.click();
});

// Export CSV from room cards
document.querySelectorAll('.export-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const board = btn.dataset.board;
    const today = new Date().toISOString().slice(0,10);
    const data = await fetchDataRange(board, 'daily', today);
    if (!data.length) return alert('No data');
    const rows = [['Time','Temperature','Humidity']];
    data.forEach(d => rows.push([d.time, d.temp, d.humidity]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${board}_${today}.csv`; a.click();
  });
});
