/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListActiveFolderRows } = vi.hoisted(() => ({
  mockListActiveFolderRows: vi.fn(),
}))

vi.mock('@/lib/folders/queries', () => ({
  listActiveFolderRows: mockListActiveFolderRows,
}))

vi.mock('@/lib/folders/orchestration', () => ({
  deleteFolder: vi.fn(),
  updateFolder: vi.fn(),
}))

vi.mock('@/lib/realtime/notify', () => ({
  notifyFolderResourceChanged: vi.fn(),
}))

import { planFolderSelection } from '@/lib/folders/bulk'

/**
 * `a` holds `a1`, which holds `a1x`. `b` is a sibling with nothing inside it, so a plan can
 * distinguish "carried by an ancestor" from "selected in its own right".
 */
const TREE = [
  { id: 'a', name: 'A', parentId: null },
  { id: 'a1', name: 'A1', parentId: 'a' },
  { id: 'a1x', name: 'A1X', parentId: 'a1' },
  { id: 'b', name: 'B', parentId: null },
]

describe('planFolderSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListActiveFolderRows.mockResolvedValue(TREE)
  })

  const plan = (folderIds: string[]) => planFolderSelection('ws-1', 'table', folderIds)

  it('selects a folder and reports nothing contained', async () => {
    const result = await plan(['a'])
    expect(result.selected).toEqual([{ id: 'a', name: 'A' }])
    expect(result.contained).toEqual([])
    expect([...result.covered].sort()).toEqual(['a', 'a1', 'a1x'])
  })

  it('reports an explicitly selected descendant as contained, not as a second selection', async () => {
    const result = await plan(['a1', 'a'])
    expect(result.selected).toEqual([{ id: 'a', name: 'A' }])
    expect(result.contained).toEqual([{ id: 'a1', name: 'A1' }])
  })

  it('reports the same selection identically whichever order the ids arrive in', async () => {
    // Regression: the ancestor marked its descendants covered, and testing `covered` before
    // containment then dropped an explicitly requested descendant from every outcome
    // category — so reversing the input silently changed what the API reported.
    const ancestorFirst = await plan(['a', 'a1'])
    const descendantFirst = await plan(['a1', 'a'])

    expect(ancestorFirst.selected).toEqual(descendantFirst.selected)
    expect(ancestorFirst.contained).toEqual(descendantFirst.contained)
    expect(ancestorFirst.contained).toEqual([{ id: 'a1', name: 'A1' }])
  })

  it('never drops a requested folder from every outcome category', async () => {
    for (const order of [
      ['a', 'a1', 'a1x'],
      ['a1x', 'a1', 'a'],
      ['a1', 'a1x', 'a'],
    ]) {
      const result = await plan(order)
      const accounted = new Set([
        ...result.selected.map((f) => f.id),
        ...result.contained.map((f) => f.id),
        ...result.notFound,
      ])
      expect([...accounted].sort()).toEqual(['a', 'a1', 'a1x'])
    }
  })

  it('reports ids that resolve to nothing as notFound', async () => {
    const result = await plan(['b', 'ghost'])
    expect(result.selected).toEqual([{ id: 'b', name: 'B' }])
    expect(result.notFound).toEqual(['ghost'])
  })

  it('accounts for a duplicated id exactly once', async () => {
    const result = await plan(['b', 'b'])
    expect(result.selected).toEqual([{ id: 'b', name: 'B' }])
  })
})
