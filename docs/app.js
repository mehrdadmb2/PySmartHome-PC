const REPO_RAW = 'https://raw.githubusercontent.com/mehrdadmb2/PySmartHome-PC/main/';
const TEMP_THRESHOLD = 35;

let lang = localStorage.getItem('lang') || 'en';
let theme = localStorage.getItem('theme') || 'dark';
let currentBoard = 'esp32_1';
let currentRange = 'daily';
let currentDate = new Date().toISOString().slice(0,10);
let chart;

document.documentElement.setAttribute('data-theme', theme);
document.documentElement.lang = lang;
document.dir = lang === 'fa' ? 'rtl' : 'ltr';
updateDateTime(); setInterval(updateDateTime, 1000);

// ===================== BACKGROUND =====================
function initParticles() { /* same as internal */ }
initParticles();

// ===================== HELPERS =====================
function gregorianToJalali(gy, gm, gd) { /* same */ }
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

async function fetchStatus() {
  const resp = await fetch(REPO_RAW + 'status.json');
  return resp.json();
}

async function fetchOutageOnline() {
  const resp = await fetch(REPO_RAW + 'outage_schedule.json');
  return resp.json();
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

// ===================== DASHBOARD =====================
async function updateDashboard() {
  try {
    const status = await fetchStatus();
    document.getElementById('status-hub').style.background = status.esp32_1_online ? '#0f0' : '#f00';
    document.getElementById('status-s3').style.background = status.esp32_s3_online ? '#0f0' : '#f00';
    document.getElementById('hub-last-seen').textContent = status.esp32_1_online ? 'Online' : 'Offline';
    document.getElementById('s3-last-seen').textContent = status.esp32_s3_online ? 'Online' : 'Offline';
    if (status.last_push) {
      document.getElementById('last-push-time').textContent = new Date(status.last_push).toLocaleTimeString();
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
      document.getElementById('avg-h'+i).textContent = (hums.reduce((a,b)=>a+b,0)/hums.length).toFixed(0);
      document.getElementById('minmax-t'+i).textContent = `${Math.min(...temps).toFixed(1)} / ${Math.max(...temps).toFixed(1)}`;
      document.getElementById('minmax-h'+i).textContent = `${Math.min(...hums).toFixed(0)} / ${Math.max(...hums).toFixed(0)}`;
      document.getElementById('count'+i).textContent = data.length;
      const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
      const yesterdayData = await fetchCSV(board, yesterday);
      if (yesterdayData.length) {
        const yesterdayAvg = yesterdayData.map(d=>d.temperature).reduce((a,b)=>a+b,0)/yesterdayData.length;
        const todayAvg = temps.reduce((a,b)=>a+b,0)/temps.length;
        const trend = todayAvg - yesterdayAvg;
        document.getElementById('trend'+i).innerHTML = trend > 0.5 ? `📈 +${trend.toFixed(1)}°C` : (trend < -0.5 ? `📉 ${trend.toFixed(1)}°C` : '➡️ Stable');
      }
      if (Math.max(...temps) > TEMP_THRESHOLD) document.getElementById('alert-room'+i).classList.remove('hidden');
      else document.getElementById('alert-room'+i).classList.add('hidden');
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

// ===================== CHART =====================
async function drawChart() {
  const board = currentBoard; const range = currentRange; const date = currentDate;
  if (board === 'combined') {
    const [data1, data2] = await Promise.all([getDataRange('esp32_1', range, date), getDataRange('esp32_s3', range, date)]);
    const labels = data1.map(d => d.time);
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('mainChart'), {
      type: 'line', data: { labels, datasets: [
        { label: 'Room1 Temp', data: data1.map(d=>d.temperature), borderColor:'#ff6ec7', yAxisID:'y', pointRadius:0 },
        { label: 'Room2 Temp', data: data2.map(d=>d.temperature), borderColor:'#ff9900', yAxisID:'y', pointRadius:0 },
        { label: 'Room1 Hum', data: data1.map(d=>d.humidity), borderColor:'#0ff', yAxisID:'y1', pointRadius:0 },
        { label: 'Room2 Hum', data: data2.map(d=>d.humidity), borderColor:'#00ff99', yAxisID:'y1', pointRadius:0 }
      ]},
      options: { responsive:true, maintainAspectRatio:false, plugins:{ zoom:{ zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:'x'}, pan:{enabled:true, mode:'x'} } },
        scales: { y:{ type:'linear', position:'left', title:{display:true, text:'Temperature'} }, y1:{ type:'linear', position:'right', title:{display:true, text:'Humidity'}, grid:{drawOnChartArea:false} } }
      }
    });
  } else {
    const data = await getDataRange(board, range, date);
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('mainChart'), {
      type: 'line', data: { labels: data.map(d=>d.time), datasets: [
        { label: 'Temperature', data: data.map(d=>d.temperature), borderColor:'#ff6ec7', yAxisID:'y', fill:true, backgroundColor:'rgba(255,110,199,0.1)', pointRadius:0 },
        { label: 'Humidity', data: data.map(d=>d.humidity), borderColor:'#0ff', yAxisID:'y1', fill:true, backgroundColor:'rgba(0,255,255,0.1)', pointRadius:0 }
      ]},
      options: { responsive:true, maintainAspectRatio:false, plugins:{ zoom:{ zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:'x'}, pan:{enabled:true, mode:'x'} } },
        scales: { y:{ type:'linear', position:'left', title:{display:true, text:'Temperature'} }, y1:{ type:'linear', position:'right', title:{display:true, text:'Humidity'}, grid:{drawOnChartArea:false} } }
      }
    });
  }
}
drawChart();

