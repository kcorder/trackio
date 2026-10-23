<script>
  import { onMount, untrack } from "svelte";
  import { getQueryParam } from "../lib/router.js";
  import LinePlot from "../components/LinePlot.svelte";
  import BarPlot from "../components/BarPlot.svelte";
  import HistogramPlot from "../components/HistogramPlot.svelte";
  import Accordion from "../components/Accordion.svelte";
  import LoadingTrackio from "../components/LoadingTrackio.svelte";
  import RunComparer from "../components/RunComparer.svelte";
  import { getLogsBatch } from "../lib/api.js";
  import {
    createPollingTask,
    effectiveMetricRefreshInterval,
    isRateLimitCooldownActive,
    isTabHidden,
  } from "../lib/hostPolling.js";
  import {
    processRunData,
    summarizeMetricRows,
    groupMetricsByPrefix,
    filterMetricsByRegex,
    computeMetricPlotData,
    logsHaveNewData,
  } from "../lib/dataProcessing.js";
  import { buildColorMap } from "../lib/stores.js";
  import { buildGroupColorMap, buildRunGroups } from "../lib/grouping.js";
  import { computeGroupedMetric, groupedCsvExports, buildRawGroupedRows } from "../lib/groupedMetrics.js";
  import { registerSnapshotProvider } from "../lib/viewState.js";
  import {
    AUTO_PANELS_PER_ROW,
    getPlotColumns,
    isAutoPanels,
  } from "../lib/plotLayout.js";

  let {
    project = null,
    selectedRuns = [],
    allRuns = [],
    runConfigs = {},
    groupByKeys = [],
    showGroupedMean = true,
    smoothing = 10,
    panelsPerRow = AUTO_PANELS_PER_ROW,
    xAxis = "step",
    logScaleX = false,
    logScaleY = false,
    metricFilter = "",
    showHeaders = true,
    showComparer = false,
    appBootstrapReady = false,
    plotOrder = [],
    realtimeEnabled = true,
    refreshInterval = "auto",
    syncToken = 0,
    // eslint-disable-next-line no-useless-assignment -- bindable out-prop to parent
    metricColumns = $bindable([]),
  } = $props();

  let masterData = $state([]);
  let xColumn = $state("step");
  let metrics = $state([]);
  let histogramMetrics = $state([]);
  let histogramItems = $state({});
  let singlePointMetrics = $state(new Set());
  let xLim = $state(null);
  let hasLoaded = $state(false);
  let metricOrder = $state({});
  let dragState = $state({ group: null, index: -1 });
  let pageElement = $state(null);

  let rawDataCache = new Map();
  let processedDataCache = new Map();
  let cacheProject = null;
  let nearMetrics = $state(new Set());
  let lastSyncToken = null;
  let refreshTimer = null;
  const refreshTask = createPollingTask();
  const MAX_BATCH_RUNS = 64;
  const INITIAL_BATCH_RUNS = 8;

  let colorMap = $derived(buildColorMap(allRuns));
  let groupedMode = $derived(showGroupedMean && groupByKeys.length > 0);
  let runGroups = $derived(buildRunGroups(selectedRuns, runConfigs, groupByKeys));
  let groupCache = $derived.by(() => {
    masterData;
    selectedRuns;
    runConfigs;
    groupByKeys;
    return new Map();
  });
  let plotCache = $derived.by(() => {
    masterData;
    xColumn;
    xLim;
    selectedRuns;
    runConfigs;
    groupByKeys;
    showGroupedMean;
    return new Map();
  });
  let plotColorMap = $derived.by(() => {
    if (!groupedMode) return colorMap;
    return buildGroupColorMap(allRuns, runConfigs, groupByKeys);
  });

  let metricGroups = $derived.by(() => {
    let filtered = metricFilter
      ? filterMetricsByRegex(metrics, metricFilter)
      : metrics;
    return groupMetricsByPrefix(filtered, plotOrder);
  });

  let groupNames = $derived(Object.keys(metricGroups));

  let filteredHistogramMetrics = $derived(
    metricFilter
      ? filterMetricsByRegex(histogramMetrics, metricFilter)
      : histogramMetrics,
  );

  function getPlotResult(metric) {
    const cached = plotCache.get(metric);
    if (cached) return cached;
    if (!groupByKeys.length) {
      const result = computeMetricPlotData(masterData, xColumn, metric, xLim);
      plotCache.set(metric, result);
      return result;
    }
    let result = groupCache.get(metric);
    if (!result) {
      result = computeGroupedMetric(masterData, metric, xColumn, selectedRuns, runConfigs, groupByKeys, runGroups);
      groupCache.set(metric, result);
    }
    const csvExports = groupedCsvExports(result, metric, xColumn,
      () => buildRawGroupedRows(rawDataCache, metric, xAxis, selectedRuns, runConfigs, groupByKeys));
    if (!groupedMode) {
      const plot = { ...computeMetricPlotData(masterData, xColumn, metric, xLim), csvExports };
      plotCache.set(metric, plot);
      return plot;
    }
    const visible = xLim
      ? result.rows.filter((row) => row[xColumn] >= xLim[0] && row[xColumn] <= xLim[1])
      : result.rows;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const row of visible) {
      yMin = Math.min(yMin, row.run_min ?? row[metric]);
      yMax = Math.max(yMax, row.run_max ?? row[metric]);
    }
    const plot = {
      data: visible,
      yExtent: visible.length ? [yMin, yMax] : undefined,
      csvExports,
    };
    plotCache.set(metric, plot);
    return plot;
  }

  function observeMetric(node, metric) {
    if (typeof IntersectionObserver === "undefined") {
      nearMetrics = new Set([...nearMetrics, metric]);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const next = new Set(nearMetrics);
      if (entries[entries.length - 1]?.isIntersecting) next.add(metric);
      else next.delete(metric);
      nearMetrics = next;
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
        const next = new Set(nearMetrics);
        next.delete(metric);
        nearMetrics = next;
      },
    };
  }

  let autoLayout = $derived(isAutoPanels(panelsPerRow));

  function getGroupCols(items) {
    return getPlotColumns(panelsPerRow, items.length);
  }

  function getOrderedMetrics(key, items) {
    const order = metricOrder[key];
    if (!order) return items;
    const ordered = [];
    for (const m of order) {
      if (items.includes(m)) ordered.push(m);
    }
    for (const m of items) {
      if (!ordered.includes(m)) ordered.push(m);
    }
    return ordered;
  }

  function handleDragStart(groupKey, index, e) {
    dragState = { group: groupKey, index };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
  }

  function handleDragOver(groupKey, index, e) {
    if (dragState.group !== groupKey) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(groupKey, index, metrics, e) {
    e.preventDefault();
    if (dragState.group !== groupKey || dragState.index === index) {
      dragState = { group: null, index: -1 };
      return;
    }
    const ordered = [...metrics];
    const [moved] = ordered.splice(dragState.index, 1);
    ordered.splice(index, 0, moved);
    metricOrder = { ...metricOrder, [groupKey]: ordered };
    dragState = { group: null, index: -1 };
  }

  function extractHistograms(originals) {
    const latest = new Map();
    for (const r of originals) {
      for (const [key, value] of Object.entries(r)) {
        if (
          !value ||
          typeof value !== "object" ||
          value._type !== "trackio.histogram"
        )
          continue;
        if (!Array.isArray(value.bins) || value.bins.length < 2) continue;
        const mapKey = `${key}\0${r.series_key}`;
        const prev = latest.get(mapKey);
        if (!prev || (r.step ?? 0) >= prev.step) {
          latest.set(mapKey, {
            metric: key,
            key: r.series_key,
            label: r.run,
            step: r.step ?? 0,
            bins: value.bins,
            values: value.values ?? [],
          });
        }
      }
    }
    const byMetric = {};
    for (const item of latest.values()) {
      if (!byMetric[item.metric]) byMetric[item.metric] = [];
      byMetric[item.metric].push(item);
    }
    histogramItems = byMetric;
    histogramMetrics = Object.keys(byMetric).sort();
  }

  function processFromCache() {
    if (!project || selectedRuns.length === 0) {
      masterData = [];
      metrics = [];
      histogramMetrics = [];
      histogramItems = {};
      return;
    }

    const allRows = [];
    const settingsKey = `${smoothing}\0${xAxis}\0${logScaleX}\0${logScaleY}`;
    for (const run of selectedRuns) {
      const runKey = run.id ?? run.name;
      const logs = rawDataCache.get(runKey);
      if (!logs) continue;
      let cached = processedDataCache.get(runKey);
      if (!cached || cached.logs !== logs || cached.settingsKey !== settingsKey || cached.runName !== run.name) {
        cached = {
          logs,
          settingsKey,
          runName: run.name,
          result: processRunData(logs, run, smoothing, xAxis, logScaleX, logScaleY),
        };
        processedDataCache.set(runKey, cached);
      }
      const result = cached.result;
      if (result) {
        allRows.push(...result.rows);
        xColumn = result.xColumn;
      }
    }
    masterData = allRows;

    const originals = allRows.filter(
      (r) => r.data_type === "original" || !r.data_type,
    );
    extractHistograms(originals);
    const summary = summarizeMetricRows(originals, xColumn);
    metrics = summary.metrics;
    metricColumns = summary.availableColumns;
    singlePointMetrics = summary.singlePointMetrics;
  }

  async function fetchLogsForRuns(
    runs,
    requestOptions = {},
    projectName = project,
    chunkSize = MAX_BATCH_RUNS,
    onChunk = null,
  ) {
    const results = [];
    for (let i = 0; i < runs.length; i += chunkSize) {
      const chunk = runs.slice(i, i + chunkSize);
      const batch = await getLogsBatch(
        projectName,
        chunk,
        { scalar_only: true },
        requestOptions,
      );
      if (!onChunk) results.push(...batch);
      if (onChunk) onChunk(batch, i === 0, i + chunk.length >= runs.length);
    }
    return results;
  }

  async function fetchNewRuns(signal) {
    if (!appBootstrapReady) {
      hasLoaded = false;
      return;
    }
    if (!project || selectedRuns.length === 0) {
      masterData = [];
      metrics = [];
      histogramMetrics = [];
      histogramItems = {};
      hasLoaded = true;
      return;
    }

    const requestedProject = project;
    const requestedRuns = selectedRuns;
    const needFetch = requestedRuns.filter((run) => {
      const runKey = run.id ?? run.name;
      return !rawDataCache.has(runKey);
    });
    if (needFetch.length > 0) {
      try {
        await fetchLogsForRuns(
          needFetch,
          { signal },
          requestedProject,
          INITIAL_BATCH_RUNS,
          (batch, first, last) => {
            if (signal.aborted || requestedProject !== project) return;
            for (const entry of batch) {
              const runKey = entry.run_id ?? entry.run;
              rawDataCache.set(runKey, entry.logs);
            }
            if (first || last) {
              processFromCache();
              hasLoaded = true;
            }
          },
        );
        if (signal.aborted || requestedProject !== project) return;
      } catch (e) {
        if (e?.name === "AbortError") return;
        console.error("Failed to load metric logs:", e);
      }
    }

    if (needFetch.length === 0 || !hasLoaded) {
      processFromCache();
    }
    hasLoaded = true;
  }

  async function refreshCachedRuns(force = false) {
    if (!force && (!realtimeEnabled || refreshInterval === 0)) return;
    if (!project || selectedRuns.length === 0) return;
    if (!force && isTabHidden()) return;
    if (!force && isRateLimitCooldownActive()) return;
    if (force) refreshTask.cancel();
    try {
      await refreshTask.run(async (signal) => {
        const requestedProject = project;
        const requestedRuns = selectedRuns;
        const batch = await fetchLogsForRuns(
          requestedRuns,
          { signal },
          requestedProject,
        );
        if (signal.aborted || requestedProject !== project) return;
        let changed = false;
        for (const entry of batch) {
          const runKey = entry.run_id ?? entry.run;
          const logs = entry.logs;
          const prev = rawDataCache.get(runKey);
          if (!prev || logsHaveNewData(prev, logs)) {
            rawDataCache.set(runKey, logs);
            changed = true;
          }
        }
        if (changed) {
          processFromCache();
        }
        hasLoaded = true;
      });
    } catch (e) {
      if (e?.name !== "AbortError") {
        console.error("Failed to refresh metric logs:", e);
      }
    }
  }

  $effect(() => {
    project;
    selectedRuns;
    appBootstrapReady;
    refreshTask.cancel();
    if (cacheProject !== project) {
      rawDataCache = new Map();
      processedDataCache = new Map();
      cacheProject = project;
      hasLoaded = false;
    }
    void refreshTask.run(fetchNewRuns, null);
  });

  $effect(() => {
    if (lastSyncToken === null) {
      lastSyncToken = syncToken;
    } else if (syncToken !== lastSyncToken) {
      lastSyncToken = syncToken;
      untrack(() => void refreshCachedRuns(true));
    }
  });

  $effect(() => {
    smoothing;
    xAxis;
    logScaleX;
    logScaleY;
    if (hasLoaded) {
      processFromCache();
    }
  });

  onMount(() => {
    const xMin = getQueryParam("xmin");
    const xMax = getQueryParam("xmax");
    if (xMin != null && xMin !== "" && xMax != null && xMax !== "") {
      const lo = parseFloat(xMin);
      const hi = parseFloat(xMax);
      if (!Number.isNaN(lo) && !Number.isNaN(hi) && lo < hi) {
        xLim = [lo, hi];
      }
    }
    return () => {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTask.cancel();
    };
  });

  $effect(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    const ms = effectiveMetricRefreshInterval(refreshInterval, selectedRuns.length);
    if (realtimeEnabled && ms > 0) {
      refreshTimer = setInterval(() => void refreshCachedRuns(), ms);
    }
    return () => {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = null;
    };
  });

  function visibleMetricNames() {
    const names = [];
    for (const groupName of groupNames) {
      const group = metricGroups[groupName];
      names.push(...getOrderedMetrics(`${groupName}:direct`, group.direct));
      for (const [subName, subMetrics] of Object.entries(group.subgroups)) {
        names.push(...getOrderedMetrics(`${groupName}:${subName}`, subMetrics));
      }
    }
    return names;
  }

  function visibleClipRect(el) {
    let clip = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowY === "visible" && style.overflowX === "visible") continue;
      const rect = node.getBoundingClientRect();
      clip = {
        top: Math.max(clip.top, rect.top),
        left: Math.max(clip.left, rect.left),
        bottom: Math.min(clip.bottom, rect.bottom),
        right: Math.min(clip.right, rect.right),
      };
    }
    return clip;
  }

  function metricsOnScreen() {
    if (!pageElement) return [];
    const clip = visibleClipRect(pageElement);
    const names = [];
    for (const el of pageElement.querySelectorAll(".plot-container[data-metric]")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const visibleHeight = Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top);
      const visibleWidth = Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left);
      if (visibleHeight >= rect.height / 2 && visibleWidth >= rect.width / 2) {
        names.push(el.dataset.metric);
      }
    }
    return [...new Set(names)];
  }

  function latestX() {
    let latest = null;
    for (const row of masterData) {
      if (row.data_type && row.data_type !== "original") continue;
      const value = row[xColumn];
      if (typeof value === "number" && (latest === null || value > latest)) {
        latest = value;
      }
    }
    return latest;
  }

  onMount(() =>
    registerSnapshotProvider("metrics", () => ({
      x_axis: xColumn,
      x_range: xLim ? [xLim[0], xLim[1]] : null,
      metrics: visibleMetricNames(),
      metrics_on_screen: metricsOnScreen(),
      latest_x: latestX(),
    })),
  );

  function handlePlotSelect(range) {
    if (range && range.length === 2) {
      xLim = range;
    }
  }

  function handleResetZoom() {
    xLim = null;
  }

