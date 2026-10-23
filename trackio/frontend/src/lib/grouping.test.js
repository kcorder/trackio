import { describe, expect, test } from "vitest";
import {
  computeGroupByOptions,
  computeGroupedRuns,
  computeGroupedRunEntries,
  buildGroupColorMap,
  computeConfigValueOptions,
  filterRunsByConfig,
  groupForRun,
  valueToken,
} from "./grouping.js";
import { DEFAULT_COLORS } from "./stores.js";

const none = { label: "None", value: null };
const opt = (label, value) => ({ label, value: value ?? label });

describe("computeGroupByOptions", () => {
  test("returns just the None option when there are no configs", () => {
    expect(computeGroupByOptions({})).toEqual([none]);
    expect(computeGroupByOptions(null)).toEqual([none]);
    expect(computeGroupByOptions(undefined)).toEqual([none]);
  });

  test("collects the union of keys across all runs, sorted", () => {
    const configs = {
      "run-a": { lr: 0.01, model: "resnet" },
      "run-b": { lr: 0.02, seed: 42 },
    };
    expect(computeGroupByOptions(configs)).toEqual([
      none,
      opt("lr"),
      opt("model"),
      opt("seed"),
    ]);
  });

  test("ignores keys whose value is null or undefined", () => {
    const configs = {
      "run-a": { lr: 0.01, dropped: null },
      "run-b": { lr: 0.02, dropped: undefined, kept: "yes" },
    };
    expect(computeGroupByOptions(configs)).toEqual([none, opt("kept"), opt("lr")]);
  });

  test("tolerates non-object config entries", () => {
    const configs = {
      "run-a": { lr: 0.01 },
      "run-b": null,
      "run-c": "not-a-config",
    };
    expect(computeGroupByOptions(configs)).toEqual([none, opt("lr")]);
  });

  test("surfaces nested scalar keys but excludes object and array values", () => {
    const configs = {
      "run-a": { optimizer: { lr: 0.01 }, tags: ["a", "b"], seed: 42 },
      "run-b": { optimizer: { lr: 0.02 }, tags: ["c"], seed: 7 },
    };
    expect(computeGroupByOptions(configs)).toEqual([
      none, opt("optimizer.lr", '@["optimizer","lr"]'), opt("seed"),
    ]);
  });

  test("excludes keys where any run has an object value even if others are scalar", () => {
    const configs = {
      "run-a": { optimizer: "adam", seed: 42 },
      "run-b": { optimizer: { type: "adam", lr: 0.01 }, seed: 7 },
    };
    expect(computeGroupByOptions(configs)).toEqual([
      none, opt("optimizer.lr", '@["optimizer","lr"]'),
      opt("optimizer.type", '@["optimizer","type"]'), opt("seed"),
    ]);
  });

  test("hides reserved underscore-prefixed keys", () => {
    const configs = {
      "run-a": {
        _Username: "saba",
        _Created: "2026-05-18T00:00:00Z",
        lr: 0.01,
      },
    };
    expect(computeGroupByOptions(configs)).toEqual([none, opt("lr")]);
  });

  test("promotes _Group to 'Group' and pins it after None", () => {
    const configs = {
      "run-a": { _Group: "exp-1", framework: "pytorch", lr: 0.01 },
      "run-b": { _Group: "exp-2", framework: "pytorch", lr: 0.02 },
    };
    expect(computeGroupByOptions(configs)).toEqual([
      none,
      { label: "Group", value: "_Group" },
      opt("framework"),
      opt("lr"),
    ]);
  });

  test("omits 'Group' when no run sets _Group to a real value", () => {
    const configs = {
      "run-a": { _Group: null, lr: 0.01 },
      "run-b": { _Group: undefined, lr: 0.02 },
    };
    expect(computeGroupByOptions(configs)).toEqual([none, opt("lr")]);
  });

  test("does not surface a user-defined key named 'Group' as a duplicate", () => {
    const configs = {
      "run-a": { _Group: "exp-1", Group: "user-1", lr: 0.01 },
      "run-b": { _Group: "exp-2", Group: "user-2", lr: 0.02 },
    };
    const options = computeGroupByOptions(configs);
    expect(options.filter((o) => o.label === "Group")).toHaveLength(1);
    expect(options).toEqual([none, { label: "Group", value: "_Group" }, opt("lr")]);
  });

  test("surfaces a user-defined 'Group' key when _Group has no variance", () => {
    const configs = {
      "run-a": { Group: "team-a", lr: 0.01 },
      "run-b": { Group: "team-b", lr: 0.02 },
    };
    expect(computeGroupByOptions(configs)).toEqual([none, opt("Group"), opt("lr")]);
  });

  test("promotes _Username to 'Username' when usernames vary", () => {
    const configs = {
      "run-a": { _Username: "alice", lr: 0.01 },
      "run-b": { _Username: "bob", lr: 0.02 },
    };
    expect(computeGroupByOptions(configs)).toEqual([
      none,
      { label: "Username", value: "_Username" },
      opt("lr"),
    ]);
  });

  test("hides 'Username' in a single-user project (all values equal)", () => {
    const configs = {
      "run-a": { _Username: "alice", lr: 0.01 },
      "run-b": { _Username: "alice", lr: 0.02 },
    };
    expect(computeGroupByOptions(configs)).toEqual([none, opt("lr")]);
  });

  test("hides 'Group' when every run shares the same group value", () => {
    const configs = {
      "run-a": { _Group: "exp-1", lr: 0.01 },
      "run-b": { _Group: "exp-1", lr: 0.02 },
    };
    expect(computeGroupByOptions(configs)).toEqual([none, opt("lr")]);
  });

  test("orders promoted keys by declaration: Group before Username", () => {
    const configs = {
      "run-a": { _Group: "exp-1", _Username: "alice" },
      "run-b": { _Group: "exp-2", _Username: "bob" },
    };
    expect(computeGroupByOptions(configs)).toEqual([
      none,
      { label: "Group", value: "_Group" },
      { label: "Username", value: "_Username" },
    ]);
  });

  test("includes 'Group' when some runs have a value and others are unset", () => {
    const configs = {
      "run-a": { _Group: "exp-1", lr: 0.01 },
      "run-b": { _Group: null, lr: 0.02 },
    };
    expect(computeGroupByOptions(configs)).toEqual([
      none,
      { label: "Group", value: "_Group" },
      opt("lr"),
    ]);
  });
});

