# Table-backed dashboards

Each workspace has at most one dashboard, a separate resource with its own sidebar page, resource tab, and Mothership `dashboards get` / `dashboards set` commands. Sim builds it: the page shows an empty state until the first save, and there is no create, rename, move, or folder operation. Dashboards live in the `dashboard` table (migration 0392) with their own id; a unique index on `workspace_id` keeps one per workspace, and dropping it allows several. Saves compare the stored `revision`, so a concurrent edit is never overwritten. Mothership's **create-dashboard** skill documents the syntax. Sharing and fork copies are deferred.

The implementation has three boundaries:

- `spec.ts` validates a bounded YAML document and normalizes ECharts options through the existing `.chart` safety rules. It rejects unknown layout/source keys; saves reject invalid YAML and the viewer reports panel errors.
- `table/analytics` computes exact aggregates over authorized table rows. The internal POST `/api/table/[tableId]/analytics` is a session-authenticated adapter for `tables.rows.analytics`, requiring the current viewer's workspace read role and `tables.use`. The operation is session-only because this release's sole query caller is the workspace renderer. Public/versioned query APIs, workflow/executor callers and log queries are deferred. Dashboard APIs and Mothership tools share the dashboard application operations.
- `components/dashboards` owns EMCN layout, controls and states. `components/charts/echarts-view.tsx` also renders existing `.chart` files, using the local EMCN tokens for its canvas theme. `.chart` retains its existing sampled source behavior; dashboard aggregation is performed on the server.

A leading `text` block is the dashboard description, grouped with its title using the settings header spacing and typography. Other text blocks stay in the body. Dashboard tabs use the large EMCN tab-strip size and an underline indicator without divider rules. Put the stat row inside a tab when the tabs should appear above the metrics. KPI rows wrap at a 200 px minimum width, and large values scale to their container with smaller units on the same baseline. Horizontal bar labels appear above their bars unless the option places its own category labels (`yAxis.axisLabel` `inside`/`width`/`margin`) or sets `grid.left`/`containLabel`, which keeps the standard ECharts left column instead of blending the two; horizontal bar frames grow with their row count so each label clears the neighbouring bars. Bar hover highlights the category row and shows a floating tooltip with the category and formatted value.

Time controls update the URL without navigation. During a range change, panels retain their previous results together with their displayed axis bounds and announce their busy state to assistive technology; this only applies to the same table, workspace and selection. Failed queries show errors instead of stale results. Charts update their existing canvas instance, including through empty results. Plot and table frames retain their height across loading, empty and populated states. KPI values count toward their new value over 280 ms with ease-in-out timing, continue from their current value when interrupted, and update immediately with reduced motion enabled. Counts remain whole numbers; other metrics retain up to two decimal places throughout the animation.

Charts with one horizontal ECharts `time` axis automatically receive a fixed readout row: series values and their resolved colors on the left, date/time on the right. Idle readouts show the average of non-missing plotted samples for percentage axes (`yAxis.axisLabel.formatter: "{value}%"`), and the sum for other numeric series. Each value is labeled Avg or Total. These describe the plotted buckets after ECharts dataset transforms, not a recomputed population statistic: averaging bucket percentages is not a weighted overall rate, and summing distinct counts across buckets does not deduplicate them. Null samples are excluded; actual zeros count. Hover shows the selected bucket instead, with a floating tooltip containing its timestamp and series values. Only the chart under the cursor shows a floating tooltip; linked charts update their readouts. Hover synchronizes by timestamp across charts with the same query bounds, rather than by row index. A dashboard-scoped Zustand store owns this ephemeral cursor; it never triggers data requests or URL updates. The renderer uses ECharts tooltip parameters, encodings, and axis-pointer actions without evaluating document code.

Dragging horizontally on a shared-range time chart commits a new global custom range on release. Stats, charts, and detail tables query those same bounds. Choose a time-range preset to leave the zoomed interval. Fixed-range panels keep their override and do not offer global zoom. Omit `source.bucket` (or use `auto`) to request finer buckets as the range shrinks. Explicit buckets remain explicit. Custom range inputs provide the keyboard-accessible alternative to dragging.

The toolbar has side-by-side time-range and timezone dropdowns, followed by an icon-only Refresh button. The range popover contains presets and a staged custom calendar. Custom dates commit only on Apply; canceling leaves the range untouched. The timezone defaults to the viewer's browser/device IANA timezone, using its date-appropriate abbreviation, and offers UTC as an alternative. An explicit UTC selection is preserved in the URL; the local option follows each viewer's timezone. Timezone is viewer state, not YAML configuration. Axis labels, readouts, timestamp table cells, and calendar inputs use that zone; stored URL/query bounds remain exact UTC instants and bucket boundaries remain UTC. Ambiguous or nonexistent local calendar times show an error and can be selected precisely in UTC. Legacy offset-free custom-range URLs retain their UTC meaning.

