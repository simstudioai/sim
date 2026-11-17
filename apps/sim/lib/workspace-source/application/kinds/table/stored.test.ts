/**
 * @vitest-environment node
 */
import { createTableDefinition } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { printStoredTable } from '@/lib/workspace-source/application/kinds/table/stored'

describe('printStoredTable', () => {
  it('keeps a bound column on its key when an earlier unbound column is named like that key', () => {
    const table = createTableDefinition({
      columns: [
        { id: 'col_new', name: 'status', type: 'string' },
        { id: 'col_email', name: 'email', type: 'string' },
        { id: 'col_status', name: 'stage', type: 'string' },
      ],
    })

    const { base } = printStoredTable({ table, folderPath: '/' }, 'leads', {
      email: { id: 'col_email' },
      status: { id: 'col_status' },
    })

    expect(base.columns).toEqual({
      email: { id: 'col_email' },
      status: { id: 'col_status' },
      status_2: { id: 'col_new' },
    })
  })
})