// Chart events
document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => { currentRange = btn.dataset.range; drawChart(); }));
document.getElementById('board-select').addEventListener('change', (e) => { currentBoard = e.target.value; drawChart(); });
document.getElementById('chart-date').addEventListener('change', (e) => { currentDate = e.target.value; drawChart(); });

// ===================== POWER OUTAGE ONLINE =====================
function formatPersianDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const j = gregorianToJalali(d.getFullYear(), d.getMonth()+1, d.getDate());
  return `${j.year}/${String(j.month).padStart(2,'0')}/${String(j.day).padStart(2,'0')}`;
}
async function loadOutageOnline() {
  try {
    const schedule = await fetchOutageOnline();
    const today = new Date().toISOString().slice(0,10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,10);
    const updateDay = (date, prefix) => {
      const elDate = document.getElementById(prefix+'-date');
      const elTime = document.getElementById(prefix+'-time');
      if (elDate) elDate.textContent = formatPersianDate(date);
      if (elTime) {
        if (schedule[date]) {
          elTime.textContent = `${schedule[date].start} تا ${schedule[date].end}`;
          elTime.style.color = 'var(--warning)';
        } else {
          elTime.textContent = 'Unknown';
          elTime.style.color = 'var(--text)';
        }
      }
    };
    updateDay(yesterday, 'yesterday');
    updateDay(today, 'today');
    updateDay(tomorrow, 'tomorrow');
  } catch(e) {}
}
loadOutageOnline();

// ===================== THEME & LANGUAGE =====================
document.getElementById('theme-toggle').onclick = () => { theme = theme==='dark'?'light':'dark'; document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme); };
document.getElementById('retro-toggle').onclick = () => { theme='retro'; document.documentElement.setAttribute('data-theme','retro'); localStorage.setItem('theme','retro'); };
document.getElementById('lang-toggle').onclick = () => { lang = lang==='en'?'fa':'en'; document.documentElement.lang=lang; document.dir=lang==='fa'?'rtl':'ltr'; localStorage.setItem('lang',lang); location.reload(); };
document.getElementById('fullscreen-btn').onclick = () => { if(!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); };

// Data table modal (simplified)
document.getElementById('view-table-btn').addEventListener('click', async () => {
  document.getElementById('data-modal').classList.remove('hidden');
  const data = await getDataRange(currentBoard, currentRange, currentDate);
  document.querySelector('#data-table tbody').innerHTML = data.map(d => `<tr><td>${d.time}</td><td>${d.temperature.toFixed(1)}</td><td>${d.humidity.toFixed(0)}</td></tr>`).join('');
});
document.getElementById('close-modal').addEventListener('click', () => document.getElementById('data-modal').classList.add('hidden'));
document.getElementById('export-modal-csv').addEventListener('click', () => {
  const rows = [['Time','Temperature','Humidity']];
  document.querySelectorAll('#data-table tbody tr').forEach(row => { const cells = row.querySelectorAll('td'); rows.push([cells[0].textContent, cells[1].textContent, cells[2].textContent]); });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='data.csv'; a.click();
});
