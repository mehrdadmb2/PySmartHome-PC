(() => {
  'use strict';

  const CONFIG = {
    timezone: 'Asia/Tehran',
    tempAlertDefault: 35,
    refreshMs: 10000,
    chartMaxPoints: 2500,
  };

  const state = {
    mode: 'detecting',
    board: 'esp32_1',
    range: 'daily',
    date: tehranDateISO(),
    chart: null,
    dashboard: null,
    outage: null,
    outageTick: null,
    lastData: [],
    requestSeq: 0,
  };

  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => [...document.querySelectorAll(sel)];

  const I18N = {
    online: 'ONLINE', offline: 'OFFLINE', connecting: 'Detecting connection…', local: 'LOCAL API', public: 'PUBLIC SNAPSHOT',
  };

  function tehranFormatter(options = {}) {
    return new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timezone, ...options });
  }

  function tehranDateISO(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${obj.year}-${obj.month}-${obj.day}`;
  }

  function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatDate(date, options = { year: 'numeric', month: 'short', day: 'numeric' }) {
    return tehranFormatter(options).format(date);
  }

  function formatJalali(date) {
    return new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { timeZone: CONFIG.timezone, year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  }

  function parseLocalIran(dateISO, hhmmss = '00:00:00') {
    const [h, m, s] = hhmmss.split(':').map(Number);
    const base = new Date(`${dateISO}T00:00:00Z`);
    return new Date(base.getTime() + ((h * 60 + m) * 60000 + (s || 0) * 1000) - (3.5 * 3600000));
  }

  function localDateTime(dateISO, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const [y, mo, d] = dateISO.split('-').map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
    return date.getTime() - 210 * 60000;
  }

  function hhmmssFromSeconds(sec) {
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function safeJson(response) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function fetchWithTimeout(url, options = {}, ms = 2500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
    } finally { clearTimeout(timer); }
  }

  async function detectMode() {
    try {
      const response = await fetchWithTimeout('/api/health', {}, 900);
      if (response.ok) return 'local';
    } catch (_) {}
    return 'public';
  }

  function dataURL(path) { return `data/${path}`; }

  async function loadDashboard() {
    if (state.mode === 'local') return safeJson(await fetchWithTimeout('/api/dashboard'));
    return safeJson(await fetchWithTimeout(dataURL('status.json'), {}, 3500));
  }

  async function loadOutage() {
    if (state.mode === 'local') return safeJson(await fetchWithTimeout('/api/outage'));
    return safeJson(await fetchWithTimeout(dataURL('outage_schedule.json'), {}, 3500)).then(schedule => ({ schedule, timezone: CONFIG.timezone }));
  }

  async function loadData(board, range, date) {
    if (state.mode === 'local') {
      const payload = await safeJson(await fetchWithTimeout(`/api/data?board=${encodeURIComponent(board)}&range=${encodeURIComponent(range)}&date=${encodeURIComponent(date)}`, {}, 4000));
      return payload.data || [];
    }
    const dates = datesForRange(range, date);
    const chunks = await Promise.all(dates.map(async d => {
      try {
        const resp = await fetchWithTimeout(dataURL(`${board}_${d}.csv`), {}, 3500);
        if (!resp.ok) return [];
        return parseCSV(await resp.text(), d);
      } catch (_) { return []; }
    }));
    return chunks.flat();
  }

  function datesForRange(range, endISO) {
    const end = new Date(`${endISO}T00:00:00Z`);
    const count = range === 'monthly' ? 30 : range === 'weekly' ? 7 : 1;
    const offset = range === 'yesterday' ? 1 : count - 1;
    const out = [];
    for (let i = offset; i >= 0; i--) {
      const d = new Date(end); d.setUTCDate(d.getUTCDate() - i); out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function parseCSV(text, date) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(',').map(s => s.trim().toLowerCase());
    return lines.slice(1).map(line => {
      const parts = line.split(',').map(s => s.trim());
      const row = Object.fromEntries(headers.map((h, i) => [h, parts[i]]));
      const temperature = Number(row.temperature);
      const humidity = Number(row.humidity);
      if (!row.time || !Number.isFinite(temperature) || !Number.isFinite(humidity)) return null;
      return { date, time: row.time, temperature, humidity };
    }).filter(Boolean);
  }

  function nodeEntries() {
    return [
      ['esp32_1', state.dashboard?.nodes?.esp32_1],
      ['esp32_s3', state.dashboard?.nodes?.esp32_s3],
    ];
  }

  function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
  function toggleClass(id, cls, on) { const el = $(id); if (el) el.classList.toggle(cls, on); }

  function nodeStats(data) {
    if (!data.length) return null;
    const temps = data.map(d => d.temperature).filter(Number.isFinite);
    const hums = data.map(d => d.humidity).filter(Number.isFinite);
    return {
      min: Math.min(...temps), max: Math.max(...temps), avg: temps.reduce((a,b) => a+b, 0) / temps.length,
      humMin: Math.min(...hums), humMax: Math.max(...hums), humAvg: hums.reduce((a,b) => a+b, 0) / hums.length,
      last: data[data.length - 1], first: data[0], count: data.length,
    };
  }

  async function refreshDashboard() {
    try {
      state.dashboard = await loadDashboard();
      renderDashboard();
    } catch (error) {
      showToast(`Dashboard refresh failed: ${error.message}`, 'error');
      setText('system-note', 'Telemetry is temporarily unavailable. The dashboard will keep retrying automatically.');
    }
  }

  async function refreshOutage() {
    try {
      state.outage = await loadOutage();
      renderOutageDays();
      updateOutageCountdown();
    } catch (error) {
      showToast(`Outage schedule unavailable: ${error.message}`, 'error');
    }
  }

  function renderDashboard() {
    const d = state.dashboard;
    const nodes = d?.nodes || {};
    const server = d?.server || {};
    const onlineCount = Object.values(nodes).filter(n => n?.online).length;
    const allGood = onlineCount === Object.keys(nodes).length && Object.keys(nodes).length > 0;
    setText('system-status', allGood ? 'ALL SYSTEMS STABLE' : onlineCount ? `${onlineCount}/2 NODES ONLINE` : 'TELEMETRY DEGRADED');
    setText('connection-text', state.mode === 'local' ? I18N.local : I18N.public);
    $('connection-pill')?.querySelector('.pulse-dot')?.style && ($('connection-pill').querySelector('.pulse-dot').style.background = allGood ? 'var(--green)' : 'var(--amber)');

    setText('hero-uptime', formatDuration(server.uptime_seconds));
    setText('hero-poll', server.last_poll ? formatRelative(server.last_poll) : '--');
    setText('hero-sync', server.last_publish ? formatRelative(server.last_publish) : '--');
    setText('hero-samples', formatNumber(Object.values(nodes).reduce((a, n) => a + (Number(n?.samples) || 0), 0)));
    setText('health-worker', state.mode === 'local' ? (d.config ? 'Running' : 'Unknown') : 'Snapshot');
    setText('health-github', d?.server?.publish_ok === false ? 'Degraded' : 'OK');
    setText('health-threshold', `${formatNumber(d?.thresholds?.temperature_alert_c ?? d?.config?.temperature_alert_c ?? CONFIG.tempAlertDefault, 0)} °C`);
    setText('system-note', state.mode === 'local' ? 'Local control plane is active. Live sensor polling and GitHub publication run independently in the background.' : `Public snapshot mode. Last published snapshot: ${d.generated_at ? formatDate(new Date(d.generated_at), {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '--'}.`);
    $('health-orb')?.style && ($('health-orb').style.background = allGood ? 'var(--green)' : 'var(--amber)');

    const threshold = d?.thresholds?.temperature_alert_c ?? d?.config?.temperature_alert_c ?? CONFIG.tempAlertDefault;
    for (const [board, node] of Object.entries(nodes)) renderNode(board, node, threshold);
  }

  async function renderNodeData(board) {
    try {
      const data = await loadData(board, 'daily', tehranDateISO());
      const stats = nodeStats(data);
      const node = state.dashboard?.nodes?.[board];
      if (stats && node) {
        setText(`temp-${board}`, formatNumber(node.temperature ?? stats.last.temperature, 1));
        setText(`hum-${board}`, formatNumber(node.humidity ?? stats.last.humidity, 0));
        setText(`range-${board}`, `${formatNumber(stats.min,1)} / ${formatNumber(stats.max,1)}°`);
        setText(`avg-${board}`, `${formatNumber(stats.avg,1)}°`);
        setText(`latency-${board}`, node.latency_ms == null ? '--' : `${formatNumber(node.latency_ms)} ms`);
        setText(`samples-${board}`, formatNumber(node.samples ?? stats.count));
        setText(`updated-${board}`, node.last_seen ? `Last sample ${formatRelative(node.last_seen)}` : 'No successful sample yet');
        toggleClass(`alert-${board}`, 'hidden', stats.max <= Number(state.dashboard?.thresholds?.temperature_alert_c ?? CONFIG.tempAlertDefault));
      }
    } catch (_) {}
  }

  function renderNode(board, node, threshold) {
    const root = $(`room-${board}`);
    if (!root) return;
    const online = Boolean(node?.online);
    root.querySelector('.status-dot').style.background = online ? 'var(--green)' : 'var(--red)';
    root.querySelector('.node-state-text').textContent = online ? 'ONLINE' : 'OFFLINE';
    setText(`temp-${board}`, node?.temperature == null ? '--' : formatNumber(node.temperature, 1));
    setText(`hum-${board}`, node?.humidity == null ? '--' : formatNumber(node.humidity, 0));
    setText(`latency-${board}`, node?.latency_ms == null ? '--' : `${formatNumber(node.latency_ms)} ms`);
    setText(`samples-${board}`, formatNumber(node?.samples ?? 0));
    setText(`updated-${board}`, node?.last_seen ? `Last sample ${formatRelative(node.last_seen)}` : 'No successful sample yet');
    toggleClass(`alert-${board}`, 'hidden', !(Number(node?.temperature) > threshold));
    renderNodeData(board);
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(Number(seconds))) return '--';
    const total = Math.max(0, Math.floor(Number(seconds)));
    const days = Math.floor(total / 86400); const hours = Math.floor((total % 86400) / 3600); const mins = Math.floor((total % 3600) / 60);
    return days ? `${days}d ${hours}h` : `${hours}h ${mins}m`;
  }

  function formatRelative(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '--';
    const minutes = Math.floor((Date.now() - d.getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return formatDate(d, {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  }

  async function renderChart() {
    const seq = ++state.requestSeq;
    try {
      const data = state.board === 'combined'
        ? await loadCombinedData()
        : await loadData(state.board, state.range, state.date);
      if (seq !== state.requestSeq) return;
      state.lastData = data;
      $('chart-empty').classList.toggle('hidden', Boolean(data.length));
      setText('chart-summary', data.length ? `${formatNumber(data.length)} samples • ${state.range}` : 'No data loaded');
      drawChart(data);
      updateInsights(data);
    } catch (error) {
      showToast(`Chart data failed: ${error.message}`, 'error');
      $('chart-empty').classList.remove('hidden');
    }
  }

  async function loadCombinedData() {
    const [a, b] = await Promise.all([
      loadData('esp32_1', state.range, state.date),
      loadData('esp32_s3', state.range, state.date),
    ]);
    return { a, b };
  }

  function drawChart(payload) {
    if (!window.Chart) return;
    const canvas = $('main-chart');
    if (state.chart) state.chart.destroy();

    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--muted').trim();
    const grid = css.getPropertyValue('--line').trim();
    const purple = css.getPropertyValue('--purple').trim();
    const cyan = css.getPropertyValue('--cyan').trim();
    const amber = css.getPropertyValue('--amber').trim();

    let labels = [];
    let datasets = [];
    if (state.board === 'combined') {
      const a = payload.a.slice(-CONFIG.chartMaxPoints), b = payload.b.slice(-CONFIG.chartMaxPoints);
      const maxLen = Math.max(a.length, b.length);
      labels = Array.from({length:maxLen}, (_,i) => i < a.length ? `${a[i].time}` : i < b.length ? `${b[i].time}` : '');
      datasets = [
        makeDataset('Room 1 • Temp', a.map(x=>x.temperature), purple, 'y'),
        makeDataset('Room 1 • Hum', a.map(x=>x.humidity), cyan, 'y1'),
        makeDataset('Room 2 • Temp', b.map(x=>x.temperature), amber, 'y'),
        makeDataset('Room 2 • Hum', b.map(x=>x.humidity), 'rgba(110, 255, 190, .95)', 'y1'),
      ];
    } else {
      const data = payload.slice(-CONFIG.chartMaxPoints);
      labels = data.map(d => data.length > 500 && d.date ? `${d.date.slice(5)} ${d.time.slice(0,5)}` : d.time.slice(0,5));
      datasets = [
        makeDataset('Temperature', data.map(x=>x.temperature), purple, 'y'),
        makeDataset('Humidity', data.map(x=>x.humidity), cyan, 'y1'),
      ];
    }

    state.chart = new Chart(canvas, {
      type:'line', data:{labels,datasets},
      options:{
        responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{legend:{labels:{color:text,font:{size:11,weight:'600'},usePointStyle:true,boxWidth:8}},tooltip:{backgroundColor:'rgba(8,16,30,.92)',titleColor:'#fff',bodyColor:'#c1ccdd',borderColor:grid,borderWidth:1,padding:10}},
        scales:{
          x:{ticks:{color:text,maxTicksLimit:9,font:{size:9}},grid:{color:'transparent'}},
          y:{position:'left',beginAtZero:false,ticks:{color:text,font:{size:9}},grid:{color:grid}},
          y1:{position:'right',beginAtZero:true,max:100,ticks:{color:text,font:{size:9}},grid:{drawOnChartArea:false}},
        },
        elements:{line:{tension:.32,borderWidth:2},point:{radius:0,hoverRadius:4}},
        animation:{duration:450},
        plugins:{
          legend:{labels:{color:text,font:{size:11,weight:'600'},usePointStyle:true,boxWidth:8}},
          tooltip:{backgroundColor:'rgba(8,16,30,.92)',titleColor:'#fff',bodyColor:'#c1ccdd',borderColor:grid,borderWidth:1,padding:10},
          zoom:{pan:{enabled:true,mode:'x'},zoom:{wheel:{enabled:true},pinch:{enabled:true},mode:'x'}}
        }
      }
    });
  }

  function makeDataset(label, data, color, axis) { return {label, data, yAxisID:axis, borderColor:color, backgroundColor:'transparent', spanGaps:true, fill:false}; }

  function updateInsights(payload) {
    const data = state.board === 'combined' ? payload.a.concat(payload.b).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)) : payload;
    if (!data.length) { setText('insight-temp','--'); setText('insight-hum','--'); setText('insight-alert','All clear'); return; }
    const stats = nodeStats(data);
    const first = data[0], last = data[data.length - 1];
    const dt = Number(last.temperature) - Number(first.temperature);
    const dh = Number(last.humidity) - Number(first.humidity);
    setText('insight-temp', dt > .5 ? `Rising +${formatNumber(dt,1)}°C` : dt < -.5 ? `Falling ${formatNumber(dt,1)}°C` : 'Stable');
    setText('insight-hum', dh > 2 ? `Rising +${formatNumber(dh,0)}%` : dh < -2 ? `Falling ${formatNumber(dh,0)}%` : 'Stable');
    setText('insight-temp-note', `Range ${formatNumber(stats.min,1)}–${formatNumber(stats.max,1)}°C • average ${formatNumber(stats.avg,1)}°C.`);
    setText('insight-hum-note', `Average ${formatNumber(stats.humAvg,0)}% • range ${formatNumber(stats.humMin,0)}–${formatNumber(stats.humMax,0)}%.`);
    const threshold = state.dashboard?.thresholds?.temperature_alert_c ?? state.dashboard?.config?.temperature_alert_c ?? CONFIG.tempAlertDefault;
    const hot = stats.max > threshold;
    setText('insight-alert', hot ? 'Temperature alert active' : 'All clear');
    setText('insight-alert-note', hot ? `A sample exceeded ${formatNumber(threshold,0)} °C.` : `No sample exceeded ${formatNumber(threshold,0)} °C in this range.`);
  }

  function renderOutageDays() {
    const schedule = state.outage?.schedule || state.outage || {};
    const todayISO = tehranDateISO();
    const yesterdayISO = shiftISO(todayISO, -1);
    const tomorrowISO = shiftISO(todayISO, 1);
    setOutageDay('yesterday', yesterdayISO, schedule[yesterdayISO]);
    setOutageDay('today', todayISO, schedule[todayISO]);
    setOutageDay('tomorrow', tomorrowISO, schedule[tomorrowISO]);
    const ref = findReference(schedule, todayISO);
    if (ref) setText('reference-banner', `${formatHumanDate(ref.date)} • ${ref.start}–${ref.end}`);
  }

  function setOutageDay(prefix, dateISO, item) {
    setText(`${prefix}-date`, formatOutageDate(dateISO));
    const target = `${prefix}-outage`;
    if (!item) setText(target, dateIsFriday(dateISO) ? 'No outage • Friday' : 'No outage scheduled');
    else setText(target, `${item.start} – ${item.end}`);
  }

  function formatOutageDate(iso) {
    const date = parseISOAsUTCDate(iso);
    return `${formatDate(date, {weekday:'short',month:'short',day:'numeric'})} • ${formatJalali(date)}`;
  }

  function formatHumanDate(iso) {
    const date = parseISOAsUTCDate(iso);
    return formatDate(date, {weekday:'short',month:'short',day:'numeric'});
  }

  function parseISOAsUTCDate(iso) { return new Date(`${iso}T12:00:00Z`); }

  function shiftISO(iso, days) {
    const d = parseISOAsUTCDate(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10);
  }

  function dateIsFriday(iso) { return parseISOAsUTCDate(iso).getUTCDay() === 5; }

  function findReference(schedule, todayISO) {
    const keys = Object.keys(schedule).filter(validISO).sort();
    const current = keys.find(k => k === todayISO);
    if (current) return {date:current,start:schedule[current].start,end:schedule[current].end};
    const recent = keys[keys.length - 1];
    return recent ? {date:recent,start:schedule[recent].start,end:schedule[recent].end} : null;
  }

  function validISO(x) { return /^\d{4}-\d{2}-\d{2}$/.test(x); }

  function updateOutageCountdown() {
    if (state.outageTick) clearTimeout(state.outageTick);
    const schedule = state.outage?.schedule || state.outage || {};
    const now = Date.now();
    const todayISO = tehranDateISO();
    const todayItem = schedule[todayISO];
    const nowMinutes = Number(new Intl.DateTimeFormat('en-GB', {timeZone:CONFIG.timezone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace(':','.'));
    const [hh,mm] = new Intl.DateTimeFormat('en-GB',{timeZone:CONFIG.timezone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).split(':').map(Number);
    const minsNow = hh * 60 + mm;

    if (todayItem) {
      const startM = toMinutes(todayItem.start), endM = toMinutes(todayItem.end);
      const startEpoch = localDateTime(todayISO, todayItem.start), endEpoch = localDateTime(todayISO, todayItem.end);
      if (now >= startEpoch && now < endEpoch) {
        const remaining = Math.ceil((endEpoch - now) / 1000);
        setPowerState(false, 'POWER OFF', 'Time until power returns');
        setText('countdown-label', 'POWER CUT ACTIVE');
        setText('outage-countdown', hhmmssFromSeconds(remaining));
        setText('outage-message', `Power is currently OFF. It should return at ${todayItem.end}.`);
        setText('outage-start-time', todayItem.start);
        setText('outage-end-time', todayItem.end);
        const progress = ((minsNow - startM) / (endM - startM)) * 100;
        $('outage-progress').style.width = `${Math.max(0,Math.min(100,progress))}%`;
        const next = findNextOutage(schedule, todayISO, 1);
        setText('next-outage-time', next ? `${formatHumanDate(next.date)} • ${next.start}` : '--');
      } else if (now < startEpoch) {
        const remaining = Math.ceil((startEpoch - now) / 1000);
        setPowerState(true, 'POWER ON', 'Time until next outage');
        setText('countdown-label', 'UNTIL NEXT OUTAGE');
        setText('outage-countdown', hhmmssFromSeconds(remaining));
        setText('outage-message', `Next outage today: ${todayItem.start}–${todayItem.end}.`);
        setText('outage-start-time', todayItem.start); setText('outage-end-time', todayItem.end); $('outage-progress').style.width='0%';
        const next = {date:todayISO,start:todayItem.start,end:todayItem.end};
        setText('next-outage-time', `${formatHumanDate(next.date)} • ${next.start}`);
      } else {
        setPowerState(true, 'POWER ON', 'Next outage');
        const next = findNextOutage(schedule, todayISO, 1);
        if (next) {
          const remaining = Math.ceil((localDateTime(next.date, next.start) - now) / 1000);
          setText('countdown-label', 'UNTIL NEXT OUTAGE'); setText('outage-countdown', hhmmssFromSeconds(remaining));
          setText('outage-message', `Today's outage has ended. Next: ${formatHumanDate(next.date)} at ${next.start}.`);
          setText('outage-start-time', todayItem.start); setText('outage-end-time', todayItem.end); $('outage-progress').style.width='100%';
          setText('next-outage-time', `${formatHumanDate(next.date)} • ${next.start}`);
        } else { setText('outage-countdown','--:--:--'); setText('outage-message','No upcoming outage found in the current schedule window.'); }
      }
    } else {
      setPowerState(true, dateIsFriday(todayISO) ? 'POWER ON • FRIDAY' : 'POWER ON', 'Next scheduled outage');
      const next = findNextOutage(schedule, todayISO, 1);
      if (next) {
        const remaining = Math.ceil((localDateTime(next.date, next.start) - now) / 1000);
        setText('countdown-label', 'UNTIL NEXT OUTAGE'); setText('outage-countdown', hhmmssFromSeconds(remaining));
        setText('outage-message', dateIsFriday(todayISO) ? `No outage is scheduled on Friday. Next: ${formatHumanDate(next.date)} at ${next.start}.` : `No outage is scheduled today. Next: ${formatHumanDate(next.date)} at ${next.start}.`);
        setText('outage-start-time','--:--'); setText('outage-end-time','--:--'); setText('next-outage-time',`${formatHumanDate(next.date)} • ${next.start}`); $('outage-progress').style.width='0%';
      }
    }
    state.outageTick = setTimeout(updateOutageCountdown, 1000);
  }

  function toMinutes(v){const [h,m]=v.split(':').map(Number);return h*60+m;}

  function findNextOutage(schedule, fromISO, startOffset=1) {
    const candidates = Object.keys(schedule).filter(validISO).map(date => ({date,...schedule[date]})).filter(x => x.date >= fromISO && x.date !== fromISO).sort((a,b)=>a.date.localeCompare(b.date));
    return candidates[0] || null;
  }

  function setPowerState(on, title, sub) {
    const el = $('power-state'); if (!el) return; el.querySelector('.power-dot').style.background = on ? 'var(--green)' : 'var(--red)'; el.querySelector('strong').textContent = title; setText('countdown-label', sub);
  }

  function openOutageEditor() {
    if (state.mode !== 'local') { showToast('Schedule editing is available from the local server only.', 'error'); return; }
    const todayISO = tehranDateISO(); const schedule = state.outage?.schedule || {};
    const item = schedule[todayISO] || {start:'13:00',end:'15:00'};
    $('outage-date').value = todayISO; $('outage-start').value = item.start; updateEndPreview(); $('outage-modal').showModal();
  }

  function updateEndPreview() {
    const start = $('outage-start').value; if (!start) return;
    const end = hhmm(toMinutes(start) + 120); $('outage-end').value = end; setText('outage-preview', `${$('outage-date').value || '--'} • ${start}–${end}`);
  }

  async function saveOutage() {
    const date = $('outage-date').value, start = $('outage-start').value, end = $('outage-end').value;
    if (!date || !start || !end) return;
    try {
      const resp = await fetchWithTimeout('/api/outage/update', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,start,end})}, 7000);
      const data = await safeJson(resp);
      state.outage = {schedule:data.schedule,timezone:CONFIG.timezone};
      $('outage-modal').close(); renderOutageDays(); updateOutageCountdown();
      showToast(data.published ? 'Outage cycle updated and published.' : 'Outage cycle updated locally. GitHub publish is unavailable.', data.published ? 'ok' : 'error');
    } catch (error) { showToast(`Could not update outage: ${error.message}`, 'error'); }
  }

  async function showTable() {
    try {
      const data = state.board === 'combined' ? await loadCombinedData() : await loadData(state.board,state.range,state.date);
      const rows = state.board === 'combined' ? [...data.a.map(x=>({...x,board:'Room 1'})),...data.b.map(x=>({...x,board:'Room 2'}))].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)) : data.map(x=>({...x,board:state.board==='esp32_1'?'Room 1':'Room 2'}));
      renderTable('data-table-body', rows.slice(-150)); renderTable('modal-table-body', rows.slice(-500)); $('data-modal').showModal();
    } catch (error) { showToast(`Table load failed: ${error.message}`, 'error'); }
  }

  function renderTable(id, rows) {
    const body = $(id); if (!body) return;
    body.innerHTML = rows.map(row => `<tr><td>${escapeHTML(row.date)}</td><td>${escapeHTML(row.time)}</td><td><strong>${escapeHTML(row.board)}</strong></td><td>${formatNumber(row.temperature,2)} °C</td><td>${formatNumber(row.humidity,1)} %</td></tr>`).join('');
    toggleClass('table-empty','hidden',rows.length>0);
  }

  function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  async function exportCSV() {
    try {
      const payload = state.board === 'combined' ? await loadCombinedData() : {data: await loadData(state.board,state.range,state.date)};
      const rows = state.board === 'combined' ? [...payload.a.map(x=>({...x,board:'Room 1'})),...payload.b.map(x=>({...x,board:'Room 2'}))] : payload.data.map(x=>({...x,board:state.board}));
      if (!rows.length) return showToast('There is no data to export.', 'error');
      const csv = ['date,time,board,temperature,humidity', ...rows.map(r=>[r.date,r.time,r.board,r.temperature,r.humidity].map(v=>`"${String(v).replaceAll('"','""')}"`).join(','))].join('\n');
      const blob = new Blob([csv],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`pysmarthome_${state.board}_${state.range}_${state.date}.csv`; a.click(); URL.revokeObjectURL(url);
      showToast('CSV export ready.', 'ok');
    } catch (error) { showToast(`Export failed: ${error.message}`, 'error'); }
  }

  function applyTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem('psh-theme',theme); }

  function updateClock() {
    const now = new Date();
    setText('iran-clock', tehranFormatter({hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now));
    setText('iran-date', `${formatDate(now,{weekday:'short',year:'numeric',month:'short',day:'numeric'})} • ${formatJalali(now)}`);
  }

  function showToast(message,type='ok') { const stack=$('toast-stack'); const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=message; stack.appendChild(el); setTimeout(()=>el.remove(),4200); }

  function bindEvents() {
    $('theme-toggle')?.addEventListener('click',()=>applyTheme((document.documentElement.dataset.theme||'midnight')==='midnight'?'light':'midnight'));
    $('fullscreen-btn')?.addEventListener('click',()=>document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
    $('board-select')?.addEventListener('change',e=>{state.board=e.target.value;renderChart();});
    $('chart-date')?.addEventListener('change',e=>{state.date=e.target.value||tehranDateISO();renderChart();});
    qsa('#range-buttons button').forEach(btn=>btn.addEventListener('click',()=>{qsa('#range-buttons button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.range=btn.dataset.range;renderChart();}));
    $('reset-zoom')?.addEventListener('click',()=>state.chart?.resetZoom());
    $('export-chart-btn')?.addEventListener('click',exportCSV);
    $('view-table-btn')?.addEventListener('click',showTable);
    $('edit-outage-btn')?.addEventListener('click',openOutageEditor);
    $('close-outage-modal')?.addEventListener('click',()=> $('outage-modal').close());
    $('cancel-outage')?.addEventListener('click',()=> $('outage-modal').close());
    $('save-outage')?.addEventListener('click',saveOutage);
    $('outage-date')?.addEventListener('change',updateEndPreview); $('outage-start')?.addEventListener('change',updateEndPreview);
    $('close-data-modal')?.addEventListener('click',()=> $('data-modal').close());
    window.addEventListener('resize',()=>state.chart?.resize());
  }

  async function boot() {
    applyTheme(localStorage.getItem('psh-theme')||'midnight');
    $('chart-date').value = state.date;
    bindEvents(); updateClock(); setInterval(updateClock,1000);
    state.mode = await detectMode();
    setText('connection-text',state.mode==='local'?I18N.local:I18N.public);
    await Promise.all([refreshDashboard(),refreshOutage(),renderChart()]);
    setInterval(refreshDashboard,CONFIG.refreshMs);
    setInterval(refreshOutage,60000);
    setInterval(renderChart,30000);
  }

  boot();
})();
