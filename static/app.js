const API = window.location.origin;
const TEMP_THRESHOLD = 35;
const MODE = 'internal'; // یا 'online' برای نسخه آنلاین

let lang = localStorage.getItem('lang') || 'en';
let theme = localStorage.getItem('theme') || 'cyberpunk';
let currentBoard = 'esp32_1';
let currentRange = 'daily';
let currentDate = new Date().toISOString().slice(0,10);
let chart;
let outageTimer = null;
let outageSchedule = {};

document.documentElement.setAttribute('data-theme', theme);
document.documentElement.lang = lang;
document.dir = lang === 'fa' ? 'rtl' : 'ltr';
updateDateTime(); setInterval(updateDateTime, 1000);

// ========== Particles ==========
function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  let width, height, particles = [];
  function resize() { width = canvas.width = window.innerWidth; height = canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize); resize();
  class Particle {
    constructor() { this.x = Math.random()*width; this.y = Math.random()*height; this.vx = (Math.random()-0.5)*0.5; this.vy = (Math.random()-0.5)*0.5; this.size = Math.random()*2+1; }
    update() { this.x += this.vx; this.y += this.vy; if(this.x<0||this.x>width) this.vx*=-1; if(this.y<0||this.y>height) this.vy*=-1; }
    draw() { ctx.beginPath(); ctx.arc(this.x,this.y,this.size,0,Math.PI*2); ctx.fillStyle = 'rgba(0,255,255,0.4)'; ctx.fill(); }
  }
  for(let i=0;i<100;i++) particles.push(new Particle());
  function animate() {
    ctx.clearRect(0,0,width,height);
    particles.forEach(p => { p.update(); p.draw(); });
    for(let i=0;i<particles.length;i++) {
      for(let j=i+1;j<particles.length;j++) {
        const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if(dist < 120) {
          ctx.beginPath(); ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0,255,255,${0.3*(1 - dist/120)})`; ctx.stroke();
        }
      }
    }
    requestAnimationFrame(animate);
  }
  animate();
}
initParticles();

// ========== Helpers ==========
function gregorianToJalali(gy, gm, gd) {
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + Math.floor((153 * (gm > 2 ? (gm - 3) : (gm + 9)) + 2) / 5);
  let jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053; jy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return { year: jy, month: jm, day: jd };
}
function formatPersianDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const j = gregorianToJalali(d.getFullYear(), d.getMonth()+1, d.getDate());
  return `${j.year}/${String(j.month).padStart(2,'0')}/${String(j.day).padStart(2,'0')}`;
}
function timeToSeconds(timeStr) { const [h,m]=timeStr.split(':').map(Number); return h*3600+m*60; }
function formatTime(seconds) {
  const h = Math.floor(seconds/3600);
  const m = Math.floor((seconds%3600)/60);
  const s = seconds%60;
  return `${h}h ${m}m ${s}s`;
}

function updateDateTime() {
  const now = new Date();
  document.getElementById('datetime').textContent = now.toLocaleTimeString(lang==='fa'?'fa-IR':'en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

// ========== API Calls ==========
async function fetchCurrent() { const r = await fetch(API+'/api/current'); return r.json(); }
async function fetchNodeStatus() { const r = await fetch(API+'/api/nodestatus'); return r.json(); }
async function fetchDataRange(board, range, date) { const r = await fetch(`${API}/api/data?board=${board}&range=${range}&date=${date}`); return r.json(); }
async function fetchOutageSchedule() { const r = await fetch(API+'/api/outage'); return r.json(); }
async function fetchOutageCountdown() { const r = await fetch(API+'/api/outage/countdown'); return r.json(); }

// ========== Dashboard ==========
async function updateDashboard() {
  try {
    const status = await fetchNodeStatus();
    document.querySelector('#node-hub .status-dot').style.background = status.hub_online ? '#0f0' : '#f00';
    document.querySelector('#node-s3 .status-dot').style.background = status.s3_online ? '#0f0' : '#f00';
    document.querySelector('#node-hub .node-status-text').textContent = status.hub_online ? 'Online' : 'Offline';
    document.querySelector('#node-s3 .node-status-text').textContent = status.s3_online ? 'Online' : 'Offline';
  } catch(e) {}

  const today = new Date().toISOString().slice(0,10);
  for (let i=1; i<=2; i++) {
    const board = i===1 ? 'esp32_1' : 'esp32_s3';
    const data = await fetchDataRange(board, 'daily', today);
    if (data.length) {
      const last = data[data.length-1];
      const temps = data.map(d=>d.temp);
      const hums = data.map(d=>d.humidity);
      document.getElementById('t'+i).textContent = last.temp.toFixed(1);
      document.getElementById('h'+i).textContent = last.humidity.toFixed(0);
      document.getElementById('avg-t'+i).textContent = (temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1);
      document.getElementById('minmax-t'+i).textContent = `${Math.min(...temps).toFixed(1)} / ${Math.max(...temps).toFixed(1)}`;
      document.getElementById('count'+i).textContent = data.length;

      if (i===1) setBackgroundByTemp(last.temp);

      const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
      const yesterdayData = await fetchDataRange(board, 'daily', yesterday);
      if (yesterdayData.length) {
        const yesterdayAvg = yesterdayData.map(d=>d.temp).reduce((a,b)=>a+b,0)/yesterdayData.length;
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
  // Uptime & records
  try {
    const hubData = await fetchDataRange('esp32_1', 'daily', today);
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

function setBackgroundByTemp(temp) {
  document.body.classList.remove('temp-cold','temp-mild','temp-hot');
  if (temp < 18) document.body.classList.add('temp-cold');
  else if (temp < 28) document.body.classList.add('temp-mild');
  else document.body.classList.add('temp-hot');
}

// ========== Chart ==========
async function drawChart() {
  const board = currentBoard; const range = currentRange; const date = currentDate;
  if (board === 'combined') {
    const [data1, data2] = await Promise.all([fetchDataRange('esp32_1',range,date), fetchDataRange('esp32_s3',range,date)]);
    const labels = data1.map(d => d.time);
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('mainChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Room1 Temp', data: data1.map(d=>d.temp), borderColor:'#ff6ec7', yAxisID:'y', pointRadius:0, tension:0.3 },
          { label: 'Room2 Temp', data: data2.map(d=>d.temp), borderColor:'#ff9900', yAxisID:'y', pointRadius:0, tension:0.3 },
          { label: 'Room1 Hum', data: data1.map(d=>d.humidity), borderColor:'#0ff', yAxisID:'y1', pointRadius:0, tension:0.3 },
          { label: 'Room2 Hum', data: data2.map(d=>d.humidity), borderColor:'#00ff99', yAxisID:'y1', pointRadius:0, tension:0.3 }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, pan: { enabled: true, mode: 'x' } } },
        scales: {
          y: { type:'linear', position:'left', title:{display:true, text:'Temperature (°C)'} },
          y1: { type:'linear', position:'right', title:{display:true, text:'Humidity (%)'}, grid:{drawOnChartArea:false} }
        }
      }
    });
  } else {
    const data = await fetchDataRange(board, range, date);
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('mainChart'), {
      type: 'line',
      data: {
        labels: data.map(d=>d.time),
        datasets: [
          { label: 'Temperature', data: data.map(d=>d.temp), borderColor:'#ff6ec7', yAxisID:'y', fill:true, backgroundColor:'rgba(255,110,199,0.1)', pointRadius:0, tension:0.3 },
          { label: 'Humidity', data: data.map(d=>d.humidity), borderColor:'#0ff', yAxisID:'y1', fill:true, backgroundColor:'rgba(0,255,255,0.1)', pointRadius:0, tension:0.3 }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, pan: { enabled: true, mode: 'x' } } },
        scales: {
          y: { type:'linear', position:'left', title:{display:true, text:'Temperature (°C)'} },
          y1: { type:'linear', position:'right', title:{display:true, text:'Humidity (%)'}, grid:{drawOnChartArea:false} }
        }
      }
    });
  }
}
drawChart();

document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => { currentRange = btn.dataset.range; drawChart(); }));
document.getElementById('board-select').addEventListener('change', (e) => { currentBoard = e.target.value; drawChart(); });
document.getElementById('chart-date').addEventListener('change', (e) => { currentDate = e.target.value; drawChart(); });

// ========== Outage ==========
function updateCountdownUI(data) {
  const msgEl = document.getElementById('countdown-text');
  const barEl = document.getElementById('outage-progress');
  const startEl = document.getElementById('outage-start-time');
  const endEl = document.getElementById('outage-end-time');
  const liveIndicator = document.getElementById('live-indicator');
  const powerStatus = document.getElementById('power-status');
  const countdownBadge = document.getElementById('outage-countdown');

  const today = new Date().toISOString().slice(0,10);
  const sched = outageSchedule[today];
  if (sched) {
    startEl.textContent = sched.start;
    endEl.textContent = sched.end;
  }

  if (data.status === 'no_data') {
    msgEl.textContent = '❌ No schedule for today';
    barEl.style.width = '0%';
    liveIndicator.style.color = '#f00';
    powerStatus.textContent = '⚡ Power: Unknown';
    countdownBadge.textContent = '⏳ No data';
    return;
  }

  if (data.status === 'before') {
    msgEl.textContent = data.message;
    barEl.style.width = '0%';
    liveIndicator.style.color = '#0f0';
    powerStatus.textContent = '⚡ Power: On';
    countdownBadge.textContent = `⏳ ${data.message}`;
  } else if (data.status === 'during') {
    msgEl.textContent = data.message;
    const startSec = timeToSeconds(sched.start);
    const endSec = timeToSeconds(sched.end);
    const nowSec = timeToSeconds(new Date().toTimeString().slice(0,8));
    const progress = ((nowSec - startSec) / (endSec - startSec)) * 100;
    barEl.style.width = Math.min(progress, 100) + '%';
    liveIndicator.style.color = '#f00';
    powerStatus.textContent = '⚡ Power: Off';
    countdownBadge.textContent = `⏳ ${data.message}`;
  } else { // after
    msgEl.textContent = data.message;
    barEl.style.width = '100%';
    liveIndicator.style.color = '#0f0';
    powerStatus.textContent = '⚡ Power: On';
    countdownBadge.textContent = '✅ Power On';
  }
}

async function loadOutageSchedule() {
  try {
    outageSchedule = await fetchOutageSchedule();
    const today = new Date().toISOString().slice(0,10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,10);
    const dayafter = new Date(Date.now() + 2*86400000).toISOString().slice(0,10);

    const updateDay = (date, prefix) => {
      const elDate = document.getElementById(prefix + '-date');
      const elTime = document.getElementById(prefix + '-time');
      if (elDate) elDate.textContent = formatPersianDate(date);
      if (elTime) {
        if (outageSchedule[date]) {
          elTime.textContent = `${outageSchedule[date].start} - ${outageSchedule[date].end}`;
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

    const countdown = await fetchOutageCountdown();
    updateCountdownUI(countdown);
    if (outageTimer) clearInterval(outageTimer);
    outageTimer = setInterval(async () => {
      const c = await fetchOutageCountdown();
      updateCountdownUI(c);
    }, 1000);
  } catch(e) { console.error(e); }
}
loadOutageSchedule();

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

// Export CSV buttons on room cards
document.querySelectorAll('.export-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const board = btn.dataset.board;
    const today = new Date().toISOString().slice(0,10);
    const data = await fetchDataRange(board, 'daily', today);
    if (!data.length) return alert('No data for today');
    const rows = [['Time','Temperature','Humidity']];
    data.forEach(d => rows.push([d.time, d.temp, d.humidity]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${board}_${today}.csv`; a.click();
  });
});