EMCN is an ECharts theme, so authored `option.color`, series styles, text, and axis styles override its defaults. Standard string axis formatters also override adaptive labels; omit them to get timezone-aware dates and intraday times automatically. Floating tooltips, hover readouts, cursor synchronization, and range selection belong to the framework. Tabs, controls, typography outside the plot, and responsive layout remain EMCN-owned.

Authoring guidance defaults to the muted theme: single-measure panels share a neutral color, comparisons use the shared palette or line patterns, and explicit colors are reserved for user-requested meaning. It contains no example dashboards. Text blocks are optional brief annotations, not viewer instructions or implementation caveats. Chart grids use ECharts 6 outer bounds to fit axis names and end ticks inside the canvas, and horizontal category labels leave space above the configured bar thickness.

## Time and results

All panels share resolved `[from,to)` UTC bounds, with optional per-panel relative overrides. `createdAt` is the default; a user date/TTL column or `updatedAt` can be selected. Calendar-only dates represent UTC midnight; timestamp strings need an offset. UTC weeks start Monday. Time series can choose a bucket or let the query choose it; the first and last buckets may be partial.

Counts return zero for no rows. Other empty aggregates remain null. Single-dimension time series fill missing count buckets with zero and other aggregate buckets with null. Grouping by time plus another dimension returns observed groups only. These are current table records, not historical versions of edited/deleted records. Queries in different panels use independent read snapshots; they share time bounds, not an atomic cross-panel snapshot.

Conditional percentages use `aggregate: {alias: {op: percent, filter: predicate}}`.
The measure filter reuses the table condition grammar (`field`/`op`/`value`, nested
`all`/`any`), including column IDs/names and select-option names. PostgreSQL computes
`100 * matching rows / total rows` within each group after the source filter and
time range. All scoped rows count toward the denominator, including rows with
missing condition fields; use a source filter to exclude those when appropriate.
The measure filter never removes rows from other aggregates. A nonempty group with
no matches returns zero; an empty population or missing time bucket remains null.
These measures take a condition rather than a numeric field, so tables do not need
100/0 helper columns. Stats can append `%`, and charts use standard ECharts percent
axis formatting. Pie/donut distributions can continue grouping by outcome and
counting rows; their slice percentages are computed by ECharts.

Queries reuse the table predicate compiler and the existing read-only repeatable-read transaction guards, including statement/lock timeouts and tenant index planning. The built-in timestamp predicate leaves the indexed column uncast. Custom date extraction requires scanning matching table rows. There is no background polling.

Bounds: 128 KB source, 48 blocks, 4 layout levels, 2 grouping fields, 8 measures, 12 projected columns, 500 result rows and 8 KB per returned row. Limits apply after aggregation. An explicit limit yields a labeled top-N result; unrequested group overflow is an error. API rate admission is per viewer. Errors are never turned into successful zeros. Only visible tabs mount their query observers; identical queries share React Query cache entries for one minute, and Refresh requests fresh data.

Dashboards are workspace-only: there is no public sharing, embedding in public HTML pages, or self-contained export. Row/query data is never persisted with the dashboard.

## Validation

Focused suites cover parser/expansion limits, chart confinement, SQL compilation, UTC ranges/buckets, null semantics, output bounds, authorization and the HTTP adapter. Real PostgreSQL tests run against a disposable local cluster with synthetic rows.

## Before rollout

- Review authenticated dashboard authoring, permissions, and schema changes in staging. The full local app has been exercised with Mothership and synthetic workspace tables; the earlier standalone preview uses a synthetic query service.
- Compare dashboard results with independent queries over the same tables and time range.
- Measure the generated queries and concurrent dashboard views on representative table sizes. Queries currently run per panel; server-side batching, shared result caching, concurrency admission, and rollups are not implemented.
- Review and validate in staging before a production rollout. Log queries, live public sharing, and standalone HTML export remain deferred.

## Rollout

The `dashboards` runtime flag defaults off. AppConfig can enable it globally
(`enabled: true`) or for selected organizations (`orgIds`). Clear the allowlist
and set `enabled: false` to disable it everywhere. Personal workspaces follow the
global switch. Local development uses `DASHBOARDS=true` in the app's ignored
environment file.

The server resolves the flag for the canonical workspace organization. It gates
dashboard operations, table analytics, and UI entry points. Mothership receives it per
turn as the `dashboards` entitlement and persists it for continuation; runs without it
omit the dashboard commands, the create-dashboard skill, and dashboard prompt text.
The Sim server checks current availability on every dashboard operation, including
calls from a run admitted before the flag changed.

Apply both repositories' additive migrations and deploy the companion worker
before enabling the flag. Sharing and a tool for capturing the user's displayed
data are deferred.
