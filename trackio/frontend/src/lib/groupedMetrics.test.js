import { describe, expect, test } from "vitest";
import { computeGroupedMetric, groupedCsvExports, buildRawGroupedRows } from "./groupedMetrics.js";
import { compileConfigFilter, filterRunsByConfig } from "./runFilters.js";
import { serializeCsv } from "./csv.js";

describe("grouped metric aggregation", () => {
  const runs = [
    { id: "a", name: "run-a" }, { id: "b", name: "run-b" },
    { id: "c", name: "run-c" },
  ];
  const configs = {
    a: { args: { model: "small" } },
    b: { args: { model: "small" } },
    c: { args: { model: "large" } },
  };
  const key = '@["args","model"]';

  test("interpolates offset evaluations onto a shared grid without extrapolating", () => {
    const rows = [
      { run_id: "a", step: 0, loss: 0 },
      { run_id: "a", step: 2, loss: 2 },
      { run_id: "b", step: 1, loss: 10 },
      { run_id: "b", step: 3, loss: 30 },
      { run_id: "c", step: 1, loss: 9 },
    ];
    const result = computeGroupedMetric(rows, "loss", "step", runs, configs, [key]);
    const small = result.rows.filter((row) => row.group === "small");
    expect(small.map((row) => row.step)).toEqual([0, 1, 2, 3]);
    expect(small.map((row) => row.n)).toEqual([1, 2, 2, 1]);
    expect(small[1]).toMatchObject({ loss: 5.5, run_min: 1, run_max: 10 });
    expect(small[2]).toMatchObject({ loss: 11, run_min: 2, run_max: 20 });
    expect(result.rows.find((row) => row.group === "large")).toMatchObject({
      step: 1, loss: 9, n: 1, run_min: 9, run_max: 9,
    });
  });

  test("averages duplicate x values within a run before weighting runs equally", () => {
    const result = computeGroupedMetric([
      { run_id: "a", step: 1, loss: 2 },
      { run_id: "a", step: 1, loss: 4 },
      { run_id: "b", step: 1, loss: 5 },
    ], "loss", "step", runs.slice(0, 2), configs, [key]);
    expect(result.rows[0]).toMatchObject({ loss: 4, run_min: 3, run_max: 5, n: 2 });
  });

  test("does not interpolate across a gap much longer than the run's evaluation cadence", () => {
    const result = computeGroupedMetric([
      ...[0, 10, 20, 100, 110].map((step) => ({ run_id: "a", step, loss: step })),
      ...[50, 60].map((step) => ({ run_id: "b", step, loss: 1 })),
    ], "loss", "step", runs.slice(0, 2), configs, [key]);
    expect(result.rows.find((row) => row.step === 50)).toMatchObject({ loss: 1, n: 1 });
    expect(result.rows.find((row) => row.step === 60)).toMatchObject({ loss: 1, n: 1 });
    expect(result.rows.find((row) => row.step === 60).segment_key)
      .not.toBe(result.rows.find((row) => row.step === 100).segment_key);
  });

  test("two bounded runs cannot produce an impossible negative or above-one band", () => {
    const result = computeGroupedMetric([
      { run_id: "a", step: 1, battle_won_mean: 0.1 },
      { run_id: "b", step: 1, battle_won_mean: 0.4 },
    ], "battle_won_mean", "step", runs.slice(0, 2), configs, [key]);
    expect(result.rows[0]).toMatchObject({
      battle_won_mean: 0.25, run_min: 0.1, run_max: 0.4, n: 2,
    });
  });

  test("exports separate raw and grouped CSV with grouping columns", () => {
    const result = computeGroupedMetric([
      { run_id: "a", run: "run-a", step: 1, loss: 2 },
    ], "loss", "step", runs, configs, [key]);
    const rawRows = buildRawGroupedRows(new Map([["a", [{ step: 1, loss: 2 }]]]),
      "loss", "step", runs, configs, [key]);
    const exports = groupedCsvExports(result, "loss", "step", rawRows);
    expect(exports.map((item) => item.label)).toEqual(["Raw runs CSV", "Group summary CSV"]);
    const raw = serializeCsv(exports[0].rows, exports[0].columns);
    const summary = serializeCsv(exports[1].rows, exports[1].columns);
    expect(raw).toContain("run_id,run,group,config.args.model,x,loss");
    expect(summary).toContain("group,config.args.model,x,mean,run_min,run_max,n");
  });

  test("raw export uses logged values while each group run uses smoothed rows when available", () => {
    const logs = new Map([["a", [{ step: 0, loss: 10 }, { step: 1, loss: 20 }]]]);
    const raw = buildRawGroupedRows(logs, "loss", "step", [runs[0]], configs, [key]);
    expect(raw.map((row) => row.loss)).toEqual([10, 20]);
    const grouped = computeGroupedMetric([
      { run_id: "a", step: 0, loss: 10, data_type: "original" },
      { run_id: "a", step: 0, loss: 15, data_type: "smoothed" },
      { run_id: "b", step: 0, loss: 25, data_type: "original" },
    ], "loss", "step", runs.slice(0, 2), configs, [key]);
    expect(grouped.rows[0]).toMatchObject({ loss: 20, run_min: 15, run_max: 25, n: 2 });
  });

  test("caps a dense group curve at 1000 grid points while preserving endpoints", () => {
    const rows = Array.from({ length: 5000 }, (_, step) => ({
      run_id: "a", run: "run-a", step, loss: step,
    }));
    const result = computeGroupedMetric(rows, "loss", "step", [runs[0]], configs, [key]);
    expect(result.rows.length).toBe(1000);
    expect(result.rows[0].step).toBe(0);
    expect(result.rows.at(-1).step).toBe(4999);
    expect(result.rows[0].n).toBe(1);
  });

  test("shares a point budget across many distinct groups", () => {
    const manyRuns = Array.from({ length: 70 }, (_, index) => ({ id: `run-${index}`, name: `run-${index}` }));
    const manyConfigs = Object.fromEntries(manyRuns.map((run) => [run.id, { args: { model: run.id } }]));
    const rows = manyRuns.flatMap((run) => Array.from({ length: 1500 }, (_, step) => ({
      run_id: run.id, step, loss: step / 1500,
    })));
    const result = computeGroupedMetric(rows, "loss", "step", manyRuns, manyConfigs, [key]);
    expect(result.rows.length).toBeLessThanOrEqual(5000);
    expect(new Set(result.rows.map((row) => row.group)).size).toBe(70);
  });
});

