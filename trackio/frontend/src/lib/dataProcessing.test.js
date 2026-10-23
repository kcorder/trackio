import { describe, expect, test } from "vitest";
import {
  computeMetricPlotData,
  downsample,
  processRunData,
  summarizeMetricRows,
} from "./dataProcessing.js";

describe("summarizeMetricRows", () => {
  test("finds metrics and single-point plots in one pass over sparse rows", () => {
    const rows = [
      { step: 0, series_key: "a", loss: 1, accuracy: 0.5 },
      { step: 1, series_key: "a", loss: 0.8 },
      { step: 0, series_key: "b", loss: 0.7, accuracy: 0.6 },
    ];
    const result = summarizeMetricRows(rows, "step");
    expect(result.metrics).toEqual(["loss", "accuracy"]);
    expect(result.singlePointMetrics).toEqual(new Set(["accuracy"]));
  });
});

describe("dense plot sampling", () => {
  test("bounds plotted points across many runs without changing source rows", () => {
    const rows = Array.from({ length: 70 }, (_, run) =>
      Array.from({ length: 3000 }, (_, step) => ({
        step,
        loss: Math.sin(step / 100),
        series_key: `run-${run}`,
        data_type: "original",
      })),
    ).flat();
    const plot = computeMetricPlotData(rows, "step", "loss", null);
    expect(rows).toHaveLength(210000);
    expect(plot.data.length).toBeLessThanOrEqual(5000);
    expect(new Set(plot.data.map((row) => row.series_key)).size).toBe(70);
  });

  test("keeps only the extremes when thousands of values share one x position", () => {
    const rows = Array.from({ length: 3000 }, (_, index) => ({
      step: 0,
      loss: index / 3000,
      series_key: "run-a",
    }));
    const plot = computeMetricPlotData(rows, "step", "loss", null);
    expect(plot.data).toHaveLength(2);
    expect(plot.data.map((row) => row.loss)).toEqual([0, 2999 / 3000]);
  });
});

describe("processRunData smoothing", () => {
  test("does not fabricate values for rows that did not log the metric", () => {
    const logs = [
      { step: 0, "train/loss": 1.0 },
      { step: 0, "train/loss": 1.1 },
      { step: 0, "train/loss": 0.9 },
      { step: 0, epoch: 0, "train/avg_loss": 1.0 },
      { step: 1, "train/loss": 0.8 },
      { step: 1, "train/loss": 0.7 },
      { step: 1, "train/loss": 0.75 },
      { step: 1, epoch: 1, "train/avg_loss": 0.75 },
    ];

    const { rows } = processRunData(logs, "run-1", 10, "step", false, false);

    const epochSmoothed = rows.filter(
      (r) => r.data_type === "smoothed" && r.epoch != null,
    );
    expect(epochSmoothed.length).toBe(2);
    expect(epochSmoothed.map((r) => r.step).sort()).toEqual([0, 1]);
  });

  test("computeMetricPlotData returns one point per logged epoch", () => {
    const logs = [
      { step: 0, "train/loss": 1.0 },
      { step: 0, "train/loss": 1.1 },
      { step: 0, epoch: 0 },
      { step: 1, "train/loss": 0.8 },
      { step: 1, "train/loss": 0.7 },
      { step: 1, epoch: 1 },
      { step: 2, "train/loss": 0.6 },
      { step: 2, epoch: 2 },
    ];
    const { rows } = processRunData(logs, "run-1", 10, "step", false, false);
    const { data } = computeMetricPlotData(rows, "step", "epoch", null);
    const originals = data.filter((r) => r.data_type === "original");
    const smoothed = data.filter((r) => r.data_type === "smoothed");
    expect(originals.length).toBe(3);
    expect(smoothed.length).toBe(3);
  });

  test("dense metrics are still smoothed across all rows", () => {
    const logs = [
      { step: 0, loss: 1.0 },
      { step: 1, loss: 0.9 },
      { step: 2, loss: 0.8 },
      { step: 3, loss: 0.7 },
      { step: 4, loss: 0.6 },
    ];
    const { rows } = processRunData(logs, "run-1", 3, "step", false, false);
    const smoothed = rows.filter((r) => r.data_type === "smoothed");
    expect(smoothed.length).toBe(5);
    expect(smoothed.every((r) => typeof r.loss === "number")).toBe(true);
  });

  test("falls back to step when a requested custom x-axis is unavailable", () => {
    const logs = [
      { step: 0, loss: 1.0 },
      { step: 1, loss: 0.9 },
    ];

    const result = processRunData(
      logs,
      "run-1",
      0,
      "missing_axis",
      false,
      false,
    );

    expect(result.xColumn).toBe("step");
  });

  test("keeps downsampled bins stable as points are appended", () => {
    let previousSteps;
    for (let length = 500; length <= 504; length += 1) {
      const rows = Array.from({ length }, (_, step) => ({
        step,
        value: step,
        series_key: "run-1",
      }));
      const result = downsample(
        rows,
        "step",
        "value",
        "series_key",
        null,
      );
      const steps = new Set(result.data.map((row) => row.step));

      if (previousSteps) {
        const changed = [
          ...[...steps].filter((step) => !previousSteps.has(step)),
          ...[...previousSteps].filter((step) => !steps.has(step)),
        ];
        expect(changed.length).toBeLessThanOrEqual(2);
      }
      previousSteps = steps;
    }
  });
});
