import { performance } from "node:perf_hooks";
import {
  computeMetricPlotData,
  summarizeMetricRows,
} from "../src/lib/dataProcessing.js";

const runCount = 70;
const pointsPerRun = 3000;
const metricNames = Array.from({ length: 10 }, (_, index) => `metric_${index}`);
const rows = [];

for (let run = 0; run < runCount; run++) {
  for (let step = 0; step < pointsPerRun; step++) {
    const row = { step, series_key: `run_${run}`, data_type: "original" };
    for (let metric = 0; metric < metricNames.length; metric++) {
      row[metricNames[metric]] = Math.sin(step / 100 + metric);
    }
    rows.push(row);
  }
}

function measure(task) {
  const start = performance.now();
  const value = task();
  return { ms: Math.round(performance.now() - start), value };
}

const summary = measure(() => summarizeMetricRows(rows, "step"));
const allPlots = measure(() => metricNames.map((metric) =>
  computeMetricPlotData(rows, "step", metric, null)));
const nearbyPlots = measure(() => metricNames.slice(0, 4).map((metric) =>
  computeMetricPlotData(rows, "step", metric, null)));

console.log(JSON.stringify({
  runs: runCount,
  pointsPerRun,
  metrics: summary.value.metrics.length,
  summaryMs: summary.ms,
  allPlotsMs: allPlots.ms,
  nearbyPlotsMs: nearbyPlots.ms,
  maxPlottedPoints: Math.max(...allPlots.value.map((plot) => plot.data.length)),
}, null, 2));
