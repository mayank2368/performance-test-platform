import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { compare, extractMetrics } from "../tools/analyze.js";
import { escapeHtml, renderHtml } from "../tools/render.js";

/** Builds a minimal k6 summary like handleSummary produces. */
function k6Summary(endpoints, { failed = 0, thresholdOk = true } = {}) {
  const metrics = {
    http_reqs: { values: { count: 1000, rate: 50 } },
    http_req_failed: { values: { rate: failed }, thresholds: { "rate<0.01": { ok: failed < 0.01 } } },
    http_req_duration: { values: { "p(95)": 100 } },
    checks: { values: { rate: 1 } },
    vus_max: { values: { max: 50 } },
  };
  for (const [name, p95] of Object.entries(endpoints)) {
    metrics[`http_req_duration{name:${name}}`] = {
      values: { avg: p95 / 2, med: p95 / 2, max: p95 * 2, "p(95)": p95, "p(99)": p95 * 1.2 },
      thresholds: { "p(95)<100": { ok: thresholdOk } },
    };
    metrics[`http_reqs{name:${name}}`] = { values: { count: 100 }, thresholds: { "count>=0": { ok: true } } };
    metrics[`http_req_failed{name:${name}}`] = { values: { rate: failed } };
  }
  return { testName: "load", finishedAt: "2026-10-25T10:00:00Z", metrics };
}

describe("extractMetrics", () => {
  it("reads per-endpoint percentiles and ignores helper thresholds", () => {
    const m = extractMetrics(k6Summary({ products: 20, checkout: 200 }));
    assert.equal(m.endpoints.products.p95, 20);
    assert.equal(m.endpoints.checkout.count, 100);
    assert.ok(m.thresholds.every((t) => t.expression !== "count>=0"));
    assert.equal(m.overall.rps, 50);
  });
});

describe("compare with baseline", () => {
  const baseline = extractMetrics(k6Summary({ products: 18, product: 8, checkout: 200 }));

  it("detects a large slowdown", () => {
    const current = extractMetrics(k6Summary({ products: 84, product: 8, checkout: 205 }));
    const result = compare(current, baseline);
    assert.deepEqual(result.regressions.map((r) => r.name), ["products"]);
    assert.match(result.regressions[0].reason, /p95 \+367%/);
  });

  it("ignores noise on fast endpoints (big %, few ms)", () => {
    const current = extractMetrics(k6Summary({ products: 18, product: 14, checkout: 200 })); // +75 % but only +6 ms
    assert.equal(compare(current, baseline).regressions.length, 0);
  });

  it("ignores small relative changes on slow endpoints", () => {
    const current = extractMetrics(k6Summary({ products: 18, product: 8, checkout: 240 })); // +20 %
    assert.equal(compare(current, baseline).regressions.length, 0);
  });

  it("flags a higher error rate", () => {
    const current = extractMetrics(k6Summary({ products: 18, product: 8, checkout: 200 }, { failed: 0.02 }));
    assert.ok(compare(current, baseline).regressions.some((r) => /error rate/.test(r.reason)));
  });

  it("reports improvements and failed thresholds", () => {
    const current = extractMetrics(k6Summary({ products: 18, product: 8, checkout: 120 }, { thresholdOk: false }));
    const result = compare(current, baseline);
    assert.equal(result.rows.find((r) => r.name === "checkout").improvement, true);
    assert.ok(result.failedThresholds.length > 0);
  });

  it("works without a baseline", () => {
    const current = extractMetrics(k6Summary({ products: 18 }));
    assert.equal(compare(current, null).regressions.length, 0);
  });
});

describe("report rendering", () => {
  it("escapes HTML", () => {
    assert.equal(escapeHtml('<b a="x">'), "&lt;b a=&quot;x&quot;&gt;");
  });

  it("renders a regression banner", () => {
    const baseline = extractMetrics(k6Summary({ products: 18 }));
    const current = extractMetrics(k6Summary({ products: 90 }));
    const html = renderHtml(current, baseline, compare(current, baseline));
    assert.match(html, /1 regression\(s\) compared to the baseline/);
  });

  it("CLI exits with 1 on a regression and 0 without", async () => {
    const run = promisify(execFile);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-"));
    const summary = path.join(dir, "load-summary.json");
    const baselineFile = path.join(dir, "baseline.json");
    fs.writeFileSync(summary, JSON.stringify(k6Summary({ products: 18 })));
    await run(process.execPath, ["tools/report.js", summary, "--save-baseline", "--baseline", baselineFile]);
    await run(process.execPath, ["tools/report.js", summary, "--baseline", baselineFile]); // same numbers → exit 0

    fs.writeFileSync(summary, JSON.stringify(k6Summary({ products: 90 })));
    const failure = await run(process.execPath, ["tools/report.js", summary, "--baseline", baselineFile]).catch((e) => e);
    assert.equal(failure.code, 1);
    assert.ok(fs.existsSync(path.join(dir, "load-report.html")));
  });
});
