<script>
  import { normalizeView, readViews, writeViews } from "../lib/savedViews.js";

  let { storageKey, view, onapply } = $props();
  let named = $state({});
  let selected = $state("");
  let error = $state("");
  let menu;
  let dirty = $derived(JSON.stringify(normalizeView(view)) !== JSON.stringify(normalizeView(named[selected])));

  $effect(() => {
    const data = readViews(storageKey);
    named = data.named;
    selected = data.active && Object.hasOwn(data.named, data.active) ? data.active : "";
  });

  function persist(next, active = selected, latest = null) {
    const data = readViews(storageKey);
    if (!writeViews(storageKey, { ...data, named: next, active, ...(latest ? {latest} : {}) })) {
      error = "Browser storage is unavailable.";
      return false;
    }
    named = next;
    selected = active;
    error = "";
    return true;
  }

  function choose(name) {
    if (name === selected) return;
    if (name && dirty && !confirm("Discard unsaved view changes?")) return;
    const nextView = normalizeView(name ? named[name] : view);
    if (name) onapply(nextView);
    persist(named, name, nextView);
  }

  function save(asNew = false) {
    if (menu) menu.open = false;
    let name = selected;
    if (!name || asNew) {
      name = prompt("View name", asNew && selected ? `${selected} copy` : "")?.trim();
      if (!name) return;
      if (Object.hasOwn(named, name) && !confirm(`Replace view "${name}"?`)) return;
    }
    const snapshot = normalizeView(view);
    persist({ ...named, [name]: snapshot }, name, snapshot);
  }

  function remove() {
    if (!selected || !confirm(`Delete saved view "${selected}"?`)) return;
    const next = { ...named };
    delete next[selected];
    persist(next, "");
  }

  function rename() {
    menu.open = false;
    const name = prompt("New view name", selected)?.trim();
    if (!name || name === selected) return;
    if (Object.hasOwn(named, name) && !confirm(`Replace view "${name}"?`)) return;
    const next = { ...named, [name]: named[selected] };
    delete next[selected];
    persist(next, name);
  }

  async function share() {
    menu.open = false;
    const url = new URL(window.location.href);
    url.searchParams.set("view", JSON.stringify($state.snapshot(view)));
    try { await navigator.clipboard.writeText(url.toString()); }
    catch { error = "Could not copy the view link."; }
  }
</script>

<div class="views">
  <label for="saved-view">View</label>
  <select id="saved-view" aria-label="Current view" value={selected} title={dirty ? "Unsaved view changes" : "Saved view"}
    onchange={(event) => { choose(event.currentTarget.value); event.currentTarget.value = selected; }}>
    <option value="">Unsaved view{!selected && dirty ? " *" : ""}</option>
    {#each Object.keys(named).sort() as name}<option value={name}>{name}{selected === name && dirty ? " *" : ""}</option>{/each}
  </select>
  <div class="view-actions">
    <button disabled={!!selected && !dirty} onclick={() => save()}>Save</button>
    <button disabled={!selected} onclick={remove}>Delete</button>
    <details bind:this={menu}>
      <summary aria-label="More view actions" title="More view actions">⋯</summary>
      <div class="view-menu">
        <button onclick={() => save(true)}>Save as…</button>
        <button disabled={!selected} onclick={rename}>Rename</button>
        <button onclick={share}>Copy view link</button>
      </div>
    </details>
  </div>
  {#if error}<p role="status">{error}</p>{/if}
</div>

<style>
  .views { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border-color-primary, #e5e7eb); border-radius: 8px; background: var(--background-fill-secondary); min-width: 0; }
  label { font-size: 11px; font-weight: 600; color: var(--body-text-color-subdued); }
  select, button, summary { font: inherit; color: inherit; background: var(--background-fill-primary); border: 1px solid var(--border-color-primary); border-radius: 5px; padding: 6px 8px; }
  select { width: 100%; min-width: 0; font-size: 13px; }
  .view-actions { display: flex; gap: 6px; }
  .view-actions > button { flex: 1; }
  button, summary { cursor: pointer; font-size: 12px; }
  button:disabled { opacity: 0.45; cursor: default; }
  details { position: relative; }
  summary { list-style: none; font-weight: bold; text-align: center; }
  summary::-webkit-details-marker { display: none; }
  .view-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; display: grid; gap: 2px; min-width: 140px; padding: 4px; border: 1px solid var(--border-color-primary); border-radius: 6px; background: var(--background-fill-primary); box-shadow: 0 4px 12px #0002; }
  .view-menu button { text-align: left; border: 0; white-space: nowrap; }
  .view-menu button:hover { background: var(--background-fill-secondary); }
  p { margin: 0; font-size: 12px; }
</style>
