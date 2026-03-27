import { ProjectRollup, SessionMetrics } from './metrics.js';

function healthColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function sparklineData(sessions: SessionMetrics[], key: keyof SessionMetrics): number[] {
  return sessions.slice(-14).map(s => s[key] as number);
}

function projectCards(rollups: ProjectRollup[]): string {
  return rollups.map(p => {
    const color = healthColor(p.healthScore);
    const turnsData = sparklineData(p.sessions, 'userTurns');
    const revisitData = sparklineData(p.sessions, 'fileRevisitRate');
    const effData = sparklineData(p.sessions, 'contextEfficiency');
    const memData = sparklineData(p.sessions, 'memoryUtilization');

    return `
    <div class="project-card" onclick="showProject('${p.projectSlug}')">
      <div class="project-header">
        <div>
          <div class="project-name">${escapeHtml(p.projectName)}</div>
          <div class="project-meta">${p.sessionCount} session${p.sessionCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="health-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">
          ${p.healthScore}
        </div>
      </div>
      <div class="metrics-grid">
        <div class="metric-cell">
          <div class="metric-label">Turns / Session</div>
          <div class="metric-value">${p.avgUserTurns.toFixed(1)}</div>
          <canvas class="sparkline" id="spark-turns-${p.projectSlug}" data-values='${JSON.stringify(turnsData)}'></canvas>
        </div>
        <div class="metric-cell">
          <div class="metric-label">File Revisit</div>
          <div class="metric-value">${pct(p.avgFileRevisitRate)}</div>
          <canvas class="sparkline" id="spark-revisit-${p.projectSlug}" data-values='${JSON.stringify(revisitData)}'></canvas>
        </div>
        <div class="metric-cell">
          <div class="metric-label">Cache Efficiency</div>
          <div class="metric-value">${pct(p.avgContextEfficiency)}</div>
          <canvas class="sparkline" id="spark-eff-${p.projectSlug}" data-values='${JSON.stringify(effData)}'></canvas>
        </div>
        <div class="metric-cell">
          <div class="metric-label">Memory Use</div>
          <div class="metric-value">${pct(p.avgMemoryUtilization)}</div>
          <canvas class="sparkline" id="spark-mem-${p.projectSlug}" data-values='${JSON.stringify(memData)}'></canvas>
        </div>
      </div>
    </div>`;
  }).join('');
}