test("upstream OR and AND filters constrain grouped aggregates and exports by run ID", () => {
  const runs = ["a", "b", "c", "d"].map((id) => ({ id, name: "same" }));
  const configs = {
    a: { args: { model: "small" }, seed: 1 },
    b: { args: { model: "small" }, seed: 2 },
    c: { args: { model: "small" }, seed: 3 },
    d: { args: { model: "large" }, seed: 1 },
  };
  const rule = (path, operator, value) => ({ key: JSON.stringify(path), operator, value });
  const match = compileConfigFilter([
    [rule(["args", "model"], "=", "small"), rule(["seed"], ">=", "2")],
    [rule(["args", "model"], "=", "large")],
  ]);
  const selected = filterRunsByConfig(runs, configs, match);
  expect(selected.map((run) => run.id)).toEqual(["b", "c", "d"]);
  const rows = [100, 2, 4, 8].map((loss, i) => ({ run_id: runs[i].id, step: 1, loss }));
  const result = computeGroupedMetric(rows, "loss", "step", selected, configs, ['@["args","model"]']);
  expect(result.rows.find((row) => row.group === "small")).toMatchObject({
    loss: 3, run_min: 2, run_max: 4, n: 2,
  });
  const [, summary] = groupedCsvExports(result, "loss", "step", []);
  expect(summary.rows.find((row) => row.group === "small")).toMatchObject({ mean: 3, n: 2 });
});

test("keeps literal dotted and nested grouping fields distinct in CSV exports", () => {
  const runs = [{ id: "a", name: "run" }];
  const configs = { a: { "args.lr": 1, args: { lr: 2 } } };
  const result = computeGroupedMetric(
    [{ run_id: "a", step: 1, loss: 3 }],
    "loss", "step", runs, configs, ["args.lr", '@["args","lr"]'],
  );
  const [, summary] = groupedCsvExports(result, "loss", "step", []);
  expect(summary.rows[0]).toMatchObject({ 'config.["args.lr"]': 1, "config.args.lr": 2 });
  expect(new Set(summary.columns).size).toBe(summary.columns.length);
});
