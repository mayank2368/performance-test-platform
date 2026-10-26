#!/usr/bin/env node
/**
 * Creates the HTML/Markdown report from a k6 summary and compares it with the baseline.
 *
 *   node tools/report.js reports/load-summary.json                 # report + comparison
 *   node tools/report.js reports/load-summary.json --save-baseline # store as new baseline
 *
 * Exit codes: 0 = OK, 1 = failed thresholds or regressions, 2 = missing input.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { compare, extractMetrics } from "./analyze.js";
import { renderHtml, renderMarkdown } from "./render.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    baseline: { type: "string" },
    "save-baseline": { type: "boolean", default: false },
    tolerance: { type: "string", default: "0.25" },
    "min-diff-ms": { type: "string", default: "10" },
  },
});

const summaryFile = positionals[0];
if (!summaryFile || !fs.existsSync(summaryFile)) {
  console.error(`❌ k6 summary not found: ${summaryFile ?? "(none given)"} – run a test first, e.g. npm run perf:load`);
  process.exit(2);
}

const current = extractMetrics(JSON.parse(fs.readFileSync(summaryFile, "utf8")));
const baselineFile = args.baseline ?? path.join("baselines", `${current.test}.json`);

if (args["save-baseline"]) {
  fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
  fs.writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`💾 Baseline saved: ${baselineFile}`);
  process.exit(0);
}

const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, "utf8")) : null;
const result = compare(current, baseline, {
  tolerance: Number(args.tolerance),
  minDiffMs: Number(args["min-diff-ms"]),
});

const outDir = path.dirname(summaryFile);
const dashboard = `${current.test}-dashboard.html`;
const htmlFile = path.join(outDir, `${current.test}-report.html`);
fs.writeFileSync(htmlFile, renderHtml(current, baseline, result, { dashboardFile: fs.existsSync(path.join(outDir, dashboard)) ? dashboard : null }));
const markdown = renderMarkdown(current, baseline, result);
fs.writeFileSync(path.join(outDir, `${current.test}-report.md`), markdown);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);

console.log(markdown.replace(/\*\*/g, "").replace(/`/g, ""));
console.log(`📄 ${htmlFile}`);
if (!baseline) console.log(`ℹ️  No baseline at ${baselineFile} – save one with: node tools/report.js ${summaryFile} --save-baseline`);

const failed = result.failedThresholds.length > 0 || result.regressions.length > 0;
console.log(failed ? "❌ Performance check failed" : "✅ Performance check passed");
process.exit(failed ? 1 : 0);
