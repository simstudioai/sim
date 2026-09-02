/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isTableInFolderScope,
  parseFolderScope,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/table-selector/scope'
import type { WorkflowFolder } from '@/stores/folders/types'

function folder(id: string, name: string, parentId: string | null = null): WorkflowFolder {
  return {
    id,
    name,
    parentId,
    resourceType: 'table',
    userId: 'user-1',
    workspaceId: 'ws-1',
    locked: false,
    sortOrder: 0,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    deletedAt: null,
  } as unknown as WorkflowFolder
}

const FOLDERS: Record<string, WorkflowFolder> = {
  reports: folder('reports', 'Reports'),
  q3: folder('q3', 'Q3', 'reports'),
  slashy: folder('slashy', 'Q3/Q4', 'reports'),
  archive: folder('archive', 'Archive'),
}

describe('isTableInFolderScope', () => {
  it('offers everything when no folder is picked', () => {
    expect(isTableInFolderScope({ folderId: 'archive' }, FOLDERS, '')).toBe(true)
    expect(isTableInFolderScope({ folderId: null }, FOLDERS, '')).toBe(true)
  })

  it('keeps a table in the scoped folder and its descendants', () => {
    expect(isTableInFolderScope({ folderId: 'reports' }, FOLDERS, '/Reports')).toBe(true)
    expect(isTableInFolderScope({ folderId: 'q3' }, FOLDERS, '/Reports')).toBe(true)
  })

  it('drops a table outside the scope, including one at the workspace root', () => {
    expect(isTableInFolderScope({ folderId: 'archive' }, FOLDERS, '/Reports')).toBe(false)
    expect(isTableInFolderScope({ folderId: null }, FOLDERS, '/Reports')).toBe(false)
  })

  it('reads a slash inside a folder name as one level', () => {
    /* `Q3/Q4` is ONE folder, so it is not inside a folder called `Q3`. */
    expect(isTableInFolderScope({ folderId: 'slashy' }, FOLDERS, '/Reports/Q3%2FQ4')).toBe(true)
    expect(isTableInFolderScope({ folderId: 'slashy' }, FOLDERS, '/Reports/Q3')).toBe(false)
  })

  it('does not mistake a shared name prefix for containment', () => {
    const folders = { ...FOLDERS, archive2: folder('archive2', 'Reports Archive') }
    expect(isTableInFolderScope({ folderId: 'archive2' }, folders, '/Reports')).toBe(false)
  })

  /*
   * The failure mode is the point. A picker that silently empties reads as
   * "these tables are gone" rather than "your filter is malformed", so a scope
   * that cannot be parsed and a folder the cache has not loaded both fail OPEN.
   */
  it('offers the table when the scope path cannot be parsed', () => {
    expect(isTableInFolderScope({ folderId: 'q3' }, FOLDERS, 'Reports')).toBe(true)
    expect(isTableInFolderScope({ folderId: 'q3' }, FOLDERS, '/Reports/')).toBe(true)
  })

  it('offers the table when its folder is missing from the loaded map', () => {
    expect(isTableInFolderScope({ folderId: 'not-loaded-yet' }, FOLDERS, '/Reports')).toBe(true)
  })

  it('offers the table when the folder map contains a cycle', () => {
    const cyclic: Record<string, WorkflowFolder> = {
      a: folder('a', 'A', 'b'),
      b: folder('b', 'B', 'a'),
    }
    expect(isTableInFolderScope({ folderId: 'a' }, cyclic, '/Reports')).toBe(true)
  })
})

describe('parseFolderScope', () => {
  it('decodes a canonical path once for the whole list', () => {
    expect(parseFolderScope('/Reports/Q3%20Results')).toEqual(['Reports', 'Q3 Results'])
    expect(parseFolderScope('/Reports/Q3%2FQ4')).toEqual(['Reports', 'Q3/Q4'])
  })

  it('reads an empty scope as no scope', () => {
    expect(parseFolderScope('')).toEqual([])
  })

  it('reports an unusable scope as null rather than throwing', () => {
    expect(parseFolderScope('Reports')).toBeNull()
    expect(parseFolderScope('/Reports/')).toBeNull()
  })

  it('feeds pre-parsed segments back through the filter unchanged', () => {
    const segments = parseFolderScope('/Reports')
    expect(isTableInFolderScope({ folderId: 'q3' }, FOLDERS, segments)).toBe(true)
    expect(isTableInFolderScope({ folderId: 'archive' }, FOLDERS, segments)).toBe(false)
  })

  it('fails open when handed a null scope', () => {
    expect(isTableInFolderScope({ folderId: 'archive' }, FOLDERS, null)).toBe(true)
  })
})
