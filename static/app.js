const API = window.location.origin;
let lang = localStorage.getItem('lang') || 'fa';
let theme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', theme);
document.documentElement.lang = lang;
document.dir = lang === 'fa' ? 'rtl' : 'ltr';

// Translations
const t = {
  fa: { title: '🏠 خانه هوشمند', room1: 'اتاق ۱', room2: 'اتاق ۲ (S3)' },
  en: { title: '🏠 Smart Home', room1: 'Room 1', room2: 'Room 2 (S3)' }
};

// DateTime
setInterval(async () => {
  const r = await fetch(API+'/api/datetime');
  const d = await r.json();
  document.getElementById('datetime').innerHTML = `📅 ${d.shamsi} | ${d.gregorian}`;
}, 1000);

// Sensors & Averages
async function updateSensors() {
  const r = await fetch(API+'/api/current');
  const d = await r.json();
  document.getElementById('t1').textContent = d.esp32_1_temp.toFixed(1);
  document.getElementById('h1').textContent = d.esp32_1_hum.toFixed(0);
  document.getElementById('t2').textContent = d.esp32_s3_temp.toFixed(1);
  document.getElementById('h2').textContent = d.esp32_s3_hum.toFixed(0);

  // Daily averages
  const r1 = await fetch(API+'/api/data?board=esp32_1&range=daily');
  const data1 = await r1.json();
  if (data1.length) {
    const avgT1 = data1.reduce((s,x)=>s+x.temp,0)/data1.length;
    const avgH1 = data1.reduce((s,x)=>s+x.humidity,0)/data1.length;
    document.getElementById('avg-t1').textContent = avgT1.toFixed(1);
    document.getElementById('avg-h1').textContent = avgH1.toFixed(0);
  }
  const r2 = await fetch(API+'/api/data?board=esp32_s3&range=daily');
  const data2 = await r2.json();
  if (data2.length) {
    const avgT2 = data2.reduce((s,x)=>s+x.temp,0)/data2.length;
    const avgH2 = data2.reduce((s,x)=>s+x.humidity,0)/data2.length;
    document.getElementById('avg-t2').textContent = avgT2.toFixed(1);
    document.getElementById('avg-h2').textContent = avgH2.toFixed(0);
  }
}
setInterval(updateSensors, 5000); updateSensors();

// Node status
setInterval(async () => {
  const r = await fetch(API+'/api/nodestatus');
  const d = await r.json();
  document.getElementById('status-hub').style.background = d.hub_online ? '#0f0' : '#f00';
  document.getElementById('status-s3').style.background = d.s3_online ? '#0f0' : '#f00';
}, 5000);

// Charts
const charts = {};
async function drawChart(board, canvasId, range) {
  const r = await fetch(`${API}/api/data?board=${board}&range=${range}`);
  const data = await r.json();
  const labels = data.map(d => d.time);
  const temps = data.map(d => d.temp);
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
document.querySelectorAll('.range-select').forEach(sel => {
  sel.addEventListener('change', () => {
    drawChart(sel.dataset.board, sel.dataset.board==='esp32_1'?'chart1':'chart2', sel.value);
  });
  drawChart(sel.dataset.board, sel.dataset.board==='esp32_1'?'chart1':'chart2', sel.value);
});

// File manager
async function loadFiles() {
  const r = await fetch(API+'/api/files');
  const files = await r.json();
  const tbody = document.querySelector('#file-table tbody');
  tbody.innerHTML = '';
  files.forEach(f => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${f.name}</td>
      <td>${(f.size/1024).toFixed(1)}</td>
      <td>
        <button onclick="window.open('${API}/api/download?path=${f.path}')">⬇️</button>
        <button onclick="fetch('${API}/api/delete?path=${f.path}').then(()=>loadFiles())">🗑️</button>
      </td>`;
    tbody.appendChild(row);
  });
}
document.getElementById('refresh-files').onclick = loadFiles;
loadFiles();

// Theme & Language
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
