import { pctText } from "./analyze.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const ms = (v) => (v === null || v === undefined ? "–" : `${v} ms`);
const changeText = (c) => (c === null ? "new" : `${c > 0 ? "+" : ""}${Math.round(c * 100)}%`);

/** Markdown summary – printed in the GitHub Actions job summary. */
export function renderMarkdown(current, baseline, result) {
  const ok = result.failedThresholds.length === 0 && result.regressions.length === 0;
  const rows = result.rows
    .map((r) => `| ${r.name} | ${r.now.count ?? "–"} | ${ms(r.now.p95)} | ${r.before ? ms(r.before.p95) : "–"} | ${changeText(r.change)}${r.regression ? " ❌" : r.improvement ? " ✅" : ""} | ${pctText(r.now.errorRate)} |`)
    .join("\n");
  return `## ${ok ? "✅" : "❌"} Performance: ${current.test} test

**${current.overall.requests} requests** · ${current.overall.rps}/s · errors ${pctText(current.overall.errorRate)} · max ${current.overall.vusMax} virtual users${baseline ? ` · baseline from ${baseline.finishedAt?.slice(0, 10) ?? "?"}` : " · no baseline"}

| Endpoint | Requests | p95 now | p95 baseline | Change | Errors |
|---|---|---|---|---|---|
${rows}

${result.failedThresholds.length ? `**Failed thresholds (SLOs):** ${result.failedThresholds.map((t) => `\`${t.metric}: ${t.expression}\``).join(", ")}\n\n` : ""}${result.regressions.length ? `**Regressions vs. baseline:** ${result.regressions.map((r) => `${r.name} – ${r.reason}`).join("; ")}\n` : ""}`;
}