describe("config filtering and multi-field grouping", () => {
  const runs = [
    { id: "a", name: "same" }, { id: "b", name: "same" },
    { id: "c", name: "other" },
  ];
  const configs = {
    a: { args: { lr: 0.01, optimizer: "adam" }, seed: 1 },
    b: { args: { lr: 0.01, optimizer: "sgd" }, seed: 1 },
    c: { args: { lr: "0.01", optimizer: "adam" }, seed: 2 },
  };
  const lr = '@["args","lr"]';
  const optimizer = '@["args","optimizer"]';

  test("filters by nested values with AND and preserves numeric types", () => {
    const filters = [
      { key: lr, value: valueToken(0.01) },
      { key: optimizer, value: valueToken("adam") },
    ];
    expect(filterRunsByConfig(runs, configs, filters)).toEqual([runs[0]]);
    expect(filterRunsByConfig(runs, configs, [{ key: lr, value: valueToken("0.01") }])).toEqual([runs[2]]);
    expect(computeConfigValueOptions(configs, lr)).toContainEqual({
      label: '"0.01"', value: valueToken("0.01"),
    });
  });

  test("offers unset as an explicit filter value", () => {
    const options = computeConfigValueOptions({ a: { seed: 1 }, b: {} }, "seed");
    expect(options).toContainEqual({ label: "(unset)", value: valueToken(undefined) });
    const missingConfig = computeConfigValueOptions({ a: { seed: 1 } }, "seed", runs);
    expect(missingConfig).toContainEqual({ label: "(unset)", value: valueToken(undefined) });
  });

  test("uses all selected fields and run IDs for group identity", () => {
    const group = groupForRun(runs[0], configs, [lr, optimizer]);
    expect(group.label).toBe("args.lr=0.01 | args.optimizer=adam");
    expect(groupForRun(runs[1], configs, [lr, optimizer]).id).not.toBe(group.id);
    const grouped = computeGroupedRunEntries(runs, configs, [lr, optimizer]);
    expect(grouped.size).toBe(3);
  });
});

