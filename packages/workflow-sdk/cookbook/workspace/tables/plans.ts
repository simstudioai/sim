// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

// Managed rows: tables/plans.rows.jsonl is the table's whole content, one row per line keyed by
// column key, each matched to its stored row by the unique `code` column. Removing a line deletes
// that row (with --allow-delete). Use `{ mode: 'seed' }` instead to write rows only when the table
// is created.
export default defineTable({
  name: 'plans',
  description: 'Plans the billing workflow prices against',
  columns: {
    code: column.string({ required: true, unique: true }),
    seats: column.number(),
    tier: column.select({ options: ['basic', 'pro'] }),
  },
  rows: { mode: 'managed', key: 'code' },
})
