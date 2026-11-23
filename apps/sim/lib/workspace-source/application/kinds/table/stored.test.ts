/**
 * @vitest-environment node
 */
import { createTableDefinition } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { tableCodec } from '@/lib/workspace-source/application/kinds/table/codec'
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

  it('suffixes a colliding name at the column-name limit within it, so the get reads back', () => {
    const long = 'a'.repeat(50)
    const table = createTableDefinition({
      columns: [
        { id: 'col_new', name: long, type: 'string' },
        { id: 'col_old', name: 'renamed', type: 'string' },
      ],
    })

    const { base, printed } = printStoredTable({ table, folderPath: '/' }, 'leads', {
      [long]: { id: 'col_old' },
    })

    const suffixed = Object.keys(base.columns ?? {}).filter((key) => key !== long)
    expect(suffixed).toHaveLength(1)
    expect(suffixed[0].length).toBeLessThanOrEqual(50)
    expect(tableCodec.parse('leads', printed.text, []).diagnostics).toEqual([])
  })
})
