import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import LinePlot from "../components/LinePlot.svelte";
import BarPlot from "../components/BarPlot.svelte";
import embed from "vega-embed";
import { downloadChartImage } from "../lib/chartImage.js";

vi.mock("vega-embed", () => ({ default: vi.fn() }));
vi.mock("vega", () => ({
  changeset: () => ({ remove() { return this; }, insert() { return this; } }),
  truthy: () => true,
}));
vi.mock("../lib/chartImage.js", () => ({ downloadChartImage: vi.fn() }));

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
    trigger() { this.callback([{ isIntersecting: true }]); }
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  const view = {
    width() { return this; },
    resize() { return this; },
    run() { return this; },
    change() { return this; },
    finalize() {},
  };
  embed.mockResolvedValue({ view });
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target.remove();
  vi.unstubAllGlobals();
});

async function exportPlot(Plot, props) {
  component = mount(Plot, { target, props });
  await tick();
  observers[0].trigger();
  await vi.waitFor(() => expect(embed).toHaveBeenCalled());
  target.querySelector('[aria-label="Download this chart as a PNG image"]').click();
  await vi.waitFor(() => expect(downloadChartImage).toHaveBeenCalled());
  return downloadChartImage.mock.calls[0][0];
}

describe("chart PNG export wiring", () => {
  const names = Array.from({ length: 8 }, (_, index) => `group-${index}`);
  const colorMap = Object.fromEntries(names.map((name, index) => [name, `#00000${index}`]));

  test("line chart exports every group with the plotted colors", async () => {
    const data = names.map((name) => ({ step: 1, loss: 0.5, series_key: name, run: name }));
    const options = await exportPlot(LinePlot, {
      data, x: "step", y: "loss", title: "Loss", colorField: "series_key",
      colorDisplayField: "run", colorMap, rangeBand: true,
    });
    expect(options.title).toBe("Loss");
    expect(options.rangeBand).toBe(true);
    expect(options.legendEntries).toHaveLength(8);
    expect(options.legendEntries.map((entry) => entry.color)).toEqual(names.map((name) => colorMap[name]));
  });

  test("bar chart exports only plotted series with the plotted colors", async () => {
    const data = names.map((name) => ({ loss: 0.5, series_key: name, run: name }));
    data.push({ loss: null, series_key: "missing", run: "missing" });
    const options = await exportPlot(BarPlot, {
      data, y: "loss", title: "Loss", colorField: "series_key",
      colorDisplayField: "run", colorMap,
    });
    expect(options.legendEntries).toHaveLength(8);
    expect(options.legendEntries.map((entry) => entry.color)).toEqual(names.map((name) => colorMap[name]));
  });
});
