/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  folderLocationLabel,
  isSearchingResources,
  scopeFolderedItems,
} from '@/app/workspace/[workspaceId]/components/folders/folder-search-scope'

interface Item {
  id: string
  name: string
  description?: string | null
  folderId: string | null
}

const ITEMS: Item[] = [
  { id: 'root-report', name: 'report.pdf', folderId: null },
  { id: 'a-report', name: 'report.pdf', folderId: 'a' },
  { id: 'b-budget', name: 'budget.xlsx', folderId: 'b' },
  { id: 'a-notes', name: 'notes.md', description: 'quarterly report', folderId: 'a' },
]

const scope = (currentFolderId: string | null, search: string) =>
  scopeFolderedItems(ITEMS, {
    currentFolderId,
    search,
    getParentId: (item) => item.folderId,
    getSearchText: (item) => [item.name],
  }).map((item) => item.id)

describe('scopeFolderedItems', () => {
  it('shows only direct children when there is no query', () => {
    expect(scope(null, '')).toEqual(['root-report'])
    expect(scope('a', '')).toEqual(['a-report', 'a-notes'])
  })

  it('treats a whitespace-only query as no query', () => {
    expect(scope('a', '   ')).toEqual(['a-report', 'a-notes'])
  })

  it('searches every folder, not just the open one', () => {
    expect(scope('b', 'report')).toEqual(['root-report', 'a-report'])
  })

  it('finds nested matches from the workspace root', () => {
    expect(scope(null, 'budget')).toEqual(['b-budget'])
  })

  it('matches case-insensitively', () => {
    expect(scope(null, 'BUDGET')).toEqual(['b-budget'])
  })

  it('matches any of several fields independently', () => {
    const ids = scopeFolderedItems(ITEMS, {
      currentFolderId: null,
      search: 'quarterly',
      getParentId: (item) => item.folderId,
      getSearchText: (item) => [item.name, item.description],
    }).map((item) => item.id)
    expect(ids).toEqual(['a-notes'])
  })

  it('never lets a query straddle two fields', () => {
    const ids = scopeFolderedItems([{ id: 'x', name: 'ab', description: 'cd', folderId: null }], {
      currentFolderId: null,
      search: 'bc',
      getParentId: (item) => item.folderId,
      getSearchText: (item) => [item.name, item.description],
    })
    expect(ids).toEqual([])
  })

  it('tolerates absent fields', () => {
    const ids = scopeFolderedItems(ITEMS, {
      currentFolderId: null,
      search: 'report',
      getParentId: (item) => item.folderId,
      getSearchText: (item) => [item.description],
    }).map((item) => item.id)
    expect(ids).toEqual(['a-notes'])
  })
})

describe('isSearchingResources', () => {
  it('ignores whitespace-only queries', () => {
    expect(isSearchingResources('')).toBe(false)
    expect(isSearchingResources('   ')).toBe(false)
    expect(isSearchingResources('a')).toBe(true)
  })
})

describe('folderLocationLabel', () => {
  const folders = new Map([
    ['a', { id: 'a', name: 'Projects', parentId: null }],
    ['b', { id: 'b', name: 'Q3', parentId: 'a' }],
    ['orphan', { id: 'orphan', name: 'Lost', parentId: 'gone' }],
  ])

  it('names the root when the item sits at the root', () => {
    expect(folderLocationLabel(null, folders, 'Files')).toBe('Files')
    expect(folderLocationLabel(undefined, folders, 'Files')).toBe('Files')
  })

  it('joins the ancestor chain root-first', () => {
    expect(folderLocationLabel('a', folders, 'Files')).toBe('Projects')
    expect(folderLocationLabel('b', folders, 'Files')).toBe('Projects / Q3')
  })

  it('says it does not know rather than claiming a partial path or the root', () => {
    expect(folderLocationLabel('orphan', folders, 'Files')).toBe('Unknown')
    expect(folderLocationLabel('missing', folders, 'Files')).toBe('Unknown')
  })
})
