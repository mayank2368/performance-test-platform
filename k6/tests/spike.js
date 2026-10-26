/**
 * SPIKE TEST – a sudden burst of traffic (e.g. a newsletter or TV advert).
 * Question: does the system survive a sudden jump, and does it recover afterwards?
 *
 * The test runs a separate "after the spike" scenario: once the spike is over,
 * response times must be back to normal (strict thresholds on that scenario only).
 */
import { commonOptions, d, secs, thresholds } from "../lib/config.js";
import { mixedTraffic, setThinkTimeScale } from "../lib/journeys.js";
import { summaryOutputs } from "../lib/summary.js";

// Spike traffic: users click faster than usual
setThinkTimeScale(0.3);

const SPIKE_VUS = Number(__ENV.SPIKE_VUS || 400);

export const options = {
  ...commonOptions,
  scenarios: {
    spike: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { target: 10, duration: d(20) }, // normal traffic
        { target: SPIKE_VUS, duration: "10s" }, // sudden spike
        { target: SPIKE_VUS, duration: d(40) },
        { target: 10, duration: "10s" }, // spike ends
        { target: 10, duration: d(20) },
      ],
      gracefulRampDown: "5s",
    },
    after_spike: {
      executor: "constant-vus",
      vus: 5,
      startTime: `${secs(20) + 10 + secs(40) + 10 + 5}s`, // 5 s after the spike has ended
      duration: d(20),
    },
  },
  thresholds: {
    ...thresholds({ factor: 6, maxErrorRate: 0.05 }),
    // Recovery: after the spike, normal SLOs must hold again
    "http_req_duration{scenario:after_spike}": ["p(95)<200"],
    "http_req_failed{scenario:after_spike}": ["rate<0.01"],
  },
};

export default function () {
  mixedTraffic();
}

export function handleSummary(data) {
  return summaryOutputs(data, "spike");
}
