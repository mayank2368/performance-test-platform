/**
 * handleSummary helper: prints a compact console summary and saves the full
 * results as JSON (used by tools/report.js for the HTML report and the
 * baseline comparison).
 */
import { ENDPOINTS } from "./config.js";

const ms = (v) => (v === undefined ? "–" : `${v.toFixed(0)} ms`);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function consoleSummary(data, name) {
  const m = data.metrics;
  const lines = [];
  lines.push("", `═══ ${name.toUpperCase()} TEST ═══`);
  lines.push(
    `Requests: ${m.http_reqs?.values.count ?? 0} (${(m.http_reqs?.values.rate ?? 0).toFixed(1)}/s) · ` +
      `errors: ${((m.http_req_failed?.values.rate ?? 0) * 100).toFixed(2)}% · ` +
      `checks: ${((m.checks?.values.rate ?? 0) * 100).toFixed(2)}% · ` +
      `max VUs: ${m.vus_max?.values.max ?? "–"}`,
  );
  lines.push("", `${pad("Endpoint", 14)}${padL("Requests", 10)}${padL("p50", 9)}${padL("p95", 9)}${padL("p99", 9)}${padL("Errors", 9)}`);
  for (const endpoint of ENDPOINTS) {
    const d = m[`http_req_duration{name:${endpoint}}`]?.values;
    const count = m[`http_reqs{name:${endpoint}}`]?.values.count ?? 0;
    const failed = m[`http_req_failed{name:${endpoint}}`]?.values.rate ?? 0;
    if (!d || count === 0) continue;
    lines.push(`${pad(endpoint, 14)}${padL(count, 10)}${padL(ms(d.med), 9)}${padL(ms(d["p(95)"]), 9)}${padL(ms(d["p(99)"]), 9)}${padL(`${(failed * 100).toFixed(1)}%`, 9)}`);
  }

  const failedThresholds = [];
  for (const [metric, info] of Object.entries(m)) {
    for (const [expression, result] of Object.entries(info.thresholds ?? {})) {
      if (!result.ok) failedThresholds.push(`${metric}: ${expression}`);
    }
  }
  lines.push("");
  lines.push(failedThresholds.length ? `❌ ${failedThresholds.length} threshold(s) failed:\n   ${failedThresholds.join("\n   ")}` : "✅ All thresholds passed");
  lines.push(`📄 reports/${name}-summary.json`, "");
  return lines.join("\n");
}

export function summaryOutputs(data, name) {
  data.testName = name;
  data.finishedAt = new Date().toISOString();
  return {
    stdout: consoleSummary(data, name),
    [`reports/${name}-summary.json`]: JSON.stringify(data, null, 2),
  };
}
