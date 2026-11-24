<script>
  import { onMount } from "svelte";
  import { activityStatus, subscribeClock } from "../lib/activity.js";
  let { activity } = $props();
  let now = $state(Date.now());
  let receivedAt = $state(Date.now());
  $effect(() => { activity; receivedAt = Date.now(); });
  onMount(() => subscribeClock((value) => { now = value; }));
  let alive = $derived(activityStatus(activity, now, receivedAt));
</script>
{#if activity}<span class:alive class="activity-dot" role="img" aria-label={alive ? "Run is active" : activity.state === "finished" ? "Run finished" : "Run is inactive"}
  title={alive ? `Recent user logging (timeout ${Math.round(activity.timeout_seconds / 60)} minutes)` : activity.state === "finished" ? "Run finished" : "No recent user logging; run may be stalled"}></span>{/if}
<style>
  .activity-dot { display: inline-block; width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: #9ca3af; margin-inline: 3px; }
  .activity-dot.alive { background: #22c55e; }
</style>
