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

// ===================== Background Particles =====================
function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  let width, height, particles = [];
  function resize() { width = canvas.width = window.innerWidth; height = canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize); resize();
  class Particle {
    constructor() { this.x = Math.random()*width; this.y = Math.random()*height; this.vx = (Math.random()-0.5)*0.5; this.vy = (Math.random()-0.5)*0.5; }
    update() { this.x += this.vx; this.y += this.vy; if(this.x<0||this.x>width) this.vx*=-1; if(this.y<0||this.y>height) this.vy*=-1; }
    draw() { ctx.beginPath(); ctx.arc(this.x,this.y,1.5,0,Math.PI*2); ctx.fillStyle = 'rgba(0,255,255,0.5)'; ctx.fill(); }
  }
  for(let i=0;i<80;i++) particles.push(new Particle());
  function animate() {
    ctx.clearRect(0,0,width,height);
    particles.forEach(p => { p.update(); p.draw(); });
    for(let i=0;i<particles.length;i++) {
      for(let j=i+1;j<particles.length;j++) {
        const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if(dist < 100) {
          ctx.beginPath(); ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0,255,255,${1 - dist/100})`; ctx.stroke();
        }
      }
    }
    requestAnimationFrame(animate);
  }
  animate();
}
initParticles();

// ===================== Helpers =====================
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

// ===================== Dashboard Update =====================
async function updateDashboard() {
  try {
    const status = await fetchStatus();
    document.querySelector('#node-hub .status-dot').style.background = status.esp32_1_online ? '#0f0' : '#f00';
    document.querySelector('#node-s3 .status-dot').style.background = status.esp32_s3_online ? '#0f0' : '#f00';
    document.querySelector('#node-hub .node-status-text').textContent = status.esp32_1_online ? 'Online' : 'Offline';
    document.querySelector('#node-s3 .node-status-text').textContent = status.esp32_s3_online ? 'Online' : 'Offline';
    if (status.last_push) {
      const lastPush = new Date(status.last_push);
      document.getElementById('last-update-time').textContent = 'Last update: ' + lastPush.toLocaleTimeString();
    }
  } catch(e) {}

  const today = new Date().toISOString().slice(0,10);
  for (let i=1; i<=2; i++) {
    const board = i===1 ? 'esp32_1' : 'esp32_s3';
    const data = await fetchCSV(board, today);
    if (data.length) {
      const last = data[data.length-1];
      const temps = data.map(d=>d.temperature);
      const hums = data.map(d=>d.humidity);
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
  // Uptime
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

function setBackgroundByTemp(temp) {
  document.body.classList.remove('temp-cold','temp-mild','temp-hot');
  if (temp < 18) document.body.classList.add('temp-cold');
  else if (temp < 28) document.body.classList.add('temp-mild');
  else document.body.classList.add('temp-hot');
}

// ===================== Chart =====================
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
          { label: 'Room1 Temp', data: data1.map(d=>d.temperature), borderColor:'#ff6ec7', yAxisID:'y', pointRadius:0 },
          { label: 'Room2 Temp', data: data2.map(d=>d.temperature), borderColor:'#ff9900', yAxisID:'y', pointRadius:0 },
          { label: 'Room1 Hum', data: data1.map(d=>d.humidity), borderColor:'#0ff', yAxisID:'y1', pointRadius:0 },
          { label: 'Room2 Hum', data: data2.map(d=>d.humidity), borderColor:'#00ff99', yAxisID:'y1', pointRadius:0 }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ zoom:{ zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:'x'}, pan:{enabled:true, mode:'x'} } },
        scales: { y:{ type:'linear', position:'left', title:{display:true, text:'Temperature'} }, y1:{ type:'linear', position:'right', title:{display:true, text:'Humidity'}, grid:{drawOnChartArea:false} } }
      }
    });
  } else {
    const data = await getDataRange(board, range, date);
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('mainChart'), {
      type: 'line',
      data: {
        labels: data.map(d=>d.time),
        datasets: [
          { label: 'Temperature', data: data.map(d=>d.temperature), borderColor:'#ff6ec7', yAxisID:'y', fill:true, backgroundColor:'rgba(255,110,199,0.1)', pointRadius:0 },
          { label: 'Humidity', data: data.map(d=>d.humidity), borderColor:'#0ff', yAxisID:'y1', fill:true, backgroundColor:'rgba(0,255,255,0.1)', pointRadius:0 }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ zoom:{ zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:'x'}, pan:{enabled:true, mode:'x'} } },
        scales: { y:{ type:'linear', position:'left', title:{display:true, text:'Temperature'} }, y1:{ type:'linear', position:'right', title:{display:true, text:'Humidity'}, grid:{drawOnChartArea:false} } }
      }
    });
  }
}
drawChart();

document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => { currentRange = btn.dataset.range; drawChart(); }));
document.getElementById('board-select').addEventListener('change', (e) => { currentBoard = e.target.value; drawChart(); });
document.getElementById('chart-date').addEventListener('change', (e) => { currentDate = e.target.value; drawChart(); });

// ===================== Power Outage Online =====================
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

// ===================== Theme & Language =====================
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

// ===================== Data Table Modal =====================
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
