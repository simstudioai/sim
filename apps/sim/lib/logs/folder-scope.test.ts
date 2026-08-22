/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { folderScopeCondition, resolveLogFolderScope } from '@/lib/logs/folder-scope'

interface FolderRow {
  id: string
  name: string
  parentId: string | null
}

const FOLDERS: FolderRow[] = [
  { id: 'a', name: 'a', parentId: null },
  { id: 'a-b', name: 'b', parentId: 'a' },
  { id: 'a-b-c', name: 'c', parentId: 'a-b' },
  { id: 'ab', name: 'ab', parentId: null },
  { id: 'other', name: 'other', parentId: null },
]

describe('resolveLogFolderScope', () => {
  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(schemaMock.folder, FOLDERS)
  })

  it('covers the whole subtree of a selected folder', async () => {
    const scope = await resolveLogFolderScope('workspace-1', ['/a'])

    expect(scope.includesRoot).toBe(false)
    expect([...scope.folderIds].sort()).toEqual(['a', 'a-b', 'a-b-c'])
  })

  it('covers a nested selection without reaching back up the tree', async () => {
    const scope = await resolveLogFolderScope('workspace-1', ['/a/b'])

    expect([...scope.folderIds].sort()).toEqual(['a-b', 'a-b-c'])
  })

  /**
   * `/` prefixes every path in the workspace, so expanding it would turn "runs
   * at the workspace root" into "every run" — inverting the filter rather than
   * widening it.
   */
  it('does not expand the workspace root', async () => {
    const scope = await resolveLogFolderScope('workspace-1', ['/'])

    expect(scope).toEqual({ includesRoot: true, folderIds: [] })
  })

  /** `/a` must not swallow `/ab`; only a full segment boundary is a descendant. */
  it('does not treat a name-prefixed sibling as a descendant', async () => {
    const scope = await resolveLogFolderScope('workspace-1', ['/a'])

    expect(scope.folderIds).not.toContain('ab')
  })

  it('drops a path that names no active folder rather than failing the read', async () => {
    const scope = await resolveLogFolderScope('workspace-1', ['/a', '/gone'])

    expect([...scope.folderIds].sort()).toEqual(['a', 'a-b', 'a-b-c'])
  })

  it('de-duplicates overlapping selections', async () => {
    const scope = await resolveLogFolderScope('workspace-1', ['/a', '/a/b'])

    expect([...scope.folderIds].sort()).toEqual(['a', 'a-b', 'a-b-c'])
  })
})

describe('folderScopeCondition', () => {
  const isUnsatisfiable = (condition: { strings?: readonly string[] }) =>
    condition.strings?.[0] === 'false'

  it('matches nothing when the scope resolved to nothing', () => {
    expect(isUnsatisfiable(folderScopeCondition({ includesRoot: false, folderIds: [] }))).toBe(true)
  })

  it('does not fall back to an unfiltered read when only the root is selected', () => {
    expect(isUnsatisfiable(folderScopeCondition({ includesRoot: true, folderIds: [] }))).toBe(false)
  })
})
