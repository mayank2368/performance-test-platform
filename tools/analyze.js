/**
 * Turns a k6 summary into compact metrics and compares two runs.
 * Pure functions – unit-tested in test/report.test.js.
 */

const round = (v, digits = 1) => (v === undefined || v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

/** Extracts the numbers we care about from k6's handleSummary JSON. */
export function extractMetrics(summary) {
  const m = summary.metrics ?? {};
  const endpoints = {};
  for (const key of Object.keys(m)) {
    const match = /^http_req_duration\{name:([^}]+)\}$/.exec(key);
    if (!match) continue;
    const name = match[1];
    const d = m[key].values;
    const count = m[`http_reqs{name:${name}}`]?.values.count ?? null;
    if (count === 0) continue; // endpoint not used in this test
    endpoints[name] = {
      count,
      avg: round(d.avg),
      p50: round(d.med),
      p95: round(d["p(95)"]),
      p99: round(d["p(99)"]),
      max: round(d.max),
      errorRate: round(m[`http_req_failed{name:${name}}`]?.values.rate ?? 0, 4),
    };
  }

  const thresholds = [];
  for (const [metric, info] of Object.entries(m)) {
    for (const [expression, result] of Object.entries(info.thresholds ?? {})) {
      // "count>=0" thresholds only exist to get per-endpoint numbers – not real goals
      if (expression === "count>=0") continue;
      thresholds.push({ metric, expression, ok: result.ok });
    }
  }

  return {
    test: summary.testName ?? "unknown",
    finishedAt: summary.finishedAt ?? null,
    overall: {
      requests: m.http_reqs?.values.count ?? 0,
      rps: round(m.http_reqs?.values.rate ?? 0),
      errorRate: round(m.http_req_failed?.values.rate ?? 0, 4),
      checksRate: round(m.checks?.values.rate ?? 0, 4),
      vusMax: m.vus_max?.values.max ?? null,
      p95: round(m.http_req_duration?.values["p(95)"]),
      purchaseP95: round(m.purchase_journey_duration?.values["p(95)"]),
    },
    endpoints,
    thresholds,
  };
}

/**
 * Compares a run with a baseline. A p95 regression needs BOTH a relative and an
 * absolute increase – otherwise normal noise on fast endpoints (5 ms → 7 ms = +40 %)
 * would fail the build.
 */
export function compare(current, baseline, { tolerance = 0.25, minDiffMs = 10, errorRateTolerance = 0.005 } = {}) {
  const rows = [];
  for (const [name, now] of Object.entries(current.endpoints)) {
    const before = baseline?.endpoints?.[name];
    if (!before) {
      rows.push({ name, now, before: null, change: null, regression: false, improvement: false });
      continue;
    }
    const diff = now.p95 - before.p95;
    const change = before.p95 > 0 ? diff / before.p95 : 0;
    const slower = change > tolerance && diff > minDiffMs;
    const moreErrors = now.errorRate > before.errorRate + errorRateTolerance;
    rows.push({
      name,
      now,
      before,
      change,
      regression: slower || moreErrors,
      reason: [slower && `p95 +${Math.round(change * 100)}% (${before.p95} → ${now.p95} ms)`, moreErrors && `error rate ${pctText(before.errorRate)} → ${pctText(now.errorRate)}`]
        .filter(Boolean)
        .join(", "),
      improvement: change < -tolerance && -diff > minDiffMs,
    });
  }
  const ORDER = ["login", "products", "product", "add_to_cart", "cart", "checkout"];
  const rank = (name) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);
  rows.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  return {
    rows,
    regressions: rows.filter((r) => r.regression),
    failedThresholds: current.thresholds.filter((t) => !t.ok),
  };
}

export function pctText(rate) {
  return `${(rate * 100).toFixed(2)}%`;
}
