<script>
  import { parseMembership } from "../lib/runFilters.js";

  let { choices = [], value = $bindable(""), valueType = $bindable(undefined), multiple = false, disabled = false } = $props();
  let search = $state("");
  let selected = $derived(parseMembership(value));
  let selectedToken = $derived.by(() => {
    if (valueType !== undefined) {
      const actual = valueType === "null" ? null : valueType === "number" ? Number(value)
        : valueType === "boolean" ? value === "true" : value;
      return JSON.stringify(actual);
    }
    return choices.find((choice) => String(JSON.parse(choice.token)) === value)?.token
      ?? (value ? JSON.stringify(value) : "");
  });
  let available = $derived.by(() => {
    const result = [...choices];
    if (multiple) {
      for (const item of selected) {
        const token = JSON.stringify(item);
        if (!result.some((choice) => choice.token === token)) result.push({token, label: token});
      }
    }
    return result.filter((choice) => choice.label.toLowerCase().includes(search.toLowerCase()));
  });

  function choose(token) {
    if (!token) return;
    const actual = JSON.parse(token);
    valueType = actual === null ? "null" : typeof actual;
    value = String(actual);
  }
</script>

{#if multiple}
  <details class="multi-picker">
    <summary aria-label="Configuration values" aria-disabled={disabled} onclick={(event) => { if (disabled) event.preventDefault(); }}>
      {selected.length ? `${selected.length} selected` : "Choose values"}
    </summary>
    <div class="value-options">
      <input aria-label="Search configuration values" placeholder="Search values" bind:value={search} />
      {#each available as choice}
        <label><input type="checkbox" {disabled} checked={selected.some((item) => JSON.stringify(item) === choice.token)}
          onchange={(event) => {
            const next = selected.filter((item) => JSON.stringify(item) !== choice.token);
            value = JSON.stringify(event.currentTarget.checked ? [...next, JSON.parse(choice.token)] : next);
          }} />{choice.label}</label>
      {/each}
      {#if !available.length}<span>No matching values</span>{/if}
    </div>
  </details>
{:else}
  <select aria-label="Configuration value" {disabled} value={selectedToken} onchange={(event) => choose(event.currentTarget.value)}>
    <option value="" disabled>Choose value</option>
    {#if selectedToken && !choices.some((choice) => choice.token === selectedToken)}
      <option value={selectedToken}>{selectedToken} (saved value)</option>
    {/if}
    {#each choices as choice}<option value={choice.token}>{choice.label}</option>{/each}
  </select>
{/if}

<style>
  select, summary, input { font: inherit; color: inherit; }
  select, summary { width: 100%; box-sizing: border-box; min-width: 0; padding: 6px; border: 1px solid var(--border-color-primary); border-radius: 4px; background: var(--input-background-fill); }
  summary { cursor: pointer; }
  summary[aria-disabled="true"] { opacity: 0.5; cursor: default; }
  .value-options { display: grid; gap: 6px; max-height: 180px; overflow-y: auto; padding: 8px; border: 1px solid var(--border-color-primary); border-radius: 4px; margin-top: 4px; background: var(--background-fill-primary); }
  .value-options > input { width: 100%; min-width: 0; box-sizing: border-box; padding: 4px; }
  label { display: flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
  label input { flex-shrink: 0; }
</style>
