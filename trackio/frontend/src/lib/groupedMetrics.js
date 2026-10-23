import { buildRunGroups, configPathLabel, groupForRun } from "./grouping.js";
import { processRunData } from "./dataProcessing.js";

const MAX_GRID_POINTS = 1000;
const MAX_INTERPOLATION_GAP_MULTIPLIER = 3;

function csvFields(keys) {
  return keys.map((key, index) => ({ key: `config.${configPathLabel(key)}`, index }));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function prepareRunPoints(rows) {
  rows.sort((a, b) => a.x - b.x);
  const points = [];
  for (const row of rows) {
    const previous = points[points.length - 1];
    if (previous?.x === row.x) {
      previous.sum += row.y;
      previous.count++;
    } else {
      points.push({ x: row.x, sum: row.y, count: 1 });
    }
  }
  const values = points.map(({ x, sum, count }) => ({ x, y: sum / count }));
  const gaps = values.slice(1).map((point, i) => point.x - values[i].x);
  return {
    points: values,
    maxGap: gaps.length ? median(gaps) * MAX_INTERPOLATION_GAP_MULTIPLIER : 0,
    cursor: 0,
  };
}

function sharedGrid(groupRuns, maxGridPoints = MAX_GRID_POINTS) {
  const allX = [...new Set(groupRuns.flatMap(({ points }) => points.map((point) => point.x)))].sort((a, b) => a - b);
  if (allX.length <= maxGridPoints) return allX;
  const first = allX[0];
  const last = allX[allX.length - 1];
  const step = (last - first) / (maxGridPoints - 1);
  const grid = Array.from({ length: maxGridPoints }, (_, i) => i === maxGridPoints - 1 ? last : first + i * step);
  // Preserve each run's endpoints, including singleton runs, even on a capped grid.
  for (const { points } of groupRuns) {
    grid.push(points[0].x, points[points.length - 1].x);
  }
  return [...new Set(grid)].sort((a, b) => a - b);
}

function valueAt(run, x) {
  const { points } = run;
  if (x < points[0].x || x > points[points.length - 1].x) return null;
  while (run.cursor + 1 < points.length && points[run.cursor + 1].x <= x) run.cursor++;
  const left = points[run.cursor];
  if (left.x === x) return left.y;
  const right = points[run.cursor + 1];
  if (!right || right.x - left.x > run.maxGap) return null;
  return left.y + (right.y - left.y) * (x - left.x) / (right.x - left.x);
}

/** Align runs on a shared grid, then give each contributing run equal weight.
 * The band is the observed range of aligned run values, not a confidence interval.
 */
export function computeGroupedMetric(masterData, metric, xColumn, runs, runConfigs, keys, runGroups = null) {
  runGroups ??= buildRunGroups(runs, runConfigs, keys);
  const byRun = new Map();
  for (const row of masterData) {
    const x = row[xColumn];
    const y = row[metric];
    const runId = row.run_id ?? row.series_key;
    const group = runGroups.get(runId);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !group) continue;
    const run = byRun.get(runId) ?? { group, originals: [], smoothed: [] };
    (row.data_type === "smoothed" ? run.smoothed : run.originals).push({ x, y });
    byRun.set(runId, run);
  }
  const fields = csvFields(keys);
  const byGroup = new Map();
  for (const run of byRun.values()) {
    const source = run.smoothed.length ? run.smoothed : run.originals;
    if (!source.length) continue;
    const prepared = prepareRunPoints(source);
    const group = byGroup.get(run.group.id) ?? { group: run.group, runs: [] };
    group.runs.push(prepared);
    byGroup.set(run.group.id, group);
  }

  const rows = [];
  const gridPoints = Math.min(MAX_GRID_POINTS, Math.max(2, Math.floor(5000 / byGroup.size)));
  for (const { group, runs: groupRuns } of byGroup.values()) {
    const displayGaps = groupRuns.map((run) => run.maxGap).filter((gap) => gap > 0);
    const maxDisplayGap = displayGaps.length ? median(displayGaps) : Infinity;
    let segment = 0;
    let previousX = null;
    let missingPoint = false;
    for (const x of sharedGrid(groupRuns, gridPoints)) {
      let n = 0;
      let mean = 0;
      let runMin = Infinity;
      let runMax = -Infinity;
      for (const run of groupRuns) {
        const value = valueAt(run, x);
        if (value === null) continue;
        n++;
        mean += (value - mean) / n;
        runMin = Math.min(runMin, value);
        runMax = Math.max(runMax, value);
      }
      if (!n) {
        missingPoint = true;
        continue;
      }
      if (previousX !== null && (missingPoint || x - previousX > maxDisplayGap)) segment++;
      const row = {
        [xColumn]: x, [metric]: mean, run_min: runMin, run_max: runMax, n,
        group: group.label, series_key: group.id, segment_key: `${group.id}:${segment}`, run: group.label,
        data_type: "original",
      };
      for (const field of fields) row[field.key] = group.values[field.index] ?? "";
      rows.push(row);
      previousX = x;
      missingPoint = false;
    }
  }
  rows.sort((a, b) => a[xColumn] - b[xColumn]);
  return { rows, summaryRows: rows, fields };
}

export function buildRawGroupedRows(logsByRun, metric, xAxis, runs, runConfigs, keys) {
  const fields = csvFields(keys);
  const rows = [];
  for (const run of runs) {
    const logs = logsByRun.get(run.id ?? run.name);
    const processed = processRunData(logs, run, 0, xAxis, false, false);
    if (!processed) continue;
    const group = groupForRun(run, runConfigs, keys);
    for (const row of processed.rows) {
      if (!Number.isFinite(row[metric])) continue;
      const out = {
        run_id: row.run_id, run: row.run, group: group.label,
        x: row[processed.xColumn], [metric]: row[metric],
      };
      for (const field of fields) out[field.key] = group.values[field.index] ?? "";
      rows.push(out);
    }
  }
  return rows;
}

export function groupedCsvExports(result, metric, xColumn, rawRows) {
  const groupFields = result.fields.map((field) => field.key);
  return [
    {
      label: "Raw runs CSV", filename: `${metric.replace(/\//g, "_")}-runs.csv`,
      rows: rawRows,
      columns: ["run_id", "run", "group", ...groupFields, "x", metric],
    },
    {
      label: "Group summary CSV", filename: `${metric.replace(/\//g, "_")}-groups.csv`,
      rows: result.summaryRows.map((row) => ({ ...row, mean: row[metric], x: row[xColumn] })),
      columns: ["group", ...groupFields, "x", "mean", "run_min", "run_max", "n"],
    },
  ];
}