/** Self-contained HTML report. */
export function renderHtml(current, baseline, result, { dashboardFile = null } = {}) {
  const thresholdsOk = result.failedThresholds.length === 0;
  const noRegressions = result.regressions.length === 0;
  const maxP95 = Math.max(1, ...result.rows.flatMap((r) => [r.now.p95 ?? 0, r.before?.p95 ?? 0]));

  const bars = result.rows
    .map(
      (r) => `
      <div class="bar-group">
        <div class="bar-label">${escapeHtml(r.name)}</div>
        <div class="bars">
          ${r.before ? `<div class="bar base" style="width:${((r.before.p95 / maxP95) * 100).toFixed(1)}%"><span>${r.before.p95} ms</span></div>` : ""}
          <div class="bar now ${r.regression ? "bad" : ""}" style="width:${((r.now.p95 / maxP95) * 100).toFixed(1)}%"><span>${r.now.p95} ms</span></div>
        </div>
      </div>`,
    )
    .join("");

  const rows = result.rows
    .map(
      (r) => `
      <tr class="${r.regression ? "regression" : ""}">
        <th scope="row">${escapeHtml(r.name)}</th>
        <td class="num">${r.now.count ?? "–"}</td>
        <td class="num">${ms(r.now.p50)}</td>
        <td class="num"><b>${ms(r.now.p95)}</b></td>
        <td class="num">${ms(r.now.p99)}</td>
        <td class="num">${r.before ? ms(r.before.p95) : "–"}</td>
        <td class="num change ${r.regression ? "bad" : r.improvement ? "good" : ""}">${changeText(r.change)}</td>
        <td class="num">${pctText(r.now.errorRate)}</td>
        <td>${r.regression ? `<span class="tag bad">Regression</span> <span class="why">${escapeHtml(r.reason)}</span>` : r.improvement ? '<span class="tag good">Faster</span>' : '<span class="tag">OK</span>'}</td>
      </tr>`,
    )
    .join("");

  const thresholdRows = current.thresholds
    .map((t) => `<li class="${t.ok ? "ok" : "ko"}"><span aria-hidden="true">${t.ok ? "✓" : "✗"}</span><span class="visually-hidden">${t.ok ? "passed" : "failed"}:</span> <code>${escapeHtml(t.metric)}</code> ${escapeHtml(t.expression)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Performance Report – ${escapeHtml(current.test)}</title>
<style>
  :root { --bg:#f5f6f8; --surface:#fff; --ink:#16202a; --muted:#56616d; --line:#dde2e8; --good:#067647; --bad:#b42318; --base:#98a2b3; --now:#2563eb; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; color-scheme:light; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1419; --surface:#171e25; --ink:#e7ecf1; --muted:#a2adb9; --line:#2b3540; --good:#5fd39a; --bad:#ff8a80; --base:#5b6572; --now:#7aa7ff; color-scheme:dark; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); line-height:1.5; }
  .wrap { max-width:1080px; margin:0 auto; padding:24px 16px 48px; }
  h1 { margin:0; font-size:1.7rem; } h2 { font-size:1.15rem; margin:28px 0 10px; }
  .sub { color:var(--muted); margin:4px 0 16px; font-size:.92rem; }
  .visually-hidden { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  .banner { border:1px solid; border-radius:12px; padding:10px 14px; margin:8px 0; }
  .banner.good { color:var(--good); } .banner.bad { color:var(--bad); }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:16px 0; }
  .kpi { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
  .kpi .v { font-size:1.5rem; font-weight:700; font-variant-numeric:tabular-nums; }
  .kpi .l { font-size:.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  table { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th, td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; font-size:.9rem; }
  thead th { font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  tr.regression { background:color-mix(in srgb, var(--bad) 8%, transparent); }
  .change.bad { color:var(--bad); font-weight:700; } .change.good { color:var(--good); font-weight:700; }
  .tag { display:inline-block; font-size:.72rem; font-weight:700; padding:1px 8px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }
  .tag.bad { color:var(--bad); border-color:var(--bad); } .tag.good { color:var(--good); border-color:var(--good); }
  .why { font-size:.8rem; color:var(--bad); }
  .chart { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .legend { display:flex; gap:16px; font-size:.82rem; color:var(--muted); margin-bottom:8px; }
  .legend i { display:inline-block; width:12px; height:12px; border-radius:3px; vertical-align:-1px; margin-right:5px; }
  .bar-group { display:grid; grid-template-columns:110px 1fr; gap:10px; align-items:center; margin:8px 0; }
  .bar-label { font-weight:600; font-size:.88rem; }
  .bars { display:grid; gap:3px; }
  .bar { height:16px; border-radius:4px; min-width:2px; position:relative; }
  .bar span { position:absolute; left:calc(100% + 6px); top:-1px; font-size:.75rem; white-space:nowrap; color:var(--muted); }
  .bar.base { background:var(--base); } .bar.now { background:var(--now); } .bar.now.bad { background:var(--bad); }
  ul.thresholds { list-style:none; padding:0; margin:0; columns:2 320px; font-size:.86rem; }
  ul.thresholds li { padding:2px 0; } .ok span:first-child { color:var(--good); } .ko { color:var(--bad); font-weight:700; }
  code { font-size:.8rem; }
  a { color:var(--now); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Performance Report – ${escapeHtml(current.test)} test</h1>
  <p class="sub">Finished ${escapeHtml(current.finishedAt ? new Date(current.finishedAt).toLocaleString("en-GB") : "–")} · baseline: ${baseline ? `run from ${escapeHtml(new Date(baseline.finishedAt).toLocaleString("en-GB"))}` : "none (save one with --save-baseline)"}${dashboardFile ? ` · <a href="${escapeHtml(dashboardFile)}">k6 time-series dashboard</a>` : ""}</p>

  <div class="banner ${thresholdsOk ? "good" : "bad"}"><b>${thresholdsOk ? "All SLO thresholds passed." : `${result.failedThresholds.length} SLO threshold(s) failed.`}</b></div>
  ${baseline ? `<div class="banner ${noRegressions ? "good" : "bad"}"><b>${noRegressions ? "No regressions compared to the baseline." : `${result.regressions.length} regression(s) compared to the baseline:`}</b> ${result.regressions.map((r) => `${escapeHtml(r.name)} (${escapeHtml(r.reason)})`).join(" · ")}</div>` : ""}

  <div class="kpis">
    <div class="kpi"><div class="v">${current.overall.requests.toLocaleString("en-GB")}</div><div class="l">Requests</div></div>
    <div class="kpi"><div class="v">${current.overall.rps}/s</div><div class="l">Throughput</div></div>
    <div class="kpi"><div class="v">${pctText(current.overall.errorRate)}</div><div class="l">Error rate</div></div>
    <div class="kpi"><div class="v">${ms(current.overall.p95)}</div><div class="l">p95 all requests</div></div>
    <div class="kpi"><div class="v">${current.overall.vusMax ?? "–"}</div><div class="l">Max virtual users</div></div>
  </div>

  <h2>p95 response time per endpoint</h2>
  <div class="chart" role="img" aria-label="Bar chart of p95 response times per endpoint, baseline compared to this run. Values are listed in the table below.">
    <div class="legend">${baseline ? '<span><i style="background:var(--base)"></i>Baseline</span>' : ""}<span><i style="background:var(--now)"></i>This run</span><span><i style="background:var(--bad)"></i>Regression</span></div>
    ${bars}
  </div>

  <h2>Endpoints</h2>
  <table>
    <thead><tr><th scope="col">Endpoint</th><th scope="col" class="num">Requests</th><th scope="col" class="num">p50</th><th scope="col" class="num">p95</th><th scope="col" class="num">p99</th><th scope="col" class="num">p95 baseline</th><th scope="col" class="num">Change</th><th scope="col" class="num">Errors</th><th scope="col">Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>SLO thresholds</h2>
  <ul class="thresholds">${thresholdRows}</ul>
</div>
</body>
</html>`;
}
