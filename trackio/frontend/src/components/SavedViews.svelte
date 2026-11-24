<script>
  import { readViews, writeViews } from "../lib/savedViews.js";
  let { storageKey, view, onapply } = $props();
  let named = $state({});
  let selected = $state("");
  let error = $state("");
  $effect(() => { named = readViews(storageKey).named; selected = ""; });
  function persist(next) {
    const data = readViews(storageKey);
    if (writeViews(storageKey, { ...data, named: next })) { named = next; error = ""; }
    else error = "Browser storage is unavailable.";
  }
  function save() {
    const name = prompt("View name", selected)?.trim();
    if (!name) return;
    if (Object.hasOwn(named, name) && !confirm(`Replace view "${name}"?`)) return;
    persist({ ...named, [name]: structuredClone($state.snapshot(view)) });
    selected = name;
  }
  function rename() {
    const name = prompt("New view name", selected)?.trim();
    if (!name || name === selected) return;
    if (Object.hasOwn(named, name) && !confirm(`Replace view "${name}"?`)) return;
    const next = { ...named, [name]: named[selected] };
    delete next[selected];
    persist(next); selected = name;
  }
  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", JSON.stringify($state.snapshot(view)));
    try { await navigator.clipboard.writeText(url.toString()); }
    catch { error = "Could not copy the view link."; }
  }
</script>
<div class="views">
  <select aria-label="Saved views" bind:value={selected}>
    <option value="">Saved views</option>
    {#each Object.keys(named).sort() as name}<option value={name}>{name}</option>{/each}
  </select>
  <button disabled={!selected} onclick={() => onapply(named[selected])}>Open</button>
  <button onclick={save}>Save view</button>
  <button disabled={!selected} onclick={() => persist({...named, [selected]: $state.snapshot(view)})}>Update</button>
  <button disabled={!selected} onclick={rename}>Rename</button>
  <button disabled={!selected} onclick={() => { if (confirm(`Delete saved view "${selected}"?`)) { const next = {...named}; delete next[selected]; persist(next); selected = ""; } }}>Delete</button>
  <button onclick={share}>Copy view link</button>
  {#if error}<p role="status">{error}</p>{/if}
</div>
<style>
  .views { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; }
  select, button { font: inherit; color: inherit; background: var(--background-fill-primary); border: 1px solid var(--border-color-primary); border-radius: 4px; padding: 4px; }
</style>
