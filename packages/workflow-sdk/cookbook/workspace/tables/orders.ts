// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

// tables/<key>.ts: the key (`orders`) is how a workflow names it: table('orders'). Its rows stay
// out of source (see plans.ts to opt in). To rename a column keep its key and set `name`: a
// workflow's row data (`data`, `conflictColumn`, filters) names a column by that name, not its key.
export default defineTable({
  name: 'orders',
  description: 'Order questions the support workflow answered',
  columns: {
    orderId: column.string({ required: true, unique: true }),
    status: column.select({ options: ['open', 'answered'] }),
    total: column.number(),
  },
})
