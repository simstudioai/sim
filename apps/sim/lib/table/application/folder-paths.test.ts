/**
 * @vitest-environment node
 */
import type { folder as folderTable } from '@sim/db/schema'
import { describe, expect, it } from 'vitest'
import { buildFolderPathIndex } from '@/lib/folders/paths'
import {
  archivableTableFolderPath,
  tableFolderPathForId,
} from '@/lib/table/application/folder-paths'

const activeFolder = {
  id: 'folder-active',
  resourceType: 'table' as const,
  name: 'Reports',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
  parentId: null,
  sortOrder: 0,
  locked: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
} as typeof folderTable.$inferSelect

/**
 * The index the listing actually projects against: `loadActiveFolderPathIndex`
 * filters on `isNull(deletedAt)`, so an archived folder is absent from it by
 * construction and its id dangles.
 */
const index = buildFolderPathIndex([activeFolder])
const ARCHIVED_FOLDER_ID = 'folder-archived'

describe('table folder path projection', () => {
  /**
   * The scoping proof. A live table pointing at an unresolvable folder is a
   * genuine inconsistency, so the strict projector every active-only call site
   * uses must keep throwing on the very input the lenient one tolerates.
   */
  it('throws on a dangling folder when the table is expected to be active', () => {
    expect(() => tableFolderPathForId(index, ARCHIVED_FOLDER_ID)).toThrow(
      'Table references an inactive or missing folder'
    )
  })

  it('answers the root path instead, which is where restore would place it', () => {
    expect(archivableTableFolderPath(index, ARCHIVED_FOLDER_ID)).toBe('/')
  })

  it('still resolves a folder that is active', () => {
    expect(archivableTableFolderPath(index, activeFolder.id)).toBe('/Reports')
  })

  it('treats no folder as the root', () => {
    expect(archivableTableFolderPath(index, null)).toBe('/')
    expect(archivableTableFolderPath(index, undefined)).toBe('/')
  })
})
