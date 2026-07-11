/**
 * @vitest-environment node
 *
 * Resource-lock enforcement for `renameTable` / `deleteTable`. Both call
 * `assertResourceMutable('table', tableId)` before mutating — this guards a
 * direct table lock (423, `inherited: false`) and a lock inherited from the
 * table's containing folder (423, `inherited: true`) surface correctly, and
 * that an unrelated-field update still goes through the lock check (only a
 * lock-only `renameTable` call skips it).
 */
import { ResourceLockedError } from '@sim/platform-authz/resource-lock'
import {
  auditMock,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
  resourceLockMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/audit', () => auditMock)

import { deleteTable, renameTable } from '@/lib/table/service'

describe('table service — resource-lock enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    resourceLockMockFns.mockAssertResourceMutable.mockReset()
    resourceLockMockFns.mockAssertResourceMutable.mockResolvedValue(undefined)
  })

  describe('renameTable', () => {
    it('rejects renaming a directly-locked table with a 423', async () => {
      resourceLockMockFns.mockAssertResourceMutable.mockRejectedValueOnce(
        new ResourceLockedError('table', false, 'Table is locked')
      )

      await expect(renameTable('tbl-1', 'new_name', 'req-1')).rejects.toMatchObject({
        status: 423,
        inherited: false,
      })

      expect(resourceLockMockFns.mockAssertResourceMutable).toHaveBeenCalledWith('table', 'tbl-1')
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('rejects renaming a table inside a locked folder with a 423 (inherited)', async () => {
      resourceLockMockFns.mockAssertResourceMutable.mockRejectedValueOnce(
        new ResourceLockedError('table', true, 'Table is locked by its containing folder')
      )

      await expect(renameTable('tbl-1', 'new_name', 'req-1')).rejects.toMatchObject({
        status: 423,
        inherited: true,
      })

      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('enforces the lock check on an unrelated (non-lock) rename update', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([
        {
          id: 'tbl-1',
          createdBy: 'user-1',
          workspaceId: 'ws-1',
          folderId: null,
          locked: false,
        },
      ])

      await renameTable('tbl-1', 'new_name', 'req-1')

      expect(resourceLockMockFns.mockAssertResourceMutable).toHaveBeenCalledWith('table', 'tbl-1')
      expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    })

    it('skips the lock check for a lock-only update (unlocking a directly-locked table)', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([
        {
          id: 'tbl-1',
          createdBy: 'user-1',
          workspaceId: 'ws-1',
          folderId: null,
          locked: false,
        },
      ])

      await renameTable('tbl-1', 'same_name', 'req-1', undefined, undefined, false, true)

      expect(resourceLockMockFns.mockAssertResourceMutable).not.toHaveBeenCalled()
    })

    it('skips the lock check when unlocking a locked table combined with a move in the same request', async () => {
      // Regression test: isLockOnlyUpdate is false whenever folderId also changes, so a
      // combined "unlock + move" request previously still ran assertResourceMutable
      // against the table's current (still-locked) state and was incorrectly rejected,
      // even though the request unlocks it as part of this same atomic write.
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ workspaceId: 'ws-1' }]) // tableRow lookup
        .mockResolvedValueOnce([{ workspaceId: 'ws-1', resourceType: 'table', deletedAt: null }]) // assertFolderParentValid's parent lookup
      dbChainMockFns.returning.mockResolvedValueOnce([
        {
          id: 'tbl-1',
          createdBy: 'user-1',
          workspaceId: 'ws-1',
          folderId: 'folder-1',
          locked: false,
        },
      ])

      await renameTable('tbl-1', 'new_name', 'req-1', undefined, 'folder-1', false, false)

      expect(resourceLockMockFns.mockAssertResourceMutable).not.toHaveBeenCalled()
      expect(resourceLockMockFns.mockAssertFolderMutable).toHaveBeenCalledWith('folder-1', 'table')
      expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    })

    it('rejects moving the table into a locked destination folder with a 423', async () => {
      // Regression test: assertResourceMutable only checks the table's *current*
      // folder chain -- without a separate assertFolderMutable(folderId, ...) check,
      // a table in an unlocked folder could be moved into a locked one.
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ workspaceId: 'ws-1' }]) // tableRow lookup
        .mockResolvedValueOnce([{ workspaceId: 'ws-1', resourceType: 'table', deletedAt: null }]) // assertFolderParentValid's parent lookup
      resourceLockMockFns.mockAssertFolderMutable.mockRejectedValueOnce(
        new ResourceLockedError('table', false, 'Folder is locked')
      )

      await expect(
        renameTable('tbl-1', 'new_name', 'req-1', undefined, 'folder-locked')
      ).rejects.toMatchObject({ status: 423, inherited: false })

      expect(resourceLockMockFns.mockAssertFolderMutable).toHaveBeenCalledWith(
        'folder-locked',
        'table'
      )
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })
  })

  describe('deleteTable', () => {
    it('rejects deleting a directly-locked table with a 423', async () => {
      resourceLockMockFns.mockAssertResourceMutable.mockRejectedValueOnce(
        new ResourceLockedError('table', false, 'Table is locked')
      )

      await expect(deleteTable('tbl-1', 'req-1')).rejects.toMatchObject({
        status: 423,
        inherited: false,
      })

      expect(resourceLockMockFns.mockAssertResourceMutable).toHaveBeenCalledWith('table', 'tbl-1')
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('rejects deleting a table inside a locked folder with a 423 (inherited)', async () => {
      resourceLockMockFns.mockAssertResourceMutable.mockRejectedValueOnce(
        new ResourceLockedError('table', true, 'Table is locked by its containing folder')
      )

      await expect(deleteTable('tbl-1', 'req-1')).rejects.toMatchObject({
        status: 423,
        inherited: true,
      })

      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('enforces the lock check on a normal (non-lock-related) delete', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([
        { createdBy: 'user-1', workspaceId: 'ws-1', name: 'People' },
      ])

      await deleteTable('tbl-1', 'req-1')

      expect(resourceLockMockFns.mockAssertResourceMutable).toHaveBeenCalledWith('table', 'tbl-1')
      expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    })
  })
})
