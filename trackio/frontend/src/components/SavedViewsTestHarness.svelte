<script>
  import SavedViews from "./SavedViews.svelte";
  import { VIEW_DEFAULTS } from "../lib/savedViews.js";
  let view = $state(structuredClone(VIEW_DEFAULTS));
</script>
<button onclick={() => { view = {...view, filterText: "train"}; }}>Change filter</button>
<SavedViews storageKey="test-views" {view} onapply={(value) => { view = value; }} />
<output aria-label="Run filter">{view.filterText}</output>
