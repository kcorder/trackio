<script>
  import Metrics from "./Metrics.svelte";

  const runs = [
    { id: "run-a", name: "run-a" },
    { id: "run-b", name: "run-b" },
  ];
  const runConfigs = {
    "run-a": { args: { model: "small" } },
    "run-b": { args: { model: "small" } },
  };
  let groupByKeys = $state([]);
</script>

<button type="button" onclick={() => { groupByKeys = ['@["args","model"]']; }}>Group</button>
<Metrics
  project="demo"
  selectedRuns={runs}
  allRuns={runs}
  {runConfigs}
  {groupByKeys}
  appBootstrapReady={true}
  realtimeEnabled={false}
  smoothing={0}
/>
