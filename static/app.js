const API = window.location.origin;
const TEMP_THRESHOLD = 35;

let lang = localStorage.getItem('lang') || 'en';
let theme = localStorage.getItem('theme') || 'dark';
let currentBoard = 'esp32_1';
let currentRange = 'daily';
let currentDate = new Date().toISOString().slice(0,10);
let chart;

// ===================== INITIAL SETUP =====================
document.documentElement.setAttribute('data-theme', theme);
document.documentElement.lang = lang;
document.dir = lang === 'fa' ? 'rtl' : 'ltr';

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

// ===================== DATE & TIME =====================
function updateDateTime() {
  const now = new Date();
  document.getElementById('datetime').textContent = now.toLocaleTimeString(lang==='fa'?'fa-IR':'en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
setInterval(updateDateTime, 1000);
updateDateTime();

// ===================== API HELPERS =====================
async function fetchCurrent() {
  const resp = await fetch(API+'/api/current');
  return resp.json();
}
async function fetchNodeStatus() {
  const resp = await fetch(API+'/api/nodestatus');
  return resp.json();
}
async function fetchDataRange(board, range, date) {
  const resp = await fetch(`${API}/api/data?board=${board}&range=${range}&date=${date}`);
  return resp.json();
}
async function fetchFiles() {
  const resp = await fetch(API+'/api/files');
  return resp.json();
}

// ===================== DASHBOARD UPDATE =====================
async function updateDashboard() {
  // Node status
  try {
    const status = await fetchNodeStatus();
    document.getElementById('status-hub').style.background = status.hub_online ? '#0f0' : '#f00';
    document.getElementById('status-s3').style.background = status.s3_online ? '#0f0' : '#f00';
    document.getElementById('hub-last-seen').textContent = status.hub_online ? 'Online' : 'Offline';
    document.getElementById('s3-last-seen').textContent = status.s3_online ? 'Online' : 'Offline';
  } catch(e) {}

  // Current values & room stats
  const today = new Date().toISOString().slice(0,10);
  for (let i=1; i<=2; i++) {
    const board = i===1 ? 'esp32_1' : 'esp32_s3';
    const data = await fetchDataRange(board, 'daily', today);
    if (data.length) {
      const last = data[data.length-1];
      const temps = data.map(d => d.temp);
      const hums = data.map(d => d.humidity);
      document.getElementById('t'+i).textContent = last.temp.toFixed(1);
      document.getElementById('h'+i).textContent = last.humidity.toFixed(0);
      document.getElementById('avg-t'+i).textContent = (temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1);
      document.getElementById('avg-h'+i).textContent = (hums.reduce((a,b)=>a+b,0)/hums.length).toFixed(0);
      document.getElementById('minmax-t'+i).textContent = `${Math.min(...temps).toFixed(1)} / ${Math.max(...temps).toFixed(1)}`;
      document.getElementById('minmax-h'+i).textContent = `${Math.min(...hums).toFixed(0)} / ${Math.max(...hums).toFixed(0)}`;
      document.getElementById('count'+i).textContent = data.length;
      // Trend vs yesterday
      const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
      const yesterdayData = await fetchDataRange(board, 'daily', yesterday);
      if (yesterdayData.length) {
        const yesterdayAvg = yesterdayData.map(d=>d.temp).reduce((a,b)=>a+b,0)/yesterdayData.length;
        const todayAvg = temps.reduce((a,b)=>a+b,0)/temps.length;
        const trend = todayAvg - yesterdayAvg;
        document.getElementById('trend'+i).innerHTML = trend > 0.5 ? `📈 +${trend.toFixed(1)}°C` : (trend < -0.5 ? `📉 ${trend.toFixed(1)}°C` : '➡️ Stable');
      }
      // Alert
      if (Math.max(...temps) > TEMP_THRESHOLD) {
        document.getElementById('alert-room'+i).classList.remove('hidden');
      } else {
        document.getElementById('alert-room'+i).classList.add('hidden');
      }
      document.getElementById('total-records').textContent = data.length;
    }
  }

  // System uptime (based on first record of hub)
  try {
    const hubData = await fetchDataRange('esp32_1', 'daily', today);
    if (hubData.length) {
      const firstTime = hubData[0].time;
      const firstDate = new Date(today + 'T' + firstTime);
      const uptimeMs = Date.now() - firstDate;
      const hrs = Math.floor(uptimeMs / 3600000);
      const mins = Math.floor((uptimeMs % 3600000) / 60000);
      document.getElementById('sys-uptime').textContent = `${hrs}h ${mins}m`;
    }
  } catch(e) {}

  // Last push time (stored in status.json but not directly available; we'll use current time as placeholder)
  // Actually we can get from /api/datetime
  try {
    const dtResp = await fetch(API+'/api/datetime');
    const dt = await dtResp.json();
    document.getElementById('last-push-time').textContent = new Date(dt.gregorian).toLocaleTimeString();
  } catch(e) {}
}
updateDashboard();
setInterval(updateDashboard, 60000);

// ===================== CHART =====================
async function drawChart() {
  const board = currentBoard;
  const range = currentRange;
  const date = currentDate;

  if (board === 'combined') {
    const [data1, data2] = await Promise.all([
      fetchDataRange('esp32_1', range, date),
      fetchDataRange('esp32_s3', range, date)
    ]);
    const labels = data1.map(d => d.time);
    if (chart) chart.destroy();
    const ctx = document.getElementById('mainChart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Room 1 Temp', data: data1.map(d=>d.temp), borderColor: '#ff6ec7', yAxisID: 'y', pointRadius: 0 },
          { label: 'Room 2 Temp', data: data2.map(d=>d.temp), borderColor: '#ff9900', yAxisID: 'y', pointRadius: 0 },
          { label: 'Room 1 Hum', data: data1.map(d=>d.humidity), borderColor: '#0ff', yAxisID: 'y1', pointRadius: 0 },
          { label: 'Room 2 Hum', data: data2.map(d=>d.humidity), borderColor: '#00ff99', yAxisID: 'y1', pointRadius: 0 }
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
  } else {
    const data = await fetchDataRange(board, range, date);
    const labels = data.map(d => d.time);
    if (chart) chart.destroy();
    const ctx = document.getElementById('mainChart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Temperature (°C)', data: data.map(d=>d.temp), borderColor: '#ff6ec7', yAxisID: 'y', fill: true, backgroundColor: 'rgba(255,110,199,0.1)', pointRadius: 0 },
          { label: 'Humidity (%)', data: data.map(d=>d.humidity), borderColor: '#0ff', yAxisID: 'y1', fill: true, backgroundColor: 'rgba(0,255,255,0.1)', pointRadius: 0 }
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

// Initial draw
drawChart();

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
    window.open(`${API}/api/data?board=${board}&range=daily&date=${new Date().toISOString().slice(0,10)}&format=csv`, '_blank');
  });
});

