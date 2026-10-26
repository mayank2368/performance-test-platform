/**
 * SMOKE TEST – minimal load (1 virtual user).
 * Question: does every journey work at all, and is the system fast when it is idle?
 * Run it first and on every commit – there is no point load-testing a broken build.
 */
import { commonOptions, d, thresholds } from "../lib/config.js";
import { browse, purchase, search } from "../lib/journeys.js";
import { summaryOutputs } from "../lib/summary.js";

export const options = {
  ...commonOptions,
  vus: 1,
  duration: d(30),
  thresholds: { ...thresholds(), checks: ["rate==1"] }, // at idle, every single check must pass
};

export default function () {
  browse();
  search();
  purchase();
}

export function handleSummary(data) {
  return summaryOutputs(data, "smoke");
}
