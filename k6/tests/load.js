/**
 * LOAD TEST – expected normal peak traffic.
 * Question: does the system meet its SLOs under the load we expect on a busy day?
 *
 * Uses an OPEN workload model (arrival rate): new customers keep arriving at a
 * fixed rate even if the system gets slow – like in reality. A closed model
 * (fixed number of looping users) would hide slowness, because slow responses
 * automatically reduce the load.
 *
 * Traffic mix per second at peak: 12 browsing, 6 searching, 3 buying, plus a
 * back-office report every 10 s.
 */
import { commonOptions, d, thresholds } from "../lib/config.js";
import { backoffice, browse, purchase, search } from "../lib/journeys.js";
import { summaryOutputs } from "../lib/summary.js";

const PEAK = Number(__ENV.PEAK_FACTOR || 1);

function ramp(perSecond) {
  return {
    executor: "ramping-arrival-rate",
    startRate: 0,
    timeUnit: "1s",
    preAllocatedVUs: Math.ceil(perSecond * PEAK * 4),
    maxVUs: Math.ceil(perSecond * PEAK * 20),
    stages: [
      { target: Math.ceil(perSecond * PEAK), duration: d(30) }, // ramp up
      { target: Math.ceil(perSecond * PEAK), duration: d(120) }, // steady peak
      { target: 0, duration: d(15) }, // ramp down
    ],
  };
}

export const options = {
  ...commonOptions,
  scenarios: {
    browsing: { ...ramp(12), exec: "browsing" },
    searching: { ...ramp(6), exec: "searching" },
    buying: { ...ramp(3), exec: "buying" },
    backoffice: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "10s",
      duration: d(165),
      preAllocatedVUs: 2,
      exec: "reporting",
    },
  },
  thresholds: {
    ...thresholds(),
    "http_req_duration{name:sales_report}": ["p(95)<1000"],
    "http_reqs{name:sales_report}": ["count>=0"],
    "http_req_failed{name:sales_report}": ["rate<0.01"],
  },
};

export const browsing = browse;
export const searching = search;
export const buying = purchase;
export const reporting = backoffice;

export function handleSummary(data) {
  return summaryOutputs(data, "load");
}