</script>

<div class="metrics-page" bind:this={pageElement}>
  {#if !appBootstrapReady || !hasLoaded}
    <LoadingTrackio />
  {:else if !project}
    <div class="empty-state">
      <h2>No projects</h2>
      <p>
        Create a project by calling <code>trackio.init(project="…")</code> in your training script.
      </p>
    </div>
  {:else if selectedRuns.length === 0}
    <div class="empty-state">
      <h2>No run selected</h2>
      <p>Select one or more runs in the sidebar.</p>
    </div>
  {:else if masterData.length === 0}
    <div class="empty-state">
      <h2>Start logging with Trackio</h2>
      <p>You can create a new project by calling <code>trackio.init()</code>:</p>
      <pre><code>{'import trackio\ntrackio.init(project="my-project")'}</code></pre>
      <p>Then call <code>trackio.log()</code> to log metrics:</p>
      <pre><code>{'for i in range(10):\n    trackio.log({"loss": 1/(i+1)})'}</code></pre>
      <p>Finally, call <code>trackio.finish()</code> to finish the run:</p>
      <pre><code>{'trackio.finish()'}</code></pre>
    </div>
  {:else}
    {#if showComparer}
      <RunComparer runs={selectedRuns} {runConfigs} {colorMap} />
    {/if}
    {#each groupNames as groupName}
      {@const group = metricGroups[groupName]}
      {@const directKey = `${groupName}:direct`}
      {@const orderedDirect = getOrderedMetrics(directKey, group.direct)}
      {@const directCols = getGroupCols(orderedDirect)}
      {@const directCount = group.direct.length}
      {@const subCount = Object.values(group.subgroups).reduce((a, b) => a + b.length, 0)}
      {@const totalCount = directCount + subCount}

      <Accordion
        label="{groupName} ({totalCount})"
        open={true}
        hidden={!showHeaders}
      >
        {#if orderedDirect.length > 0}
          <div class="plot-grid" class:auto={autoLayout} style="--cols: {directCols}">
            {#each orderedDirect as metric, i}
              <div class="plot-slot" use:observeMetric={metric}>
                {#if nearMetrics.has(metric)}
                  {@const plotResult = getPlotResult(metric)}
                  {@const plotData = plotResult.data}
                  {@const yExtent = plotResult.yExtent}
                  {@const useBar = singlePointMetrics.has(metric)}
                  {@const directTitle = showHeaders ? metric.split("/").slice(1).join("/") || metric : metric}
                  {#if plotData.length > 0}
                    {#if useBar}
                      <BarPlot
                        data={plotData}
                        csvExports={plotResult.csvExports}
                        y={metric}
                        title={directTitle}
                        colorField="series_key"
                        colorDisplayField="run"
                        colorMap={plotColorMap}
                        draggable={true}
                        ondragstart={(e) => handleDragStart(directKey, i, e)}
                        ondragover={(e) => handleDragOver(directKey, i, e)}
                        ondrop={(e) => handleDrop(directKey, i, orderedDirect, e)}
                      />
                    {:else}
                      <LinePlot
                        data={plotData}
                        csvExports={plotResult.csvExports}
                        rangeBand={groupedMode}
                        x={xColumn}
                        y={metric}
                        title={directTitle}
                        colorField="series_key"
                        colorDisplayField="run"
                        colorMap={plotColorMap}
                        {xLim}
                        {yExtent}
                        onSelect={handlePlotSelect}
                        onResetZoom={handleResetZoom}
                        draggable={true}
                        ondragstart={(e) => handleDragStart(directKey, i, e)}
                        ondragover={(e) => handleDragOver(directKey, i, e)}
                        ondrop={(e) => handleDrop(directKey, i, orderedDirect, e)}
                      />
                    {/if}
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <div class="subgroup-list">
          {#each Object.entries(group.subgroups) as [subName, subMetrics]}
            {@const subKey = `${groupName}:${subName}`}
            {@const orderedSub = getOrderedMetrics(subKey, subMetrics)}
            {@const subCols = getGroupCols(orderedSub)}
            <Accordion
              label="{subName} ({subMetrics.length})"
              open={true}
              hidden={!showHeaders}
            >
              <div class="plot-grid" class:auto={autoLayout} style="--cols: {subCols}">
                {#each orderedSub as metric, i}
                  <div class="plot-slot" use:observeMetric={metric}>
                    {#if nearMetrics.has(metric)}
                      {@const plotResult = getPlotResult(metric)}
                      {@const plotData = plotResult.data}
                      {@const yExtent = plotResult.yExtent}
                      {@const useBar = singlePointMetrics.has(metric)}
                      {@const subTitle = showHeaders ? metric.split("/").slice(2).join("/") || metric : metric}
                      {#if plotData.length > 0}
                        {#if useBar}
                          <BarPlot
                            data={plotData}
                            csvExports={plotResult.csvExports}
                            y={metric}
                            title={subTitle}
                            colorField="series_key"
                            colorDisplayField="run"
                            colorMap={plotColorMap}
                            draggable={true}
                            ondragstart={(e) => handleDragStart(subKey, i, e)}
                            ondragover={(e) => handleDragOver(subKey, i, e)}
                            ondrop={(e) => handleDrop(subKey, i, orderedSub, e)}
                          />
                        {:else}
                          <LinePlot
                            data={plotData}
                            csvExports={plotResult.csvExports}
                            rangeBand={groupedMode}
                            x={xColumn}
                            y={metric}
                            title={subTitle}
                            colorField="series_key"
                            colorDisplayField="run"
                            colorMap={plotColorMap}
                            {xLim}
                            {yExtent}
                            onSelect={handlePlotSelect}
                            onResetZoom={handleResetZoom}
                            draggable={true}
                            ondragstart={(e) => handleDragStart(subKey, i, e)}
                            ondragover={(e) => handleDragOver(subKey, i, e)}
                            ondrop={(e) => handleDrop(subKey, i, orderedSub, e)}
                          />
                        {/if}
                      {/if}
                    {/if}
                  </div>
                {/each}
              </div>
            </Accordion>
          {/each}
        </div>
      </Accordion>
    {/each}

    {#if filteredHistogramMetrics.length > 0}
      <Accordion
        label="histograms ({filteredHistogramMetrics.length})"
        open={true}
        hidden={!showHeaders}
      >
        <div
          class="plot-grid"
          class:auto={autoLayout}
          style="--cols: {getGroupCols(filteredHistogramMetrics)}"
        >
          {#each filteredHistogramMetrics as metric}
            <HistogramPlot
              items={histogramItems[metric]}
              title={metric}
              {metric}
              {colorMap}
            />
          {/each}
        </div>
      </Accordion>
    {/if}
  {/if}
</div>

<style>
  .metrics-page {
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .plot-grid {
    --plot-gap: 16px;
    --plot-min-width: 300px;
    --plot-max-cols: 4;
    display: grid;
    grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr));
    gap: var(--plot-gap);
  }
  .plot-grid.auto {
    grid-template-columns: repeat(
      auto-fill,
      minmax(
        min(
          100%,
          max(
            var(--plot-min-width),
            (100% - (var(--plot-max-cols) - 1) * var(--plot-gap)) /
              var(--plot-max-cols) - 0.01px
          )
        ),
        1fr
      )
    );
  }
  .plot-grid :global(.plot-container) {
    min-width: 0;
    width: 100%;
  }
  .plot-slot {
    min-width: 0;
    min-height: 370px;
  }
  .subgroup-list {
    margin-top: 16px;
  }
  .empty-state {
    max-width: 640px;
    padding: 40px 24px;
    color: var(--body-text-color, #1f2937);
  }
  .empty-state h2 {
    margin: 0 0 8px;
    font-size: 20px;
    font-weight: 700;
  }
  .empty-state p {
    margin: 12px 0 8px;
    color: var(--body-text-color-subdued, #6b7280);
  }
  .empty-state pre {
    background: var(--background-fill-secondary, #f9fafb);
    padding: 16px;
    border-radius: var(--radius-lg, 8px);
    border: 1px solid var(--border-color-primary, #e5e7eb);
    font-size: 13px;
    overflow-x: auto;
  }
  .empty-state code {
    background: var(--background-fill-secondary, #f0f0f0);
    padding: 1px 5px;
    border-radius: var(--radius-sm, 4px);
    font-size: 13px;
  }
  .empty-state pre code {
    background: none;
    padding: 0;
  }
</style>