function sessionRows(rollups: ProjectRollup[]): string {
  const allSessions = rollups.flatMap(p => p.sessions).sort((a, b) => b.date.localeCompare(a.date));
  return allSessions.map(s => `
    <tr class="session-row" data-project="${s.projectSlug}">
      <td>${s.date}</td>
      <td class="proj-name">${escapeHtml(s.projectName)}</td>
      <td>${escapeHtml(s.slug || s.sessionId.slice(0, 8))}</td>
      <td>${s.userTurns}</td>
      <td class="${s.fileRevisitRate > 0.4 ? 'warn' : ''}">${pct(s.fileRevisitRate)}</td>
      <td class="${s.contextEfficiency < 0.3 ? 'warn' : ''}">${pct(s.contextEfficiency)}</td>
      <td class="${s.memoryUtilization === 0 && s.memoryFilesTotal > 0 ? 'warn' : ''}">${pct(s.memoryUtilization)}</td>
      <td>${s.durationMinutes}m</td>
      <td>${(s.totalInputTokens / 1000).toFixed(0)}k</td>
    </tr>`).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function overallStats(rollups: ProjectRollup[]): { avgHealth: number; totalSessions: number; totalProjects: number } {
  const totalSessions = rollups.reduce((a, p) => a + p.sessionCount, 0);
  const avgHealth = rollups.length
    ? Math.round(rollups.reduce((a, p) => a + p.healthScore, 0) / rollups.length)
    : 0;
  return { avgHealth, totalSessions, totalProjects: rollups.length };
}

export function generateReport(rollups: ProjectRollup[], generatedAt: Date): string {
  const { avgHealth, totalSessions, totalProjects } = overallStats(rollups);
  const healthColor_ = healthColor(avgHealth);

  // Trend data for top chart: last 30 days of avg turns across all projects
  const allSessions = rollups.flatMap(p => p.sessions).sort((a, b) => a.date.localeCompare(b.date));
  const dateMap = new Map<string, { turns: number[]; eff: number[] }>();
  for (const s of allSessions) {
    if (!s.date) continue;
    const entry = dateMap.get(s.date) ?? { turns: [], eff: [] };
    entry.turns.push(s.userTurns);
    entry.eff.push(s.contextEfficiency);
    dateMap.set(s.date, entry);
  }
  const trendDates = Array.from(dateMap.keys()).slice(-30);
  const trendTurns = trendDates.map(d => {
    const e = dateMap.get(d)!;
    return parseFloat((e.turns.reduce((a, b) => a + b, 0) / e.turns.length).toFixed(1));
  });
  const trendEff = trendDates.map(d => {
    const e = dateMap.get(d)!;
    return parseFloat((e.eff.reduce((a, b) => a + b, 0) / e.eff.length * 100).toFixed(1));
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pulse — Agent Health Monitor</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #22263a;
    --border: #2a2e40;
    --text: #e2e8f0;
    --muted: #64748b;
    --green: #22c55e;
    --yellow: #f59e0b;
    --red: #ef4444;
    --blue: #3b82f6;
    --purple: #a855f7;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size: 14px; line-height: 1.5; }
  a { color: var(--blue); text-decoration: none; }

  /* Layout */
  .app { max-width: 1400px; margin: 0 auto; padding: 24px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; }
  .logo { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
  .logo span { color: var(--purple); }
  .generated { font-size: 12px; color: var(--muted); }

  /* Stats bar */
  .stats-bar { display: flex; gap: 16px; margin-bottom: 32px; }
  .stat-card { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 6px; }
  .stat-value { font-size: 32px; font-weight: 700; letter-spacing: -1px; }
  .stat-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }

  /* Trend chart */
  .trend-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 32px; }
  .card-title { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 16px; }
  .trend-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .chart-wrap { height: 200px; }

  /* Project grid */
  .section-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
  .projects-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; margin-bottom: 40px; }
  .project-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; cursor: pointer; transition: border-color 0.15s; }
  .project-card:hover { border-color: var(--purple); }
  .project-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .project-name { font-weight: 600; font-size: 15px; }
  .project-meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .health-badge { font-size: 22px; font-weight: 700; padding: 6px 12px; border-radius: 8px; }
  .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .metric-cell { background: var(--surface2); border-radius: 8px; padding: 10px; }
  .metric-label { font-size: 11px; color: var(--muted); margin-bottom: 2px; }
  .metric-value { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .sparkline { width: 100%; height: 30px; display: block; }

  /* Sessions table */
  .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 40px; }
  table { width: 100%; border-collapse: collapse; }
  thead th { padding: 12px 16px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); border-bottom: 1px solid var(--border); background: var(--surface2); cursor: pointer; user-select: none; }
  thead th:hover { color: var(--text); }
  tbody tr { border-bottom: 1px solid var(--border); }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--surface2); }
  td { padding: 10px 16px; font-size: 13px; }
  td.proj-name { font-weight: 500; }
  td.warn { color: var(--yellow); }

  /* Metric explanations */
  .legend { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 32px; }
  .legend-item { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  .legend-name { font-weight: 600; margin-bottom: 4px; }
  .legend-desc { font-size: 12px; color: var(--muted); line-height: 1.6; }

  @media (max-width: 768px) {
    .stats-bar { flex-direction: column; }
    .trend-charts { grid-template-columns: 1fr; }
    .legend { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="app">
  <header>
    <div class="logo"><span>pulse</span> — agent health monitor</div>
    <div class="generated">Generated ${generatedAt.toLocaleString()}</div>
  </header>

  <div class="stats-bar">
    <div class="stat-card">
      <div class="stat-label">Overall Health</div>
      <div class="stat-value" style="color:${healthColor_}">${avgHealth}</div>
      <div class="stat-sub">/ 100 across ${totalProjects} projects</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Sessions Analyzed</div>
      <div class="stat-value">${totalSessions}</div>
      <div class="stat-sub">Claude Code sessions</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Projects</div>
      <div class="stat-value">${totalProjects}</div>
      <div class="stat-sub">tracked in ~/.claude/projects</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg Turns / Session</div>
      <div class="stat-value">${rollups.length ? (rollups.reduce((a,p)=>a+p.avgUserTurns,0)/rollups.length).toFixed(1) : 0}</div>
      <div class="stat-sub">user messages per session</div>
    </div>
  </div>

  <div class="trend-card">
    <div class="card-title">Trends (last 30 days)</div>
    <div class="trend-charts">
      <div><div style="font-size:12px;color:var(--muted);margin-bottom:8px">Avg Turns to Resolution</div><div class="chart-wrap"><canvas id="chart-turns"></canvas></div></div>
      <div><div style="font-size:12px;color:var(--muted);margin-bottom:8px">Context Efficiency %</div><div class="chart-wrap"><canvas id="chart-eff"></canvas></div></div>
    </div>
  </div>

  <div class="section-title">Projects</div>
  <div class="projects-grid">
    ${projectCards(rollups)}
  </div>

  <div class="section-title">All Sessions</div>
  <div class="table-wrap">
    <table id="session-table">
      <thead>
        <tr>
          <th onclick="sortTable(0)">Date ↕</th>
          <th onclick="sortTable(1)">Project ↕</th>
          <th>Session</th>
          <th onclick="sortTable(3)">Turns ↕</th>
          <th onclick="sortTable(4)">Revisit ↕</th>
          <th onclick="sortTable(5)">Cache Eff ↕</th>
          <th onclick="sortTable(6)">Mem Use ↕</th>
          <th onclick="sortTable(7)">Duration ↕</th>
          <th onclick="sortTable(8)">Tokens ↕</th>
        </tr>
      </thead>
      <tbody id="session-tbody">
        ${sessionRows(rollups)}
      </tbody>
    </table>
  </div>

  <div class="section-title">Metric Guide</div>
  <div class="legend">
    <div class="legend-item">
      <div class="legend-name">Turns to Resolution</div>
      <div class="legend-desc">Number of user messages per session. Lower = agent needed less back-and-forth. Trending up = the agent is getting less efficient at completing tasks.</div>
    </div>
    <div class="legend-item">
      <div class="legend-name">File Revisit Rate</div>
      <div class="legend-desc">Duplicate file reads / total file reads. High rate = agent is re-reading files it already loaded — context thrashing. Ideal: below 20%.</div>
    </div>
    <div class="legend-item">
      <div class="legend-name">Context Efficiency</div>
      <div class="legend-desc">Cache-read tokens / total input tokens. Higher = agent is reusing context from previous turns rather than reprocessing everything. Low = token waste.</div>
    </div>
    <div class="legend-item">
      <div class="legend-name">Memory Utilization</div>
      <div class="legend-desc">Memory files read / total memory files stored. Low ratio = agent isn't using its own memory. Could indicate memory bloat or relevance problems.</div>
    </div>
  </div>
</div>

<script>
const trendDates = ${JSON.stringify(trendDates)};
const trendTurns = ${JSON.stringify(trendTurns)};
const trendEff = ${JSON.stringify(trendEff)};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1a1d27', borderColor: '#2a2e40', borderWidth: 1 } },
  scales: {
    x: { grid: { color: '#2a2e40' }, ticks: { color: '#64748b', maxTicksLimit: 6, font: { size: 11 } } },
    y: { grid: { color: '#2a2e40' }, ticks: { color: '#64748b', font: { size: 11 } } }
  }
};

new Chart(document.getElementById('chart-turns'), {
  type: 'line',
  data: {
    labels: trendDates,
    datasets: [{ data: trendTurns, borderColor: '#a855f7', backgroundColor: '#a855f720', fill: true, tension: 0.3, pointRadius: 3 }]
  },
  options: { ...chartDefaults }
});

new Chart(document.getElementById('chart-eff'), {
  type: 'line',
  data: {
    labels: trendDates,
    datasets: [{ data: trendEff, borderColor: '#22c55e', backgroundColor: '#22c55e20', fill: true, tension: 0.3, pointRadius: 3 }]
  },
  options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, min: 0, max: 100 } } }
});

