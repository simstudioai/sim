import { describe, expect, it } from 'vitest'
import {
  folderLocationLabel,
  scopeFolderedItems,
} from '@/app/workspace/[workspaceId]/components/folders/folder-search-scope'

describe('scopeFolderedItems', () => {
  it('never lets a query straddle two fields', () => {
    const ids = scopeFolderedItems([{ id: 'x', name: 'ab', description: 'cd', folderId: null }], {
      currentFolderId: null,
      search: 'bc',
      getParentId: (item) => item.folderId,
      getSearchText: (item) => [item.name, item.description],
    })
    expect(ids).toEqual([])
  })
})

describe('folderLocationLabel', () => {
  const folders = new Map([
    ['a', { id: 'a', name: 'Projects', parentId: null }],
    ['b', { id: 'b', name: 'Q3', parentId: 'a' }],
    ['orphan', { id: 'orphan', name: 'Lost', parentId: 'gone' }],
  ])

  it('says it does not know rather than claiming a partial path or the root', () => {
    expect(folderLocationLabel('orphan', folders, 'Files')).toBe('Unknown')
    expect(folderLocationLabel('missing', folders, 'Files')).toBe('Unknown')
  })
})
