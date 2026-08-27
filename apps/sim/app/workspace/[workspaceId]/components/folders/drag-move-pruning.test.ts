/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { dropRowsCarriedByDraggedFolders } from '@/app/workspace/[workspaceId]/components/folders/use-folder-row-drag-drop'

/**
 * reports/            (a)
 *   └── 2024/         (b)
 *         └── q3/     (c)
 * archive/            (d)
 */
const PARENT_BY_FOLDER: Record<string, string | null> = { a: null, b: 'a', c: 'b', d: null }
const FOLDER_BY_RESOURCE: Record<string, string | null> = {
  'file-in-a': 'a',
  'file-in-c': 'c',
  'file-in-d': 'd',
  'file-at-root': null,
}

const DESCENDANTS = new Map<string, Set<string>>([
  ['a', new Set(['b', 'c'])],
  ['b', new Set(['c'])],
  ['c', new Set()],
  ['d', new Set()],
])

const accessors = {
  descendantsByFolderId: DESCENDANTS,
  getFolderParentId: (id: string) => PARENT_BY_FOLDER[id],
  getResourceFolderId: (id: string) => FOLDER_BY_RESOURCE[id],
}

const prune = (folderIds: string[], resourceIds: string[]) =>
  dropRowsCarriedByDraggedFolders({ folderIds, resourceIds }, accessors)

describe('dropRowsCarriedByDraggedFolders', () => {
  it('leaves a move with no folders untouched', () => {
    expect(prune([], ['file-in-a', 'file-in-d'])).toEqual({
      folderIds: [],
      resourceIds: ['file-in-a', 'file-in-d'],
    })
  })

  it('drops a file that the dragged folder directly contains', () => {
    expect(prune(['a'], ['file-in-a', 'file-in-d'])).toEqual({
      folderIds: ['a'],
      resourceIds: ['file-in-d'],
    })
  })

  it('drops a file nested deeper inside the dragged folder', () => {
    expect(prune(['a'], ['file-in-c'])).toEqual({ folderIds: ['a'], resourceIds: [] })
  })

  it('drops a descendant folder dragged alongside its ancestor', () => {
    expect(prune(['a', 'c'], [])).toEqual({ folderIds: ['a'], resourceIds: [] })
    expect(prune(['a', 'b', 'c'], [])).toEqual({ folderIds: ['a'], resourceIds: [] })
  })

  it('keeps unrelated folders and root-level files', () => {
    expect(prune(['a', 'd'], ['file-at-root'])).toEqual({
      folderIds: ['a', 'd'],
      resourceIds: ['file-at-root'],
    })
  })

  it('never drops the only dragged folder', () => {
    expect(prune(['c'], [])).toEqual({ folderIds: ['c'], resourceIds: [] })
  })

  it('can empty the move entirely when every row rides along', () => {
    expect(prune(['a'], ['file-in-a'])).toEqual({ folderIds: ['a'], resourceIds: [] })
    expect(prune(['a', 'b'], ['file-in-c'])).toEqual({ folderIds: ['a'], resourceIds: [] })
  })
})
