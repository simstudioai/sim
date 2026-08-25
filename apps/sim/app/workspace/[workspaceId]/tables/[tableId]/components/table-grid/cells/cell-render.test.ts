/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveCellRender } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/cells/cell-render'
import type { DisplayColumn } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/types'

function column(type: DisplayColumn['type']): DisplayColumn {
  return {
    key: 'expires_at',
    name: 'expires_at',
    type,
    groupSize: 1,
    groupStartColIndex: 0,
    headerLabel: 'expires_at',
    isGroupStart: true,
  }
}

describe('resolveCellRender', () => {
  it('renders TTL epoch seconds through the date presentation', () => {
    expect(
      resolveCellRender({
        value: 1_700_000_000,
        exec: undefined,
        column: column('ttl'),
        waitingOnLabels: undefined,
        timeZone: 'America/New_York',
      })
    ).toEqual({ kind: 'date', text: '2023-11-14T17:13:20-05:00' })
  })
})
