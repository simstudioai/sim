/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ChatContext } from '@/stores/panel'
import {
  attachSelectionContextToClipboard,
  readSelectionContextFromClipboard,
  SIM_SELECTION_MIME,
} from './selection-clipboard'

/** Minimal DataTransfer stand-in (jsdom-free node env). */
function fakeClipboard(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial }
  return {
    setData: (type: string, value: string) => {
      store[type] = value
    },
    getData: (type: string) => store[type] ?? '',
  } as unknown as DataTransfer
}

const fileSelection: ChatContext = {
  kind: 'file_selection',
  fileId: 'wf_1',
  fileName: 'notes.md',
  label: 'notes.md:2-4',
  text: 'the exact passage',
  startLine: 2,
  endLine: 4,
}

const tableSelection: ChatContext = {
  kind: 'table_selection',
  tableId: 'tbl_1',
  tableName: 'Sales',
  label: 'Sales (2 rows)',
  rowIds: ['r1', 'r2'],
}

function selectionPayload(context: unknown, sourceWorkspaceId = 'ws-1'): string {
  return JSON.stringify({ version: 1, sourceWorkspaceId, context })
}

describe('selection clipboard codec', () => {
  it('round-trips a file selection through the custom MIME type', () => {
    const dt = fakeClipboard()
    attachSelectionContextToClipboard(dt, fileSelection, 'ws-1')
    expect(dt.getData(SIM_SELECTION_MIME)).toContain('file_selection')
    expect(readSelectionContextFromClipboard(dt, 'ws-1')).toEqual(fileSelection)
  })

  it('round-trips a table selection', () => {
    const dt = fakeClipboard()
    attachSelectionContextToClipboard(dt, tableSelection, 'ws-1')
    expect(readSelectionContextFromClipboard(dt, 'ws-1')).toEqual(tableSelection)
  })

  it('does not touch text/plain (rides alongside it)', () => {
    const dt = fakeClipboard({ 'text/plain': 'the exact passage' })
    attachSelectionContextToClipboard(dt, fileSelection, 'ws-1')
    expect(dt.getData('text/plain')).toBe('the exact passage')
  })

  it('rejects cross-workspace and legacy selection payloads', () => {
    expect(
      readSelectionContextFromClipboard(
        fakeClipboard({ [SIM_SELECTION_MIME]: selectionPayload(fileSelection) }),
        'ws-2'
      )
    ).toBeNull()
    expect(
      readSelectionContextFromClipboard(
        fakeClipboard({ [SIM_SELECTION_MIME]: JSON.stringify(fileSelection) }),
        'ws-1'
      )
    ).toBeNull()
  })

  it('returns null when the custom type is absent (plain paste)', () => {
    expect(
      readSelectionContextFromClipboard(fakeClipboard({ 'text/plain': 'hi' }), 'ws-1')
    ).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(
      readSelectionContextFromClipboard(
        fakeClipboard({ [SIM_SELECTION_MIME]: '{not json' }),
        'ws-1'
      )
    ).toBeNull()
  })

  it('rejects a file selection missing its text', () => {
    const dt = fakeClipboard({
      [SIM_SELECTION_MIME]: selectionPayload({
        kind: 'file_selection',
        fileId: 'wf_1',
        fileName: 'notes.md',
        label: 'x',
      }),
    })
    expect(readSelectionContextFromClipboard(dt, 'ws-1')).toBeNull()
  })

  it('rejects a selection missing the resource name the chip renders from', () => {
    const dt = fakeClipboard({
      [SIM_SELECTION_MIME]: selectionPayload({
        kind: 'file_selection',
        fileId: 'wf_1',
        label: 'x',
        text: 'passage',
      }),
    })
    expect(readSelectionContextFromClipboard(dt, 'ws-1')).toBeNull()
  })

  it('rejects a table selection with no rows', () => {
    const dt = fakeClipboard({
      [SIM_SELECTION_MIME]: selectionPayload({
        kind: 'table_selection',
        tableId: 'tbl_1',
        tableName: 'Sales',
        label: 'x',
        rowIds: [],
      }),
    })
    expect(readSelectionContextFromClipboard(dt, 'ws-1')).toBeNull()
  })

  it('rejects an unrelated context kind', () => {
    const dt = fakeClipboard({
      [SIM_SELECTION_MIME]: selectionPayload({
        kind: 'file',
        fileId: 'wf_1',
        label: 'x',
      }),
    })
    expect(readSelectionContextFromClipboard(dt, 'ws-1')).toBeNull()
  })
})
