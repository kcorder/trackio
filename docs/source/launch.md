# Launching the Dashboard

## Launching a Local Dashboard

You can launch the dashboard by running:

<hfoptions id="language">
<hfoption id="Shell">

```sh
trackio show
```

</hfoption>
<hfoption id="Python">

```py
import trackio

trackio.show()
```

</hfoption>
</hfoptions>

## Loading a Specific Project

You can also provide an optional `project` name as the argument to load a specific project directly:

<hfoptions id="language">
<hfoption id="Shell">

```sh
trackio show --project "my-project"
```

</hfoption>
<hfoption id="Python">

```py
import trackio 

trackio.show(project="my-project")
```

</hfoption>
</hfoptions>

## Using a Custom Frontend

You can replace the bundled dashboard with your own static frontend directory. The directory only needs an `index.html` file; your frontend can call the existing Trackio API under `/api/*`.

The intended workflow is:

1. Run `trackio show --frontend ./my-trackio-frontend`.
2. Ask your LLM to edit the files in that directory.
3. Keep the browser open while Trackio live reloads the frontend as those files change.

If the directory passed to `--frontend` does not exist, or exists but is empty, Trackio copies in the starter frontend automatically, prints that it did so, and then serves that directory. The starter is a complete plain-HTML/CSS/JS template: it calls the Trackio API, loads projects and runs, fetches metric values, and draws simple charts that you can replace with your own UI.

The currently available HTTP endpoints are:

- `POST /api/get_run_mutation_status`
- `POST /api/upload_db_to_space`
- `POST /api/bulk_upload_media`
- `POST /api/log`
- `POST /api/bulk_log`
- `POST /api/bulk_log_system`
- `POST /api/bulk_alert`
- `POST /api/get_alerts`
- `POST /api/get_metric_values`
- `POST /api/get_runs_for_project`
- `POST /api/get_metrics_for_run`
- `POST /api/get_all_projects`
- `POST /api/get_project_summary`
- `POST /api/get_run_summary`
- `POST /api/get_system_metrics_for_run`
- `POST /api/get_system_logs`
- `POST /api/get_system_logs_batch`
- `POST /api/get_snapshot`
- `POST /api/get_logs`
- `POST /api/get_logs_batch`
- `POST /api/get_traces`
- `POST /api/query_project`
- `POST /api/get_settings`
- `POST /api/get_project_files`
- `POST /api/delete_run`
- `POST /api/rename_run`
- `POST /api/force_sync`
- `POST /api/upload` for multipart file uploads used by media and file-related flows

For reading stored files returned by the API, Trackio also serves `GET /file?path=...`.

<hfoptions id="language">
<hfoption id="Shell">

```sh
trackio show --frontend ./my-trackio-frontend
```

</hfoption>
<hfoption id="Python">

```py
import trackio 

trackio.show(frontend_dir="./my-trackio-frontend")
```

</hfoption>
</hfoptions>

If the provided frontend directory is non-empty but invalid, Trackio falls back to the shipped starter template.

## Setting a Persistent Default Frontend

If you want the same custom frontend to be used by `trackio show`, `trackio sync`, and deploy flows by default, save it in Trackio's persistent config:

```sh
trackio config set frontend ./my-trackio-frontend
```

Reset it with:

```sh
trackio config unset frontend
```

## Customizing Plot Colors

You can customize the color palette used for plot lines by providing a `color_palette` argument. This is useful if you want to match your organization's branding or have specific color preferences.

<hfoptions id="language">
<hfoption id="Shell">

```sh
trackio show --color-palette "#FF0000,#00FF00,#0000FF"
```

</hfoption>
<hfoption id="Python">

```py
import trackio 

trackio.show(color_palette=["#FF0000", "#00FF00", "#0000FF"])
```

</hfoption>
</hfoptions>

The colors will be cycled through when displaying multiple runs. You can provide as many or as few colors as you like.

## Enabling Remote Access

By default, the dashboard binds to `127.0.0.1` (localhost), which means it can only be accessed from the same machine. To allow remote access from other machines on the network, use the `--host` option:

<hfoptions id="language">
<hfoption id="Shell">

```sh
trackio show --host 0.0.0.0
```

</hfoption>
<hfoption id="Python">

```py
import trackio 

trackio.show(host="0.0.0.0")
```

</hfoption>
</hfoptions>

This is particularly useful when running Trackio on a remote server or in a containerized environment where you need to access the dashboard from a different machine.

## Launching a Dashboard in Jupyter Notebooks

You can also launch the dashboard directly within a Jupyter Notebook. Just use the same command as above:

```py
import trackio

trackio.show()
```

Check the [demo notebook](https://github.com/gradio-app/trackio/blob/main/examples/notebook_integration.ipynb).

## Organizing dashboard runs

Use **Config filters** to combine comparisons with AND/OR conditions. The `IN`
operator provides a searchable multi-select dropdown of observed scalar values;
`=` provides a single-value dropdown. Neither requires typing a value. Numbers,
strings, booleans, and null are distinct selections. Missing fields do not match.

**Group by** accepts multiple config fields and stays active when switching
between Metrics and Runs. Runs groups can be collapsed without changing the
selection. Metrics can show a mean curve with either the observed min–max range
or ±1 population standard deviation. Each contributing run has equal weight
at an aligned x position; neither band is a confidence interval. A singleton
has zero standard deviation. CSV exports retain observed bounds and include SD,
the selected band method, and displayed bounds. PNG exports identify the band.

In Runs, expand **Config columns** to choose fields. Click a scalar cell to edit
it, use **+ Config** to add a field to a run, or select rows and use **Set config
field on selected runs** for a confirmed bulk edit. Choose the value type
explicitly. A field can be a literal name or a JSON path array, such as
`["args", "experiment_name"]`. Reserved top-level fields, arrays, and objects
are read-only. Editing requires the same write access as renaming/deleting runs.

Dashboard edits are persisted separately from uploaded config and take precedence
in dashboard reads and exports. Logging uploads cannot overwrite them, and they
do not change the training process's in-memory config. Concurrent dashboard edits
use revisions; a conflict requires refreshing and retrying. A bulk operation
succeeds for all selected runs or none of them.

**Saved views** live in this browser, scoped to the dashboard and project. Save,
open, update, rename, or delete named views, or copy a view link to share the
controls. The View dropdown shows the active name; an asterisk marks unsaved
changes. Selecting a saved name opens it immediately. **Save** updates that view,
and **Delete** removes it. **Save as**, **Rename**, and **Copy view link** are in
the **More view actions** menu. Views include grouping, config filters, run/metric regexes, band method,
smoothing, axes/scales, layout, and config columns. They do not freeze a list of
run IDs. The latest working controls are restored automatically after reloading
or restarting the browser, unless an explicit view URL takes precedence.

A small green dot indicates a running session with recent user logging. Its
expiry is five times the median of recent logging intervals, with a 30-second
minimum and a 15-minute fallback when cadence is unknown. Automatic CPU/GPU
logging does not extend this period. Gray means finished or inactive; a stale
session is not automatically marked finished. Runs created with older Trackio
versions have unknown lifecycle state. Static dashboards do not show live status.

Hover over a run in the Metrics sidebar, or focus it with the keyboard, to reveal
**×**. This permanently deletes its data after confirmation; it uses the same
permissions as deletion from Runs.
