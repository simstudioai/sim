/**
 * @vitest-environment node
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CellRender,
  resolveCellRender,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/cells/cell-render'
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
  it.each(['ready', 'loading', 'invalid', 'error'] as const)(
    'renders TTL as the exact UTC string when timezone status is %s',
    (timezoneStatus) => {
      const value = '2026-06-15T09:00:30Z'
      const kind = resolveCellRender({
        value,
        exec: undefined,
        column: column('ttl'),
        waitingOnLabels: undefined,
        timezoneStatus,
      })
      expect(kind).toEqual({ kind: 'text', text: value })
      expect(renderToStaticMarkup(createElement(CellRender, { kind, isEditing: false }))).toContain(
        value
      )
    }
  )

  it('renders the exact stored Date value when timezone settings are unavailable', () => {
    const stored = '2026-01-15T09:00:00-05:00'
    const kind = resolveCellRender({
      value: stored,
      exec: undefined,
      column: column('date'),
      waitingOnLabels: undefined,
      timezoneStatus: 'error',
    })
    expect(kind).toEqual({ kind: 'date', text: stored, raw: true })
    expect(renderToStaticMarkup(createElement(CellRender, { kind, isEditing: false }))).toContain(
      stored
    )
  })
})
