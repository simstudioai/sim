---
name: table
description: Create and operate Sim tables through the sim CLI. Use when designing typed schemas, loading or querying rows, importing CSV data, or connecting a workflow or enrichment to table columns; not for knowledge-base documents or workflow graph edits.
---

# Operate a Sim Table

Treat the table schema as an API contract. Discover the current table before writing, make the
smallest requested mutation, and verify stored rows or run state afterward.

## Establish context

- Use the profile the user named. If none was named, inspect configured profiles and current context;
  do not silently switch accounts, workspaces, or API origins.
- Find existing resources with `sim --output json tables list`. Read the target with
  `sim --output json tables get <tableId>` before changing its schema or data.
- Keep the returned table id. Do not rediscover a table by name after creating it.

## Design the schema first

Create a table with at least one explicit column:

```bash
sim --output json tables create \
  --name contacts \
  --schema @schema.json
```

The schema file has this shape:

```json
{
  "columns": [
    { "name": "email", "type": "string", "required": true, "unique": true },
    { "name": "active", "type": "boolean" },
    { "name": "score", "type": "number" }
  ]
}
```

Use only the accepted types: `string`, `number`, `currency`, `boolean`, `date`, `json`, and
`select`. A `select` column must define `options` with stable `id` and display `name` values; only a
select may use `multiple`. A `currency` may specify a three-letter `currencyCode`. Mark a natural
key unique when later writes must be idempotent. Do not use `json` to avoid designing queryable
columns.

Use `tables columns create`, `tables columns update`, or `tables columns delete` for a requested
schema change. Fail on incompatible existing values or uniqueness conflicts instead of weakening
the schema.

## Write rows deliberately

Create one row with `--data` or several with `--rows`; the flags are mutually exclusive:

```bash
sim --output json tables rows create <tableId> --data @row.json
sim --output json tables rows create <tableId> --rows @rows.json
```

Use `tables rows update <tableId> <rowId> --data @patch.json` to merge specified cells into one
known row. Use `tables upsert <tableId> --on email --data @row.json` only against a unique column.
An upsert's update branch **replaces the complete row** and clears omitted columns, so always send
the complete desired row.

For CSV input, prefer the import command over parsing client-side:

```bash
sim --output json tables import ./contacts.csv --name contacts
sim --output json tables import ./updates.csv --table-id <tableId> --mode append
```

`--mode replace` is destructive for an existing table. Use it only when explicitly requested.
Unless the caller deliberately chose `--no-wait`, require the import's terminal result rather than
treating queue acceptance as completion.

## Query on the server

Filter and sort with the table commands instead of fetching every row:

```bash
sim --output json tables rows query <tableId> \
  --filter '{"all":[{"field":"active","op":"eq","value":true}]}' \
  --sort '[{"field":"score","direction":"desc"}]' \
  --limit 100
```

Use `tables rows count` when only a count is needed and `tables rows search` for a
case-insensitive substring across cells. A negating filter may include null or absent values; add
an explicit `isNotNull` or `isNotEmpty` condition when nulls must be excluded. Avoid `--limit 0` on
an unbounded table. Request `--include-run-state` only when workflow-group diagnostics are needed;
it is incompatible with `--limit 0` and caps a page at 200 rows.

## Connect a workflow or enrichment

Read the target workflow and identify real workflow inputs and block output paths before creating a
group. The group body maps table columns to workflow inputs and workflow outputs back to new table
columns:

```json
{
  "type": "manual",
  "workflowId": "<workflowId>",
  "name": "Score contacts",
  "inputMappings": [{ "inputName": "email", "columnName": "email" }],
  "outputs": [{ "blockId": "<blockId>", "path": "score", "columnName": "score" }]
}
```

Create the group with both files:

```bash
sim --output json tables groups create <tableId> \
  --group @group.json \
  --output-columns @output-columns.json \
  --no-auto-run
```

`output-columns.json` is an array of typed column definitions. Group creation defaults to not
scheduling existing rows; opt into `--auto-run` only when the user intends that metered fan-out.
Afterward, use the group id returned by the API with the explicit row or batch dispatch command and
inspect dispatch and row run state until terminal.

## Verify and report

Read the table again after schema changes. Query a bounded sample after data changes and confirm
types, unique keys, and expected values. For groups, confirm the group mapping and relevant row run
state. Report the table id, its exact `webUrl` from the create or get response as a clickable link,
affected row count, group or dispatch ids, and any terminal error. Do not construct a table URL from
ids or the profile's API origin; a missing `webUrl` is a response-contract failure. Never print
profile credentials, connector keys, or private cell values unrelated to the request.