// Modal
document.getElementById('view-table-btn').addEventListener('click', async () => {
  document.getElementById('data-modal').classList.remove('hidden');
  const data = await fetchDataRange(currentBoard, currentRange, currentDate);
  const tbody = document.querySelector('#data-table tbody');
  tbody.innerHTML = data.map(d => `<tr><td>${d.time}</td><td>${d.temp.toFixed(1)}</td><td>${d.humidity.toFixed(0)}</td></tr>`).join('');
});
document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('data-modal').classList.add('hidden');
});
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

// File Manager
async function loadFiles() {
  const files = await fetchFiles();
  const tbody = document.querySelector('#file-table tbody');
  tbody.innerHTML = files.map(f => `
    <tr>
      <td>${f.name}</td>
      <td>${(f.size/1024).toFixed(1)}</td>
      <td>
        <button onclick="window.open('${API}/api/download?path=${encodeURIComponent(f.path)}')">⬇️</button>
        <button onclick="deleteFile('${f.path}')">🗑️</button>
      </td>
    </tr>
  `).join('');
}
async function deleteFile(path) {
  if (confirm('Delete ' + path + '?')) {
    await fetch(`${API}/api/delete?path=${encodeURIComponent(path)}`);
    loadFiles();
  }
}
document.getElementById('refresh-files').onclick = loadFiles;
document.getElementById('download-all').onclick = async () => {
  const files = await fetchFiles();
  files.forEach((f, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = API+'/api/download?path=' + encodeURIComponent(f.path);
      a.download = f.name;
      a.click();
    }, i * 300);
  });
};
document.getElementById('upload-input').onchange = async (e) => {
  const dir = document.getElementById('upload-dir').value || '/www/';
  for (const file of e.target.files) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('dir', dir);
    await fetch(API+'/api/upload', { method:'POST', body: formData });
  }
  document.getElementById('upload-status').textContent = 'Upload complete.';
  loadFiles();
};
loadFiles();

// ===================== THEME & LANG =====================
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
