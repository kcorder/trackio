import { afterEach, describe, expect, test, vi } from "vitest";
import { downloadChartImage, layoutImageLegend, wrapImageText } from "./chartImage.js";
import { buildGroupColorMap, groupForRun } from "./grouping.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--background-fill-primary");
  document.documentElement.style.removeProperty("--body-text-color");
});

describe("chart PNG legend layout", () => {
  test("wraps long labels without dropping characters", () => {
    const label = "model=very_long_configuration_value";
    const lines = wrapImageText(label, 60, (text) => text.length * 6);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(label);
  });

  test("keeps every plotted group and its actual palette color", () => {
    const runs = Array.from({ length: 8 }, (_, index) => ({ id: `run-${index}`, name: `run-${index}` }));
    const configs = Object.fromEntries(runs.map((run) => [run.id, { args: { model: run.id } }]));
    const keys = ['@["args","model"]'];
    const colors = buildGroupColorMap(runs, configs, keys);
    const entries = runs.map((run) => {
      const group = groupForRun(run, configs, keys);
      return { name: group.label, color: colors[group.id] };
    });
    const rows = layoutImageLegend(entries, [], 360, (text) => text.length * 6, true);
    expect(rows).toHaveLength(9);
    expect(rows.slice(0, 8).map((row) => row.color)).toEqual(entries.map((entry) => entry.color));
    expect(rows.at(-1).lines.join("")).toContain("observed run range");
  });

  test("composes title, full legend, and band into a downloadable PNG", async () => {
    const texts = [];
    const fills = [];
    const context = {
      fillStyle: "",
      measureText: (text) => ({ width: text.length * 6 }),
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn((text) => texts.push(text)),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill() { fills.push(this.fillStyle); },
      setLineDash: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("Image", class {
      naturalWidth = 800;
      naturalHeight = 600;
      set src(_value) { queueMicrotask(() => this.onload()); }
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:chart"),
      revokeObjectURL: vi.fn(),
    });
    document.documentElement.style.setProperty("--background-fill-primary", "#101010");
    document.documentElement.style.setProperty("--body-text-color", "#ffffff");
    const view = {
      runAsync: vi.fn(),
      toImageURL: vi.fn().mockResolvedValue("data:image/png;base64,chart"),
    };

    await downloadChartImage({
      view,
      filename: "metric.png",
      title: "Win rate",
      legendEntries: [
        { name: "small", color: "#ff0000" },
        { name: "large", color: "#00ff00" },
      ],
      rangeBand: true,
    });

    expect(view.toImageURL).toHaveBeenCalledWith("png", 4);
    expect(texts).toContain("Win rate");
    expect(texts).toContain("small");
    expect(texts).toContain("large");
    expect(fills).toContain("#ff0000");
    expect(fills).toContain("#00ff00");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 240, expect.any(Number));
  });
});
