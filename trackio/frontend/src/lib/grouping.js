import { buildColorMap } from "./stores.js";

export const PROMOTED_RESERVED_KEYS = Object.freeze({
  _Group: "Group",
  _Username: "Username",
});

function shouldHideKey(key) {
  return key.startsWith("_") && !Object.hasOwn(PROMOTED_RESERVED_KEYS, key);
}

function displayLabelForKey(key) {
  return PROMOTED_RESERVED_KEYS[key] ?? key;
}

const NESTED_PREFIX = "@";
export const UNSET_VALUE = "__trackio_unset__";

function pathForKey(key) {
  if (key.startsWith(`${NESTED_PREFIX}[`)) {
    try {
      const path = JSON.parse(key.slice(1));
      if (Array.isArray(path) && path.every((part) => typeof part === "string")) return path;
    } catch {
      // A literal config key may happen to begin with "@[".
    }
  }
  return [key];
}

export function configPathLabel(key) {
  return pathForKey(key).map(displayLabelForKey).join(".");
}

export function getConfigValue(config, key) {
  let value = config;
  for (const part of pathForKey(key)) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

export function configForRun(run, runConfigs) {
  return (runConfigs ?? {})[run.id] ?? (runConfigs ?? {})[run.name] ?? {};
}

export function valueToken(value) {
  if (value == null) return UNSET_VALUE;
  return JSON.stringify([typeof value, value]);
}

export function valueLabel(value) {
  if (value == null) return "(unset)";
  if (typeof value === "string" && (
    value === "" || value === "(unset)" || value === "true" || value === "false"
    || Number.isFinite(Number(value))
  )) return JSON.stringify(value);
  return String(value);
}

function collectScalarPaths(config, prefix, regularKeys, nonScalarKeys) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return;
  for (const [part, value] of Object.entries(config)) {
    if (shouldHideKey(part)) continue;
    const path = [...prefix, part];
    const key = path.length === 1 ? part : `${NESTED_PREFIX}${JSON.stringify(path)}`;
    if (value == null) continue;
    if (Array.isArray(value)) {
      nonScalarKeys.add(key);
    } else if (typeof value === "object") {
      nonScalarKeys.add(key);
      collectScalarPaths(value, path, regularKeys, nonScalarKeys);
    } else {
      regularKeys.add(key);
    }
  }
}

function promotedKeyHasVariance(runConfigs, key) {
  const seen = new Set();
  for (const cfg of Object.values(runConfigs ?? {})) {
    if (!cfg || typeof cfg !== "object") continue;
    const raw = cfg[key];
    const label = raw === null || raw === undefined ? "(unset)" : String(raw);
    seen.add(label);
    if (seen.size >= 2) return true;
  }
  return false;
}

export function computeGroupByOptions(runConfigs) {
  const promoted = Object.keys(PROMOTED_RESERVED_KEYS)
    .filter((k) => promotedKeyHasVariance(runConfigs, k))
    .map((k) => ({ label: displayLabelForKey(k), value: k }));
  const surfacedPromotedLabels = new Set(promoted.map((o) => o.label));

  const regularKeys = new Set();
  const nonScalarKeys = new Set();
  for (const cfg of Object.values(runConfigs ?? {})) {
    collectScalarPaths(cfg, [], regularKeys, nonScalarKeys);
  }
  for (const key of nonScalarKeys) regularKeys.delete(key);
  for (const key of Object.keys(PROMOTED_RESERVED_KEYS)) regularKeys.delete(key);
  for (const key of surfacedPromotedLabels) regularKeys.delete(key);
  const regular = [...regularKeys].sort((a, b) => configPathLabel(a).localeCompare(configPathLabel(b)))
    .map((k) => ({ label: configPathLabel(k), value: k }));
  return [{ label: "None", value: null }, ...promoted, ...regular];
}

export function computeConfigValueOptions(runConfigs, key, runs = null) {
  if (!key) return [];
  const values = new Map();
  const configs = runs
    ? runs.map((run) => configForRun(run, runConfigs))
    : Object.values(runConfigs ?? {});
  for (const config of configs) {
    const raw = getConfigValue(config, key);
    values.set(valueToken(raw), { label: valueLabel(raw), value: valueToken(raw) });
  }
  return [...values.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function filterRunsByConfig(runs, runConfigs, filters) {
  const active = (filters ?? []).filter((f) => f.key && f.value != null);
  if (!active.length) return runs;
  return runs.filter((run) => {
    const config = configForRun(run, runConfigs);
    return active.every((f) => valueToken(getConfigValue(config, f.key)) === f.value);
  });
}

export function groupForRun(run, runConfigs, groupBy) {
  const keys = Array.isArray(groupBy) ? groupBy : groupBy ? [groupBy] : [];
  const config = configForRun(run, runConfigs);
  const values = keys.map((key) => getConfigValue(config, key));
  const label = keys.length === 1
    ? valueLabel(values[0])
    : keys.map((key, i) => `${configPathLabel(key)}=${valueLabel(values[i])}`).join(" | ");
  return {
    id: JSON.stringify(values.map(valueToken)),
    label,
    values,
  };
}

export function buildRunGroups(runs, runConfigs, groupBy) {
  return new Map(runs.map((run) => [
    run.id ?? run.name,
    groupForRun(run, runConfigs, groupBy),
  ]));
}

export function buildGroupColorMap(runs, runConfigs, groupBy) {
  const ids = [...new Set(runs.map((run) => groupForRun(run, runConfigs, groupBy).id))];
  return buildColorMap(ids);
}

export function computeGroupedRuns(filteredRuns, runConfigs, groupBy) {
  if (!groupBy || (Array.isArray(groupBy) && groupBy.length === 0)) return null;
  const groups = new Map();
  for (const run of filteredRuns) {
    const label = groupForRun(run, runConfigs, groupBy).label;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(run);
  }
  return groups;
}

export function computeGroupedRunEntries(filteredRuns, runConfigs, groupBy) {
  if (!groupBy?.length) return null;
  const groups = new Map();
  for (const run of filteredRuns) {
    const group = groupForRun(run, runConfigs, groupBy);
    if (!groups.has(group.id)) groups.set(group.id, { label: group.label, runs: [] });
    groups.get(group.id).runs.push(run);
  }
  return groups;
}
