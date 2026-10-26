/**
 * SOAK (ENDURANCE) TEST – normal load for a long time (default 30 minutes).
 * Question: does the system stay stable over time? Typical findings are
 * memory leaks, growing queues, connection leaks or full disks.
 *
 * The test reads the API's /metrics endpoint before and after the run and
 * checks that heap memory did not keep growing.
 */
import { check } from "k6";
import http from "k6/http";
import { Gauge } from "k6/metrics";
import { BASE_URL, commonOptions, d, thresholds } from "../lib/config.js";
import { mixedTraffic } from "../lib/journeys.js";
import { summaryOutputs } from "../lib/summary.js";

const heapGrowth = new Gauge("heap_growth_percent");

export const options = {
  ...commonOptions,
  scenarios: {
    soak: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.SOAK_RATE || 10),
      timeUnit: "1s",
      duration: d(1800),
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    ...thresholds(),
    heap_growth_percent: ["value<100"],
  },
};

function heapUsed() {
  const res = http.get(`${BASE_URL}/metrics`, { tags: { name: "metrics" } });
  const match = /process_heap_used_bytes (\d+)/.exec(res.body ?? "");
  return match ? Number(match[1]) : null;
}

export function setup() {
  return { heapBefore: heapUsed() };
}

export default function () {
  mixedTraffic();
}

export function teardown({ heapBefore }) {
  const heapAfter = heapUsed();
  if (heapBefore && heapAfter) {
    const growth = ((heapAfter - heapBefore) / heapBefore) * 100;
    heapGrowth.add(growth);
    check(growth, { "soak: heap memory did not double": (g) => g < 100 });
  }
}

export function handleSummary(data) {
  return summaryOutputs(data, "soak");
}
