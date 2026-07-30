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
  label: 'notes.md:2-4',
  text: 'the exact passage',
  startLine: 2,
  endLine: 4,
}

const tableSelection: ChatContext = {
  kind: 'table_selection',
  tableId: 'tbl_1',
  label: 'Sales (2 rows)',
  rowIds: ['r1', 'r2'],
}

describe('selection clipboard codec', () => {
  it('round-trips a file selection through the custom MIME type', () => {
    const dt = fakeClipboard()
    attachSelectionContextToClipboard(dt, fileSelection)
    expect(dt.getData(SIM_SELECTION_MIME)).toContain('file_selection')
    expect(readSelectionContextFromClipboard(dt)).toEqual(fileSelection)
  })

  it('round-trips a table selection', () => {
    const dt = fakeClipboard()
    attachSelectionContextToClipboard(dt, tableSelection)
    expect(readSelectionContextFromClipboard(dt)).toEqual(tableSelection)
  })

  it('does not touch text/plain (rides alongside it)', () => {
    const dt = fakeClipboard({ 'text/plain': 'the exact passage' })
    attachSelectionContextToClipboard(dt, fileSelection)
    expect(dt.getData('text/plain')).toBe('the exact passage')
  })

  it('returns null when the custom type is absent (plain paste)', () => {
    expect(readSelectionContextFromClipboard(fakeClipboard({ 'text/plain': 'hi' }))).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(
      readSelectionContextFromClipboard(fakeClipboard({ [SIM_SELECTION_MIME]: '{not json' }))
    ).toBeNull()
  })

  it('rejects a file selection missing its text', () => {
    const dt = fakeClipboard({
      [SIM_SELECTION_MIME]: JSON.stringify({ kind: 'file_selection', fileId: 'wf_1', label: 'x' }),
    })
    expect(readSelectionContextFromClipboard(dt)).toBeNull()
  })

  it('rejects a table selection with no rows', () => {
    const dt = fakeClipboard({
      [SIM_SELECTION_MIME]: JSON.stringify({
        kind: 'table_selection',
        tableId: 'tbl_1',
        label: 'x',
        rowIds: [],
      }),
    })
    expect(readSelectionContextFromClipboard(dt)).toBeNull()
  })

  it('rejects an unrelated context kind', () => {
    const dt = fakeClipboard({
      [SIM_SELECTION_MIME]: JSON.stringify({ kind: 'file', fileId: 'wf_1', label: 'x' }),
    })
    expect(readSelectionContextFromClipboard(dt)).toBeNull()
  })
})
