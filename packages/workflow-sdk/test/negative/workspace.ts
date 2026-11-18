// @sim-sdk 1
// Workspace declarations the server refuses. Each `@ts-expect-error` must see an error.

import { column, defineTable, defineTool, type RowOf } from '@sim/workflow-sdk/workspace'

export const leads = defineTable({
  name: 'leads',
  columns: {
    email: column.string({ required: true }),
    // @ts-expect-error a select column cannot be unique
    status: column.select({ options: ['new', 'won'], unique: true }),
    // @ts-expect-error a select column needs at least one option
    empty: column.select({ options: [] }),
    note: column.string(),
  },
})

// A cell of a column that is not required may be empty; a required one may not.
export const emptyNote: Pick<RowOf<typeof leads>, 'email' | 'note'> = {
  email: 'a@b.co',
  note: null,
}
// @ts-expect-error `email` is required
export const emptyEmail: Pick<RowOf<typeof leads>, 'email'> = { email: null }

export const tool = defineTool({
  title: 'Lookup',
  schema: {
    type: 'function',
    function: {
      name: 'lookup',
      parameters: {
        type: 'object',
        properties: {},
        // @ts-expect-error a schema holds JSON, not functions
        extra: () => 1,
      },
    },
  },
  code: 'return 1',
})
