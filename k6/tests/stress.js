/**
 * STRESS TEST – far beyond normal load, step by step.
 * Question: where is the breaking point, and how does the system fail?
 * (Gracefully with fast 503 errors, or with endless waiting and timeouts?)
 *
 * The SLOs are relaxed here – the goal is to find the limit, not to pass.
 * Look at the dashboard export to see at which step latency and errors jump.
 */
import { commonOptions, d, thresholds } from "../lib/config.js";
import { mixedTraffic, setThinkTimeScale } from "../lib/journeys.js";
import { summaryOutputs } from "../lib/summary.js";

// Stress = impatient users: only 10 % of the normal think time
setThinkTimeScale(0.1);

const STEP = Number(__ENV.STEP_VUS || 100);

export const options = {
  ...commonOptions,
  scenarios: {
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { target: STEP, duration: d(30) },
        { target: STEP, duration: d(30) },
        { target: STEP * 2, duration: d(30) },
        { target: STEP * 2, duration: d(30) },
        { target: STEP * 4, duration: d(30) },
        { target: STEP * 4, duration: d(30) },
        { target: STEP * 6, duration: d(30) },
        { target: STEP * 6, duration: d(30) },
        { target: 0, duration: d(30) }, // recovery
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: thresholds({ factor: 5, maxErrorRate: 0.05 }),
};

export default function () {
  mixedTraffic();
}

export function handleSummary(data) {
  return summaryOutputs(data, "stress");
}
