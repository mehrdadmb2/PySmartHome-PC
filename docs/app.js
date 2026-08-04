const REPO_RAW = 'https://raw.githubusercontent.com/mehrdadmb2/PySmartHome-PC/main/';
const TEMP_THRESHOLD = 35;

let lang = localStorage.getItem('lang') || 'en';
let theme = localStorage.getItem('theme') || 'dark';
let currentBoard = 'esp32_1';
let currentRange = 'daily';
let currentDate = new Date().toISOString().slice(0,10);
let allData = {};
let chart;

// ===================== INITIAL SETUP =====================
document.documentElement.setAttribute('data-theme', theme);
document.documentElement.lang = lang;
document.dir = lang === 'fa' ? 'rtl' : 'ltr';
setLanguage();

// ===================== PARTICLE BACKGROUND =====================
function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];
  const maxDist = 100;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  class Particle {
    constructor() { this.x = Math.random()*width; this.y = Math.random()*height; this.vx = (Math.random()-0.5)*0.5; this.vy = (Math.random()-0.5)*0.5; }
    update() { this.x += this.vx; this.y += this.vy; if(this.x<0||this.x>width) this.vx*=-1; if(this.y<0||this.y>height) this.vy*=-1; }
    draw() { ctx.beginPath(); ctx.arc(this.x,this.y,1.5,0,Math.PI*2); ctx.fillStyle = 'rgba(0,255,255,0.5)'; ctx.fill(); }
  }
  for(let i=0;i<80;i++) particles.push(new Particle());

  function animate() {
    ctx.clearRect(0,0,width,height);
    for(let i=0;i<particles.length;i++) {
      particles[i].update(); particles[i].draw();
      for(let j=i+1;j<particles.length;j++) {
        const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if(dist < maxDist) {
          ctx.beginPath(); ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0,255,255,${1 - dist/maxDist})`; ctx.stroke();
        }
      }
    }
    requestAnimationFrame(animate);
  }
  animate();
}
initParticles();

// ===================== HELPER FUNCTIONS =====================
function persianDate(date) {
  const gy = date.getFullYear(), gm = date.getMonth()+1, gd = date.getDate();
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

function formatTime(date, time) {
  const d = new Date(date + 'T' + time);
  if (lang === 'fa') {
    const p = persianDate(d);
    return `${p.year}/${String(p.month).padStart(2,'0')}/${String(p.day).padStart(2,'0')} ${time}`;
  }
  return d.toLocaleString();
}

// ===================== DATA FETCHING =====================
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

// ===================== UI UPDATES =====================
async function updateDashboard() {
  // Date/time
  setInterval(() => {
    const now = new Date();
    const options = lang === 'fa' ? { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false } : { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true };
    document.getElementById('datetime').textContent = now.toLocaleString(lang==='fa'?'fa-IR':'en-US', options);
  }, 1000);

  // Fetch status
  try {
    const statusResp = await fetch(REPO_RAW + 'status.json');
    const status = await statusResp.json();
    document.getElementById('status-hub').style.background = status.esp32_1_online ? '#0f0' : '#f00';
    document.getElementById('status-s3').style.background = status.esp32_s3_online ? '#0f0' : '#f00';
    document.getElementById('hub-last-seen').textContent = status.esp32_1_online ? 'Online' : 'Offline';
    document.getElementById('s3-last-seen').textContent = status.esp32_s3_online ? 'Online' : 'Offline';

    if (status.last_push) {
      const lastPush = new Date(status.last_push);
      document.getElementById('last-push-time').textContent = lastPush.toLocaleTimeString();
    }

    // Uptime calculation (simple: from first record today)
    const today = new Date().toISOString().slice(0,10);
    const hubData = await fetchCSV('esp32_1', today);
    if (hubData.length) {
      const firstTime = hubData[0].time;
      const firstDate = new Date(today + 'T' + firstTime);
      const uptimeMs = Date.now() - firstDate;
      const hrs = Math.floor(uptimeMs / 3600000);
      const mins = Math.floor((uptimeMs % 3600000) / 60000);
      document.getElementById('sys-uptime').textContent = `${hrs}h ${mins}m`;
    }
  } catch(e) {}

  // Room details
  const today = new Date().toISOString().slice(0,10);
  for(let i=1; i<=2; i++) {
    const board = i===1 ? 'esp32_1' : 'esp32_s3';
    const data = await fetchCSV(board, today);
    if (data.length) {
      const last = data[data.length-1];
      const temps = data.map(d=>d.temperature);
      const hums = data.map(d=>d.humidity);
      document.getElementById('t'+i).textContent = last.temperature.toFixed(1);
      document.getElementById('h'+i).textContent = last.humidity.toFixed(0);
      document.getElementById('avg-t'+i).textContent = (temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1);
      document.getElementById('avg-h'+i).textContent = (hums.reduce((a,b)=>a+b,0)/hums.length).toFixed(0);
      document.getElementById('minmax-t'+i).textContent = `${Math.min(...temps).toFixed(1)} / ${Math.max(...temps).toFixed(1)}`;
      document.getElementById('minmax-h'+i).textContent = `${Math.min(...hums).toFixed(0)} / ${Math.max(...hums).toFixed(0)}`;
      document.getElementById('count'+i).textContent = data.length;

      // Trend
      const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
      const yesterdayData = await fetchCSV(board, yesterday);
      if (yesterdayData.length) {
        const yesterdayAvg = yesterdayData.map(d=>d.temperature).reduce((a,b)=>a+b,0)/yesterdayData.length;
        const trend = (temps.reduce((a,b)=>a+b,0)/temps.length) - yesterdayAvg;
        const trendEl = document.getElementById('trend'+i);
        trendEl.innerHTML = trend > 0.5 ? `📈 +${trend.toFixed(1)}°C` : (trend < -0.5 ? `📉 ${trend.toFixed(1)}°C` : '➡️ Stable');
      }
      // Alert
      if (Math.max(...temps) > TEMP_THRESHOLD) {
        document.getElementById('alert-room'+i).classList.remove('hidden');
      }
    }
    document.getElementById('total-records').textContent = data.length;
  }

  // Initial chart draw
  drawChart();
}
updateDashboard();

// ===================== CHART =====================
async function drawChart() {
  const board = currentBoard;
  const range = currentRange;
  const date = currentDate;

  if (board === 'combined') {
    // Combined chart logic (dual axis)
    const data1 = await getDataRange('esp32_1', range, date);
    const data2 = await getDataRange('esp32_s3', range, date);
    // Use Chart.js with 4 datasets
    if (chart) chart.destroy();
    const ctx = document.getElementById('mainChart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data1.map(d=>d.time),
        datasets: [
          { label: 'Room 1 Temp', data: data1.map(d=>d.temperature), borderColor: '#ff6ec7', yAxisID: 'y' },
          { label: 'Room 2 Temp', data: data2.map(d=>d.temperature), borderColor: '#ff9900', yAxisID: 'y' },
          { label: 'Room 1 Hum', data: data1.map(d=>d.humidity), borderColor: '#0ff', yAxisID: 'y1' },
          { label: 'Room 2 Hum', data: data2.map(d=>d.humidity), borderColor: '#00ff99', yAxisID: 'y1' }
        ]
      },
      options: { /* ... */ }
    });
  } else {
    const data = await getDataRange(board, range, date);
    if (chart) chart.destroy();
    const ctx = document.getElementById('mainChart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d=>d.time),
        datasets: [
          { label: 'Temperature (°C)', data: data.map(d=>d.temperature), borderColor: '#ff6ec7', yAxisID: 'y', fill: true, backgroundColor: 'rgba(255,110,199,0.1)' },
          { label: 'Humidity (%)', data: data.map(d=>d.humidity), borderColor: '#0ff', yAxisID: 'y1', fill: true, backgroundColor: 'rgba(0,255,255,0.1)' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, pan: { enabled: true, mode: 'x' } } },
        scales: {
          y: { type:'linear', position:'left', title:{display:true, text:'Temperature'} },
          y1: { type:'linear', position:'right', title:{display:true, text:'Humidity'}, grid:{drawOnChartArea:false} }
        }
      }
    });
  }
}

// ===================== EVENT LISTENERS =====================
document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentRange = btn.dataset.range;
    drawChart();
  });
});
document.getElementById('board-select').addEventListener('change', (e) => {
  currentBoard = e.target.value;
  drawChart();
});
document.getElementById('chart-date').addEventListener('change', (e) => {
  currentDate = e.target.value;
  drawChart();
});

// Export CSV
document.querySelectorAll('.export-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const board = btn.dataset.board;
    const url = REPO_RAW + 'data/' + board + '_' + new Date().toISOString().slice(0,10) + '.csv';
    window.open(url, '_blank');
  });
});

// Modal
document.getElementById('view-table-btn').addEventListener('click', () => {
  document.getElementById('data-modal').classList.remove('hidden');
  populateTable();
});
document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('data-modal').classList.add('hidden');
});

async function populateTable() {
  const data = await getDataRange(currentBoard, currentRange, currentDate);
  const tbody = document.querySelector('#data-table tbody');
  tbody.innerHTML = data.map(d => `<tr><td>${d.time}</td><td>${d.temperature.toFixed(1)}</td><td>${d.humidity.toFixed(0)}</td></tr>`).join('');
}

document.getElementById('export-modal-csv').addEventListener('click', () => {
  const rows = [['Time','Temperature','Humidity']];
  document.querySelectorAll('#data-table tbody tr').forEach(row => {
    const cells = row.querySelectorAll('td');
    rows.push([cells[0].textContent, cells[1].textContent, cells[2].textContent]);
  });
  const csvContent = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csvContent], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='data.csv'; a.click();
});

// Theme/Language
document.getElementById('theme-toggle').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
};
document.getElementById('retro-toggle').onclick = () => {
  theme = 'retro';
  document.documentElement.setAttribute('data-theme', 'retro');
  localStorage.setItem('theme', 'retro');
};
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

function setLanguage() {
  // Could toggle texts, but for simplicity we reload on lang change.
}
