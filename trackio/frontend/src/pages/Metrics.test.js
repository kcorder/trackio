import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import Metrics from "./Metrics.svelte";
import MetricsGroupingTestHarness from "./MetricsGroupingTestHarness.svelte";
import { getLogsBatch } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({ getLogsBatch: vi.fn() }));
vi.mock("vega-embed", () => ({ default: vi.fn() }));
vi.mock("vega", () => ({}));

let component;
let target;
let observers;

beforeEach(() => {
  vi.resetAllMocks();
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
    trigger(isIntersecting) {
      this.callback([{ isIntersecting }]);
    }
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  target = document.createElement("div");
  document.body.appendChild(target);
  getLogsBatch.mockImplementation(async (_project, runs) => runs.map((run) => ({
    run_id: run.id,
    run: run.name,
    logs: [{ step: 0, loss: 1 }, { step: 1, loss: 0.5 }],
  })));
});

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target.remove();
  vi.unstubAllGlobals();
});

describe("Metrics loading", () => {
  test("loads many runs progressively without preparing offscreen plots", async () => {
    const runs = Array.from({ length: 17 }, (_, index) => ({ id: `run-${index}`, name: `run-${index}` }));
    component = mount(Metrics, { target, props: {
      project: "demo",
      selectedRuns: runs,
      allRuns: runs,
      appBootstrapReady: true,
      realtimeEnabled: false,
      smoothing: 0,
    } });
    await vi.waitFor(() => expect(getLogsBatch).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(target.querySelectorAll(".plot-slot")).toHaveLength(1));
    expect(getLogsBatch.mock.calls.map((call) => call[1].length)).toEqual([8, 8, 1]);
    expect(target.querySelector(".plot-container")).toBeNull();
    observers[0].trigger(true);
    await tick();
    expect(target.querySelector(".plot-container")).not.toBeNull();
    observers[0].trigger(false);
    await tick();
    expect(target.querySelector(".plot-container")).not.toBeNull();
  });

  test("keeps a mounted chart after grouping and a later offscreen event", async () => {
    component = mount(MetricsGroupingTestHarness, { target });
    await vi.waitFor(() => expect(target.querySelectorAll(".plot-slot")).toHaveLength(1));
    observers[0].trigger(true);
    await tick();
    expect(target.querySelector(".plot-container")).not.toBeNull();
    target.querySelector("button").click();
    await tick();
    expect(target.querySelector(".plot-container")).not.toBeNull();
    observers[0].trigger(false);
    await tick();
    expect(target.querySelector(".plot-container")).not.toBeNull();
  });
});
