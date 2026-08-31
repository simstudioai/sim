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

  it('renders raw epoch seconds when the saved timezone is invalid', () => {
    expect(
      resolveCellRender({
        value: 1_700_000_000,
        exec: undefined,
        column: column('ttl'),
        waitingOnLabels: undefined,
        timeZone: 'America/Los_Angeles',
        timezoneStatus: 'invalid',
      })
    ).toEqual({ kind: 'date', text: '1700000000', raw: true })
  })

  it('renders the exact stored Date value when timezone settings are unavailable', () => {
    const stored = '2026-01-15T09:00:00-05:00'
    const kind = resolveCellRender({
      value: stored,
      exec: undefined,
      column: column('date'),
      waitingOnLabels: undefined,
      timeZone: 'America/Los_Angeles',
      timezoneStatus: 'error',
    })
    expect(kind).toEqual({ kind: 'date', text: stored, raw: true })
    expect(renderToStaticMarkup(createElement(CellRender, { kind, isEditing: false }))).toContain(
      stored
    )
  })
})
