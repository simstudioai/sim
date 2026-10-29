import { describe, expect, it } from 'vitest'
import {
  filterOutContext,
  prepareContextForInsert,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'

function fileSelection(overrides: Partial<Extract<ChatContext, { kind: 'file_selection' }>> = {}) {
  return {
    kind: 'file_selection',
    fileId: 'file-1',
    fileName: 'notes.md',
    label: 'notes.md:12-40',
    text: 'the exact passage',
    ...overrides,
  } as ChatContext
}

function tableSelection(
  overrides: Partial<Extract<ChatContext, { kind: 'table_selection' }>> = {}
) {
  return {
    kind: 'table_selection',
    tableId: 'tbl-1',
    tableName: 'Sales',
    label: 'Sales (3 rows)',
    rowIds: ['r1', 'r2', 'r3'],
    ...overrides,
  } as ChatContext
}

describe('prepareContextForInsert', () => {
  it('removes only the selected page snapshot and does not attach the same capture twice', () => {
    const first: ChatContext = {
      kind: 'browser_page',
      label: 'Report',
      snapshot: {
        id: 'd773099c-aebd-4f5d-9dc5-a9214aa3fa36',
        url: 'https://example.com/report',
        title: 'Report',
        text: 'Original page',
        capturedAt: '2026-01-01T00:00:00.000Z',
        kind: 'page',
        truncated: false,
      },
    }
    const second: ChatContext = {
      ...first,
      snapshot: { ...first.snapshot, id: 'a1cc9c91-1aaa-4093-a9cf-28b721720bb4' },
    }
    const added = prepareContextForInsert(second, [first])

    expect(prepareContextForInsert(first, [first])).toBeNull()
    expect(added).not.toBeNull()
    if (!added) throw new Error('A distinct snapshot was discarded')
    expect(added.label).not.toBe(first.label)
    expect(filterOutContext([first, added], first)).toEqual([added])
  })

  it('rejects re-adding the exact same selection', () => {
    expect(prepareContextForInsert(tableSelection(), [tableSelection()])).toBeNull()
    expect(prepareContextForInsert(fileSelection(), [fileSelection()])).toBeNull()
  })

  it('distinguishes identical text highlighted at two places in one file', () => {
    // A repeated line — an import, a closing brace — selected twice. Comparing
    // text alone would call the second a duplicate and silently drop its chip.
    const first = fileSelection({ label: 'notes.md:12', startLine: 12, endLine: 12 })
    const second = fileSelection({ label: 'notes.md:50', startLine: 50, endLine: 50 })

    expect(prepareContextForInsert(second, [first])).not.toBeNull()
    expect(prepareContextForInsert(first, [first])).toBeNull()
  })

  it('treats the same rows picked in a different order as one selection', () => {
    // Row ids iterate in click order, so re-picking the same rows differently
    // must no-op rather than add a second chip over rows already referenced.
    const reordered = tableSelection({ rowIds: ['r3', 'r1', 'r2'] })

    expect(prepareContextForInsert(reordered, [tableSelection()])).toBeNull()
  })

  it('distinguishes a cell range from the whole rows it spans', () => {
    const range = tableSelection({ columnIds: ['c_name'] })

    expect(prepareContextForInsert(range, [tableSelection()])).not.toBeNull()
  })

  it('ordinalizes within a batch when the caller threads each result forward', () => {
    // How insertContextChips applies a multi-context handoff: `selectedContexts`
    // is React state read through a ref and does not reflect an add until the
    // next render, so the batch must accumulate locally or the second colliding
    // chip is silently dropped.
    const batch = [tableSelection(), tableSelection({ rowIds: ['r7', 'r8', 'r9'] })]
    let attached: ChatContext[] = []
    const prepared: ChatContext[] = []
    for (const context of batch) {
      const next = prepareContextForInsert(context, attached)
      if (!next) continue
      prepared.push(next)
      attached = [...attached, next]
    }

    expect(prepared.map((c) => c.label)).toEqual(['Sales (3 rows)', 'Sales (3 rows) (2)'])
  })
})
