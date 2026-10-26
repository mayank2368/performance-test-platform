/**
 * Shared configuration for all k6 tests.
 * Everything can be overridden with environment variables:
 *   k6 run -e BASE_URL=https://staging.example.com -e DURATION_SCALE=0.2 k6/tests/load.js
 */

export const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

/** Shortens or lengthens every test, e.g. 0.2 for a quick run in CI, 3 for a long run. */
export const DURATION_SCALE = Number(__ENV.DURATION_SCALE || 1);

/** Scales the pauses between user actions ("think time"). 0 = no pauses. */
export const THINK_TIME_SCALE = Number(__ENV.THINK_TIME_SCALE ?? 1);

/** Scaled number of seconds. */
export function secs(seconds) {
  return Math.max(1, Math.round(seconds * DURATION_SCALE));
}

/** Duration helper: d(120) → "120s" (scaled). */
export function d(seconds) {
  return `${secs(seconds)}s`;
}

export const ENDPOINTS = ["login", "products", "product", "add_to_cart", "cart", "checkout"];

/**
 * Service Level Objectives (SLOs) per endpoint: 95% of requests must be faster
 * than this. If one is violated, k6 marks the threshold as failed and exits
 * with code 99 – which fails the CI pipeline.
 */
export const SLO_P95_MS = {
  login: 400,
  products: 100,
  product: 80,
  add_to_cart: 80,
  cart: 80,
  checkout: 500,
};

/** Builds the thresholds object. `factor` relaxes the SLOs (e.g. for stress tests). */
export function thresholds({ factor = 1, maxErrorRate = 0.01 } = {}) {
  const result = {
    http_req_failed: [`rate<${maxErrorRate}`],
    checks: ["rate>0.99"],
    purchase_journey_duration: [`p(95)<${Math.round(1500 * factor)}`],
  };
  for (const name of ENDPOINTS) {
    result[`http_req_duration{name:${name}}`] = [`p(95)<${Math.round(SLO_P95_MS[name] * factor)}`];
    // The next two are always true – they only make k6 report per-endpoint numbers in the summary
    result[`http_reqs{name:${name}}`] = ["count>=0"];
    result[`http_req_failed{name:${name}}`] = [`rate<${maxErrorRate}`];
  }
  return result;
}

/** Options shared by all tests. */
export const commonOptions = {
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  // Requests are grouped by the "name" tag, not by URL – otherwise /api/products/1, /2, /3 … would be separate metrics
  systemTags: ["status", "method", "name", "group", "check", "error", "error_code", "scenario", "expected_response"],
};