// Sparklines
document.querySelectorAll('.sparkline').forEach(canvas => {
  const el = canvas;
  const raw = el.getAttribute('data-values');
  if (!raw) return;
  const values = JSON.parse(raw);
  if (!values.length) return;
  const isRevisit = el.id.includes('revisit');
  const color = isRevisit ? '#f59e0b' : '#a855f7';
  new Chart(el, {
    type: 'line',
    data: {
      labels: values.map((_, i) => i),
      datasets: [{ data: values, borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.3 }]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
});

// Sort table
let sortCol = 0, sortDir = 1;
function sortTable(col) {
  if (sortCol === col) sortDir *= -1;
  else { sortCol = col; sortDir = 1; }
  const tbody = document.getElementById('session-tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.sort((a, b) => {
    const av = a.cells[col].textContent.trim();
    const bv = b.cells[col].textContent.trim();
    const an = parseFloat(av.replace('%','').replace('m','').replace('k',''));
    const bn = parseFloat(bv.replace('%','').replace('m','').replace('k',''));
    if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
    return av.localeCompare(bv) * sortDir;
  });
  rows.forEach(r => tbody.appendChild(r));
}

function showProject(slug) {
  const rows = document.querySelectorAll('.session-row');
  rows.forEach(r => {
    r.style.display = r.getAttribute('data-project') === slug ? '' : 'none';
  });
  window.scrollTo({ top: document.getElementById('session-table').offsetTop - 80, behavior: 'smooth' });
}
</script>
</body>
</html>`;
}