describe("computeGroupedRuns", () => {
  const runs = [
    { id: "1", name: "run-a" },
    { id: "2", name: "run-b" },
    { id: "3", name: "run-c" },
  ];
  const configs = {
    "run-a": { lr: 0.01, model: "resnet" },
    "run-b": { lr: 0.01, model: "vit" },
    "run-c": { lr: 0.02, model: "resnet" },
  };

  test("returns null when no field is selected", () => {
    expect(computeGroupedRuns(runs, configs, null)).toBeNull();
    expect(computeGroupedRuns(runs, configs, "")).toBeNull();
  });

  test("buckets runs by stringified config value", () => {
    const groups = computeGroupedRuns(runs, configs, "lr");
    expect([...groups.keys()]).toEqual(["0.01", "0.02"]);
    expect(groups.get("0.01").map((r) => r.name)).toEqual(["run-a", "run-b"]);
    expect(groups.get("0.02").map((r) => r.name)).toEqual(["run-c"]);
  });

  test("puts runs with missing config values into '(unset)'", () => {
    const groups = computeGroupedRuns(
      [...runs, { id: "4", name: "run-d" }],
      configs,
      "lr",
    );
    expect(groups.get("(unset)").map((r) => r.name)).toEqual(["run-d"]);
  });

  test("treats null and undefined config values as '(unset)'", () => {
    const groups = computeGroupedRuns(
      [{ id: "1", name: "r" }],
      { r: { lr: null } },
      "lr",
    );
    expect([...groups.keys()]).toEqual(["(unset)"]);
  });

  test("preserves bucket insertion order (first run wins)", () => {
    const groups = computeGroupedRuns(runs, configs, "model");
    expect([...groups.keys()]).toEqual(["resnet", "vit"]);
  });

  test("groups by _Group key directly", () => {
    const groupedConfigs = {
      "run-a": { _Group: "exp-1" },
      "run-b": { _Group: "exp-2" },
      "run-c": { _Group: "exp-1" },
    };
    const groups = computeGroupedRuns(runs, groupedConfigs, "_Group");
    expect([...groups.keys()]).toEqual(["exp-1", "exp-2"]);
    expect(groups.get("exp-1").map((r) => r.name)).toEqual(["run-a", "run-c"]);
    expect(groups.get("exp-2").map((r) => r.name)).toEqual(["run-b"]);
  });

  test("groups by a literal 'Group' user config key", () => {
    const groupedConfigs = {
      "run-a": { Group: "team-a" },
      "run-b": { Group: "team-b" },
      "run-c": { Group: "team-a" },
    };
    const groups = computeGroupedRuns(runs, groupedConfigs, "Group");
    expect([...groups.keys()]).toEqual(["team-a", "team-b"]);
    expect(groups.get("team-a").map((r) => r.name)).toEqual(["run-a", "run-c"]);
    expect(groups.get("team-b").map((r) => r.name)).toEqual(["run-b"]);
  });
});

describe("buildGroupColorMap", () => {
  test("gives each distinct group a stable palette color shared by the sidebar and plots", () => {
    const runs = [
      { id: "a", name: "a" }, { id: "b", name: "b" },
      { id: "c", name: "c" }, { id: "d", name: "d" },
    ];
    const configs = {
      a: { model: "rnn" }, b: { model: "cnn" },
      c: { model: "rnn" }, d: { model: "transformer" },
    };
    const groups = computeGroupedRunEntries(runs, configs, ["model"]);
    const colors = buildGroupColorMap(runs, configs, ["model"]);
    expect([...groups.keys()].map((id) => colors[id])).toEqual(DEFAULT_COLORS.slice(0, 3));
    expect(colors[groupForRun(runs[0], configs, ["model"]).id])
      .toBe(colors[groupForRun(runs[2], configs, ["model"]).id]);
    expect(colors[groupForRun(runs[3], configs, ["model"]).id]).toBe(DEFAULT_COLORS[2]);
  });

  test("cycles the existing palette when there are more groups than colors", () => {
    const runs = Array.from({ length: DEFAULT_COLORS.length + 1 }, (_, i) => ({ id: String(i) }));
    const configs = Object.fromEntries(runs.map((run) => [run.id, { model: run.id }]));
    const colors = buildGroupColorMap(runs, configs, ["model"]);
    expect(colors[groupForRun(runs.at(-1), configs, ["model"]).id]).toBe(DEFAULT_COLORS[0]);
  });
});
