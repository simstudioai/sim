/** The built-in authoring skill ships alongside the parser, so models can learn the actual format. */
export const DASHBOARD_AUTHORING_CONTENT = `# Create a dashboard

A dashboard is a workspace file of YAML over live table rows, rendered when opened. Inspect the table's columns first, then create a file named \`<Name>.dashboard\`: Sim drops the suffix and stores the dashboard type, so the result's type must be text/x-sim-dashboard. Later reads and edits use the returned file id. Never write HTML, JS, CSS, or a custom chart grammar; log queries are not supported.

\`\`\`yaml
title: Support
time: 7d                      # 1h | 24h | 7d | 30d | 90d
source: {tableId: tbl_123}    # default for every panel; a panel's source shallowly overrides it
blocks:
  - text: Tickets opened this week.   # a leading text block is the subtitle
  - row:
      - stat: Tickets
        source: {aggregate: {n: {op: count}}}
      - stat: Resolved
        unit: '%'
        source: {aggregate: {pct: {op: percent, filter: {field: status, op: eq, value: resolved}}}}
  - chart: Tickets per day
    flex: 2
    source: {groupBy: [createdAt], aggregate: {n: {op: count}}}
    option:
      xAxis: {type: time}
      yAxis: {type: value}
      series: [{type: line, name: Tickets, encode: {x: createdAt, y: n}}]
  - tabs:
      Recent:
        - table: Latest tickets
          source: {columns: [title, status, createdAt], sort: [{field: createdAt, direction: desc}]}
\`\`\`

## Layout
Top-level keys: title, time, source, blocks. Blocks stack; row places up to 12 side by side (optional flex 1–12); tabs maps 1–8 labels to block lists. Text is plain. Keep text minimal — no authoring notes or instructions in the dashboard.

## source
- tableId; timeField (default createdAt; pick updatedAt or a date column when that fits). Every query is bounded to the viewer's range; range pins one panel to a preset.
- filter: table conditions {field, op, value} or nested all/any. No SQL. Use stable column IDs over names where possible.
- aggregate: 1–8 aliases → {op, field}. count (field optional), countDistinct, sum, avg, min, max. percent takes {op: percent, filter}: matching rows / all rows in the group × 100 — use it instead of 0/100 helper columns. A stat has exactly one aggregate and no groupBy; unit is a label only.
- groupBy: up to 2 fields; include timeField for a time series. bucket: auto (default) or minute…year, UTC. Leave it auto so zoom can refine.
- columns (instead of aggregate) for detail rows, with optional sort (≤3). limit 1–500; on aggregates it's top-N after grouping.

## Charts
option is a plain ECharts option; results arrive as dataset 0, referenced via series.encode by groupBy field or aggregate alias. No functions, HTML tooltips, toolbox, or links. Bars: type bar with a category axis (swap axes for horizontal). Pie: encode {itemName, value}, radius pair for donut. Stack/area via standard ECharts. Time-axis charts get hover readout, synced crosshair, and drag-zoom for free — name series, set yAxis.axisLabel.formatter "{value}%" for percentages, and leave xAxis label formatters unset. Rely on renderer defaults for colors and styling unless the user asks.

## Verify
Nothing validates the file on write. Open it and fix any parse or panel errors before saying it works.
`
