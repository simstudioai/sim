/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { FolderCollectionFullError, FolderCollectionLimitExceededError } from '@/lib/folders/errors'
import {
  assertFolderCollectionHasRoom,
  findActiveFolder,
  listActiveFolderRows,
  listFoldersForWorkspace,
  loadActiveFolderPathIndex,
  resolveFolderPathFilter,
  resolveRestoredFolderId,
  toFolderApi,
  wouldCreateFolderCycle,
} from '@/lib/folders/queries'

/** The condition passed to the Nth `.where()` of this test. */
function whereAt(index: number): unknown {
  return dbChainMockFns.where.mock.calls[index]?.[0]
}

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
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * The only lookup keyed on a caller-supplied folder id, so the `resourceType` clause is the
   * sole guard against crossing resource trees (rationale in `findActiveFolder`). Every caller
   * mocks this module out, so deleting that clause used to leave the whole suite green.
   */
  describe('findActiveFolder', () => {
    it('scopes by id, workspace, resourceType, and active state', async () => {
      queueTableRows(schemaMock.folder, [ROW])

      await findActiveFolder('f-1', 'ws-1', 'knowledge_base')

      const where = whereAt(0)
      expect(hasMockCondition(where, (n) => n.type === 'eq' && n.right === 'f-1')).toBe(true)
      expect(hasMockCondition(where, (n) => n.type === 'eq' && n.right === 'ws-1')).toBe(true)
      expect(hasMockCondition(where, (n) => n.type === 'eq' && n.right === 'knowledge_base')).toBe(
        true
      )
      // Archived folders are not valid destinations — a row filed under one is unreachable.
      // Pinned to the column so the check cannot be satisfied by some other nullable filter.
      expect(
        hasMockCondition(
          where,
          (n) => n.type === 'isNull' && n.column === schemaMock.folder.deletedAt
        )
      ).toBe(true)
    })

    it('returns null when no row matches', async () => {
      queueTableRows(schemaMock.folder, [])

      expect(await findActiveFolder('f-1', 'ws-1', 'workflow')).toBeNull()
    })
  })

  describe('wouldCreateFolderCycle', () => {
    it('detects the immediate self-parent case without querying', async () => {
      expect(await wouldCreateFolderCycle('f-1', 'f-1', 'workflow')).toBe(true)
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    })

    it('scopes every step of the upward walk to resourceType', async () => {
      // Without the clause the walk can leave this resource's tree via a caller-supplied
      // parent id and report "no cycle" from another tree's ancestry.
      queueTableRows(schemaMock.folder, [{ parentId: 'grandparent' }])
      queueTableRows(schemaMock.folder, [{ parentId: null }])

      await wouldCreateFolderCycle('f-1', 'parent-1', 'table')

      expect(dbChainMockFns.where.mock.calls.length).toBeGreaterThanOrEqual(2)
      for (const [where] of dbChainMockFns.where.mock.calls) {
        expect(hasMockCondition(where, (n) => n.type === 'eq' && n.right === 'table')).toBe(true)
      }
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

    it('returns false when the walk reaches the root', async () => {
      queueTableRows(schemaMock.folder, [{ parentId: null }])

      expect(await wouldCreateFolderCycle('f-1', 'parent-1', 'workflow')).toBe(false)
    })
  })

  /**
   * The `restoringFolderIds` short-circuit is load-bearing for cascade ordering: the
   * `config.restoreChildren` hook path runs before the un-archive transaction, so without the
   * set a plain "is my folder active?" check dumps the subtree at the workspace root.
   */
  describe('resolveRestoredFolderId', () => {
    it('keeps the folder without querying when it is in the restoring set', async () => {
      const result = await resolveRestoredFolderId('f-1', 'ws-1', 'workflow', new Set(['f-1']))

      expect(result).toBe('f-1')
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    })

    it('re-roots to null when the original folder is not active', async () => {
      queueTableRows(schemaMock.folder, [])

      expect(await resolveRestoredFolderId('f-1', 'ws-1', 'workflow')).toBeNull()
    })

    it('keeps the folder when it is still active outside a cascade', async () => {
      queueTableRows(schemaMock.folder, [ROW])

      expect(await resolveRestoredFolderId('f-1', 'ws-1', 'workflow')).toBe('f-1')
    })

    it('re-roots when the resource has no folder or no workspace', async () => {
      expect(await resolveRestoredFolderId(null, 'ws-1', 'workflow')).toBeNull()
      expect(await resolveRestoredFolderId('f-1', null, 'workflow')).toBeNull()
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    })
  })

  describe('listFoldersForWorkspace', () => {
    it('scopes to workspace and resourceType, and to active rows by default', async () => {
      queueTableRows(schemaMock.folder, [ROW])

      await listFoldersForWorkspace('ws-1', 'active', 'table')

      const where = whereAt(0)
      expect(hasMockCondition(where, (n) => n.type === 'eq' && n.right === 'ws-1')).toBe(true)
      expect(hasMockCondition(where, (n) => n.type === 'eq' && n.right === 'table')).toBe(true)
      expect(
        hasMockCondition(
          where,
          (n) => n.type === 'isNull' && n.column === schemaMock.folder.deletedAt
        )
      ).toBe(true)
      expect(hasMockCondition(where, (n) => n.type === 'isNotNull')).toBe(false)
    })

    it('inverts the soft-delete filter for the archived scope', async () => {
      queueTableRows(schemaMock.folder, [])

      await listFoldersForWorkspace('ws-1', 'archived', 'workflow')

      const where = whereAt(0)
      expect(
        hasMockCondition(
          where,
          (n) => n.type === 'isNotNull' && n.column === schemaMock.folder.deletedAt
        )
      ).toBe(true)
      expect(hasMockCondition(where, (n) => n.type === 'isNull')).toBe(false)
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

    /**
     * The bound stays opt-in. Creation now refuses at
     * `MAX_FOLDERS_PER_WORKSPACE`, but a workspace that crossed the ceiling
     * before that guard existed — or through a create path that still bypasses
     * the orchestration engine — must stay readable. Defaulting the bound would
     * turn every path-index consumer into a hard failure for a state that
     * already exists in production data.
     */
    it('leaves the read unbounded when no maxRows is given', async () => {
      queueTableRows(schemaMock.folder, [
        ROW,
        { ...ROW, id: 'f-2', name: 'Archive' },
        { ...ROW, id: 'f-3', name: 'Drafts' },
      ])

      const index = await loadActiveFolderPathIndex('ws-1', 'workflow')

      expect(dbChainMockFns.limit).not.toHaveBeenCalled()
      expect(index.rowById.size).toBe(3)
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

    it('still refuses a workspace that is already past the ceiling', async () => {
      queueTableRows(schemaMock.folder, [{ total: MAX_FOLDERS_PER_WORKSPACE + 1 }])

      await expect(assertFolderCollectionHasRoom('ws-1', 'table')).rejects.toBeInstanceOf(
        FolderCollectionFullError
      )
    })

    it('allows a create below the ceiling and counts only this resource type', async () => {
      queueTableRows(schemaMock.folder, [{ total: MAX_FOLDERS_PER_WORKSPACE - 1 }])

      await expect(assertFolderCollectionHasRoom('ws-1', 'knowledge_base')).resolves.toBeUndefined()

      const where = whereAt(0)
      expect(hasMockCondition(where, (n) => n.type === 'eq' && n.right === 'knowledge_base')).toBe(
        true
      )
      expect(
        hasMockCondition(
          where,
          (n) => n.type === 'isNull' && n.column === schemaMock.folder.deletedAt
        )
      ).toBe(true)
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

    it('allows a bulk create that exactly fills the ceiling', async () => {
      queueTableRows(schemaMock.folder, [{ total: MAX_FOLDERS_PER_WORKSPACE - 4 }])

      await expect(
        assertFolderCollectionHasRoom('ws-1', 'workflow', undefined, { additionalRows: 4 })
      ).resolves.toBeUndefined()
    })

    /**
     * A copy that creates no folders is not a create. An over-cap workspace must still be
     * able to run one, so the count is not even issued.
     */
    it('skips the count entirely when no rows are being added', async () => {
      await expect(
        assertFolderCollectionHasRoom('ws-1', 'workflow', undefined, { additionalRows: 0 })
      ).resolves.toBeUndefined()
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
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

    it('treats an omitted path as no filter at all', () => {
      expect(resolveFolderPathFilter(index, undefined)).toEqual({ kind: 'unfiltered' })
    })

    it('resolves the root path to the workspace root rather than to a folder id', () => {
      expect(resolveFolderPathFilter(index, '/')).toEqual({ kind: 'folder', folderId: null })
    })

    it('resolves a named path to its folder id', () => {
      expect(resolveFolderPathFilter(index, 'Reports')).toEqual({ kind: 'folder', folderId: 'f-1' })
    })

    /**
     * A path naming no active folder narrows the list to nothing. Widening it to
     * `unfiltered` would answer a scoped read with every row in the workspace.
     */
    it('narrows to nothing for a path that names no active folder', () => {
      expect(resolveFolderPathFilter(index, 'Archive')).toEqual({ kind: 'noMatch' })
    })
  })

  describe('toFolderApi', () => {
    it('serializes timestamps to ISO strings and preserves a null deletedAt', () => {
      expect(toFolderApi(ROW)).toMatchObject({
        id: 'f-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      })
    })

    it('serializes a present deletedAt rather than dropping it', () => {
      const deleted = { ...ROW, deletedAt: new Date('2026-03-03T00:00:00.000Z') }

      expect(toFolderApi(deleted).deletedAt).toBe('2026-03-03T00:00:00.000Z')
    })
  })
})
