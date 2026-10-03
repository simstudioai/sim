import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { FolderCollectionFullError, FolderCollectionLimitExceededError } from '@/lib/folders/errors'
import {
  assertFolderCollectionHasRoom,
  findArchivedFolderIdByPath,
  listActiveFolderRows,
  loadActiveFolderPathIndex,
  resolveFolderPathFilter,
  resolveRestoredFolderId,
  wouldCreateFolderCycle,
} from '@/lib/folders/queries'

const ROW = {
  id: 'f-1',
  resourceType: 'workflow' as const,
  name: 'Reports',
  userId: 'u-1',
  workspaceId: 'ws-1',
  parentId: null,
  locked: false,
  sortOrder: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
}

describe('folder queries', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  describe('wouldCreateFolderCycle', () => {
    it('detects the immediate self-parent case without querying', async () => {
      expect(await wouldCreateFolderCycle('f-1', 'f-1', 'workflow')).toBe(true)
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    })

    it('reports a cycle when the walk reaches the folder being reparented', async () => {
      queueTableRows(schemaMock.folder, [{ parentId: 'f-1' }])

      expect(await wouldCreateFolderCycle('f-1', 'parent-1', 'workflow')).toBe(true)
    })

    it('terminates on a pre-existing cycle above the folder', async () => {
      // `visited` is what stops this looping forever; concurrent reparents can each pass the
      // check and land a cycle.
      queueTableRows(schemaMock.folder, [{ parentId: 'b' }])
      queueTableRows(schemaMock.folder, [{ parentId: 'a' }])

      expect(await wouldCreateFolderCycle('f-1', 'a', 'workflow')).toBe(true)
    })
  })

  /**
   * The `restoringFolderIds` short-circuit is load-bearing for cascade ordering: the
   * `config.restoreChildren` hook path runs before the un-archive transaction, so without the
   * set a plain "is my folder active?" check dumps the subtree at the workspace root.
   */
  describe('resolveRestoredFolderId', () => {
    it('re-roots to null when the original folder is not active', async () => {
      queueTableRows(schemaMock.folder, [])

      expect(await resolveRestoredFolderId('f-1', 'ws-1', 'workflow')).toBeNull()
    })

    it('re-roots when the resource has no folder or no workspace', async () => {
      expect(await resolveRestoredFolderId(null, 'ws-1', 'workflow')).toBeNull()
      expect(await resolveRestoredFolderId('f-1', null, 'workflow')).toBeNull()
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    })
  })

  describe('bounded folder reads', () => {
    it('fails before building an oversized path index', async () => {
      queueTableRows(schemaMock.folder, [ROW, { ...ROW, id: 'f-2' }, { ...ROW, id: 'f-3' }])

      const rejection = expect(
        loadActiveFolderPathIndex('ws-1', 'knowledge_base', undefined, { maxRows: 2 })
      ).rejects
      await rejection.toBeInstanceOf(FolderCollectionLimitExceededError)
      await rejection.toMatchObject({
        code: 'payload_too_large',
        message: 'Folder path index exceeds the 2 row limit',
      })
      expect(dbChainMockFns.limit).toHaveBeenCalledWith(3)
    })

    it('fails before returning an oversized folder list', async () => {
      queueTableRows(schemaMock.folder, [ROW, { ...ROW, id: 'f-2' }, { ...ROW, id: 'f-3' }])

      const rejection = expect(
        listActiveFolderRows('ws-1', 'knowledge_base', { maxRows: 2 })
      ).rejects
      await rejection.toBeInstanceOf(FolderCollectionLimitExceededError)
      await rejection.toMatchObject({
        code: 'payload_too_large',
        message: 'Folder list exceeds the 2 row limit',
      })
      expect(dbChainMockFns.limit).toHaveBeenCalledWith(3)
    })
  })

  /**
   * The writer half of the ceiling the bounded readers enforce. Without it a
   * workspace could be driven past `MAX_FOLDERS_PER_WORKSPACE`, after which
   * every capped reader fails on a state the product allowed to exist.
   */
  describe('assertFolderCollectionHasRoom', () => {
    it('refuses a create once the active collection is at the ceiling', async () => {
      queueTableRows(schemaMock.folder, [{ total: MAX_FOLDERS_PER_WORKSPACE }])

      const rejection = expect(assertFolderCollectionHasRoom('ws-1', 'workflow')).rejects
      await rejection.toBeInstanceOf(FolderCollectionFullError)
      await rejection.toMatchObject({
        code: 'conflict',
        message:
          'This workspace has reached its limit of 10,000 workflow folders. Delete folders you no longer need before creating another one.',
      })
    })

    /**
     * The bulk writers — recursive duplication, admin import, workspace fork — insert many
     * folders per call. Charging one row and then writing N is the same overflow the ceiling
     * exists to prevent, so the caller declares how many rows it is about to add.
     */
    it('refuses a bulk create that would cross the ceiling from below it', async () => {
      queueTableRows(schemaMock.folder, [{ total: MAX_FOLDERS_PER_WORKSPACE - 3 }])

      const rejection = expect(
        assertFolderCollectionHasRoom('ws-1', 'workflow', undefined, { additionalRows: 4 })
      ).rejects
      await rejection.toBeInstanceOf(FolderCollectionFullError)
      await rejection.toMatchObject({ code: 'conflict' })
    })
  })

  /**
   * The one place the real helper is exercised. Every list use case that filters
   * by `folderPath` mocks this module out and stands a reimplementation in for
   * it, so a defect here — a miss widening to unfiltered, a root path that stops
   * resolving — would leave all of those suites green while every filtered list
   * answered with the wrong rows.
   */
  describe('resolveFolderPathFilter', () => {
    const index = {
      pathById: new Map([['f-1', 'Reports']]),
      idByPath: new Map([['Reports', 'f-1']]),
    }

    it('resolves the root path to the workspace root rather than to a folder id', () => {
      expect(resolveFolderPathFilter(index, '/')).toEqual({ kind: 'folder', folderId: null })
    })

    /**
     * A path naming no active folder narrows the list to nothing. Widening it to
     * `unfiltered` would answer a scoped read with every row in the workspace.
     */
    it('narrows to nothing for a path that names no active folder', () => {
      expect(resolveFolderPathFilter(index, 'Archive')).toEqual({ kind: 'noMatch' })
    })
  })

  /**
   * The path lookup behind `POST /api/v2/tables/folders/restore`. It deliberately does NOT go
   * through `buildFolderPathIndex`: the partial unique index on folder names covers ACTIVE
   * rows only, so an archived `/Reports` and a new active `/Reports` legally coexist and the
   * lossless index would throw on the duplicate path.
   */
  describe('findArchivedFolderIdByPath', () => {
    const ARCHIVED_AT = new Date('2026-02-01T00:00:00.000Z')

    function archived(overrides: Partial<typeof ROW> & { id: string }) {
      return { ...ROW, resourceType: 'table' as const, deletedAt: ARCHIVED_AT, ...overrides }
    }

    it('resolves an archived folder still hanging off an ACTIVE parent', async () => {
      queueTableRows(schemaMock.folder, [
        { ...ROW, id: 'parent', name: 'Sales', resourceType: 'table', deletedAt: null },
        archived({ id: 'child', name: 'Reports', parentId: 'parent' }),
      ])

      expect(await findArchivedFolderIdByPath('ws-1', 'table', '/Sales/Reports')).toBe('child')
    })

    /** Archive, recreate, archive again: two archived rows share one path. */
    it('picks the most recently archived row when a path is ambiguous', async () => {
      queueTableRows(schemaMock.folder, [
        archived({ id: 'old', name: 'Reports' }),
        archived({
          id: 'new',
          name: 'Reports',
          deletedAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
      ])

      expect(await findArchivedFolderIdByPath('ws-1', 'table', '/Reports')).toBe('new')
    })

    it('refuses to restore the workspace root', async () => {
      await expect(findArchivedFolderIdByPath('ws-1', 'table', '/')).rejects.toThrow()
    })

    it('refuses a truncated read rather than resolving against a partial tree', async () => {
      queueTableRows(schemaMock.folder, [
        archived({ id: 'a', name: 'A' }),
        archived({ id: 'b', name: 'B' }),
      ])

      await expect(
        findArchivedFolderIdByPath('ws-1', 'table', '/Reports', { maxRows: 1 })
      ).rejects.toBeInstanceOf(FolderCollectionLimitExceededError)
    })
  })
})
