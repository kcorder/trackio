import { parseConfigFilters } from "./runFilters.js";
const VERSION = 1;
const PREFIX = "trackio.views";
export const VIEW_DEFAULTS = {
  configFilters: [], groupByKeys: [], bandMethod: "range", showGroupedMean: true,
  filterText: "", metricFilter: "", smoothing: 10, xAxis: "step",
  logScaleX: false, logScaleY: false, panelsPerRow: "auto", configColumns: [],
};
export function normalizeView(value) {
  const result = structuredClone(VIEW_DEFAULTS);
  if (!value || typeof value !== "object") return result;
  for (const [key, fallback] of Object.entries(VIEW_DEFAULTS)) {
    if (Array.isArray(fallback)) {
      if (Array.isArray(value[key])) result[key] = structuredClone(value[key]);
    } else if (typeof value[key] === typeof fallback) result[key] = value[key];
  }
  result.configFilters = parseConfigFilters(JSON.stringify(result.configFilters));
  result.groupByKeys = result.groupByKeys.filter((key) => typeof key === "string");
  result.configColumns = result.configColumns.filter((key) => { try { return Array.isArray(JSON.parse(key)); } catch { return false; } });
  if ([1,2,3,4,5,6].includes(value.panelsPerRow)) result.panelsPerRow = value.panelsPerRow;
  if (!Number.isFinite(result.smoothing)) result.smoothing = 10;
  if (!["range", "std"].includes(result.bandMethod)) result.bandMethod = "range";
  return result;
}
export function viewStorageKey(project, base = globalThis.window?.__trackio_base ?? "") {
  return `${PREFIX}:${base}:${project}`;
}
export function readViews(key, storage = null) {
  try {
    const data = JSON.parse((storage ?? globalThis.localStorage).getItem(key));
    if (data?.version !== VERSION) return { version: VERSION, named: {}, latest: null };
    return { version: VERSION, named: data.named && typeof data.named === "object" ? data.named : {}, latest: data.latest ? normalizeView(data.latest) : null };
  } catch {
    return { version: VERSION, named: {}, latest: null };
  }
}
export function writeViews(key, data, storage = null) {
  try {
    (storage ?? globalThis.localStorage).setItem(key, JSON.stringify({ ...data, version: VERSION }));
    return true;
  } catch {
    return false;
  }
}
