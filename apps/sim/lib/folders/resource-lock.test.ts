/**
 * @vitest-environment node
 *
 * Exercises the real `@sim/platform-authz/resource-lock` engine (not the
 * globally-mocked version from vitest.setup.ts) against a scripted `@sim/db`
 * chain mock, for all four `FolderResourceType`s.
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/platform-authz/resource-lock')
vi.unmock('@sim/platform-authz/workflow')

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  folder: { id: 'folder.id', parentId: 'folder.parentId', locked: 'folder.locked' },
  folderResourceTypeEnum: { enumValues: ['workflow', 'file', 'knowledge_base', 'table'] },
  workflow: { id: 'workflow.id', locked: 'workflow.locked', folderId: 'workflow.folderId' },
  workspace: { id: 'workspace.id', organizationId: 'workspace.organizationId' },
  workspaceFiles: {
    id: 'workspaceFiles.id',
    locked: 'workspaceFiles.locked',
    folderId: 'workspaceFiles.folderId',
  },
  knowledgeBase: {
    id: 'knowledgeBase.id',
    locked: 'knowledgeBase.locked',
    folderId: 'knowledgeBase.folderId',
  },
  userTableDefinitions: {
    id: 'userTableDefinitions.id',
    locked: 'userTableDefinitions.locked',
    folderId: 'userTableDefinitions.folderId',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
  and: vi.fn((...conds) => ({ type: 'and', conds })),
  isNull: vi.fn((a) => ({ type: 'isNull', a })),
}))

import {
  assertFolderMutable,
  assertFolderMutableUnlessUnlocking,
  assertResourceMutable,
  assertResourceMutableUnlessUnlocking,
  type FolderResourceType,
  getFolderLockStatus,
  getResourceLockStatus,
  ResourceLockedError,
} from '@sim/platform-authz/resource-lock'
import { FolderLockedError, WorkflowLockedError } from '@sim/platform-authz/workflow'

const RESOURCE_TYPES: FolderResourceType[] = ['workflow', 'file', 'knowledge_base', 'table']

describe('resource-lock engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  describe.each(RESOURCE_TYPES)('%s', (resourceType) => {
    it('reports unlocked when the resource and its folder chain are unlocked', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([{ locked: false, folderId: null }]) // resource row
      const status = await getResourceLockStatus(resourceType, 'res-1')
      expect(status).toEqual({
        locked: false,
        directLocked: false,
        inheritedLocked: false,
        lockedBy: null,
        lockedFolderId: null,
      })
      await expect(assertResourceMutable(resourceType, 'res-1')).resolves.toBeUndefined()
    })

    it('reports a direct lock on the resource itself', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([{ locked: true, folderId: 'folder-1' }])
      const status = await getResourceLockStatus(resourceType, 'res-1')
      expect(status).toMatchObject({
        locked: true,
        directLocked: true,
        inheritedLocked: false,
        lockedBy: 'resource',
      })
      dbChainMockFns.limit.mockResolvedValueOnce([{ locked: true, folderId: 'folder-1' }])
      await expect(assertResourceMutable(resourceType, 'res-1')).rejects.toThrow(
        ResourceLockedError
      )
    })

    it('reports a lock inherited from a containing folder', async () => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ locked: false, folderId: 'folder-1' }]) // resource row
        .mockResolvedValueOnce([{ id: 'folder-1', parentId: null, locked: true }]) // folder row
      const status = await getResourceLockStatus(resourceType, 'res-1')
      expect(status).toMatchObject({
        locked: true,
        lockedBy: 'folder',
        lockedFolderId: 'folder-1',
      })

      dbChainMockFns.limit
        .mockResolvedValueOnce([{ locked: false, folderId: 'folder-1' }])
        .mockResolvedValueOnce([{ id: 'folder-1', parentId: null, locked: true }])
      let error: unknown
      try {
        await assertResourceMutable(resourceType, 'res-1')
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(ResourceLockedError)
      expect((error as ResourceLockedError).inherited).toBe(true)
    })

    it('assertFolderMutable throws for a locked folder', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'folder-1', parentId: null, locked: true }])
      await expect(assertFolderMutable('folder-1', resourceType)).rejects.toThrow(
        ResourceLockedError
      )
    })

    it('assertFolderMutable no-ops for a null folderId', async () => {
      await expect(assertFolderMutable(null, resourceType)).resolves.toBeUndefined()
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })

    it('getFolderLockStatus returns unlocked once the row is not found', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([])
      const status = await getFolderLockStatus('missing-folder', resourceType)
      expect(status.locked).toBe(false)
    })

    it('getFolderLockStatus keeps walking past a direct lock and reports a locked ancestor, not the direct lock', async () => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ id: 'folder-1', parentId: 'folder-2', locked: true }])
        .mockResolvedValueOnce([{ id: 'folder-2', parentId: null, locked: true }])
      const status = await getFolderLockStatus('folder-1', resourceType)
      expect(status).toMatchObject({
        locked: true,
        directLocked: false,
        inheritedLocked: true,
        lockedBy: 'folder',
        lockedFolderId: 'folder-2',
      })
    })

    it('getFolderLockStatus reports the direct lock when no ancestor is locked', async () => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ id: 'folder-1', parentId: 'folder-2', locked: true }])
        .mockResolvedValueOnce([{ id: 'folder-2', parentId: null, locked: false }])
      const status = await getFolderLockStatus('folder-1', resourceType)
      expect(status).toMatchObject({
        locked: true,
        directLocked: true,
        inheritedLocked: false,
        lockedBy: 'folder',
        lockedFolderId: 'folder-1',
      })
    })

    it('assertFolderMutableUnlessUnlocking bypasses only a direct lock on the target itself', async () => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ id: 'folder-1', parentId: 'folder-2', locked: true }])
        .mockResolvedValueOnce([{ id: 'folder-2', parentId: null, locked: false }])
      await expect(
        assertFolderMutableUnlessUnlocking('folder-1', resourceType, true)
      ).resolves.toBeUndefined()
    })

    it('assertFolderMutableUnlessUnlocking still blocks on a locked ancestor even while bypassing the direct lock', async () => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ id: 'folder-1', parentId: 'folder-2', locked: true }])
        .mockResolvedValueOnce([{ id: 'folder-2', parentId: null, locked: true }])
      await expect(
        assertFolderMutableUnlessUnlocking('folder-1', resourceType, true)
      ).rejects.toThrow(ResourceLockedError)
    })

    it('assertFolderMutableUnlessUnlocking still throws when not unlocking', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'folder-1', parentId: null, locked: true }])
      await expect(
        assertFolderMutableUnlessUnlocking('folder-1', resourceType, false)
      ).rejects.toThrow(ResourceLockedError)
    })

    it('getResourceLockStatus reports a folder-inherited lock even when the resource itself is also directly locked', async () => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ locked: true, folderId: 'folder-1' }]) // resource row (also directly locked)
        .mockResolvedValueOnce([{ id: 'folder-1', parentId: null, locked: true }]) // folder row
      const status = await getResourceLockStatus(resourceType, 'res-1')
      expect(status).toMatchObject({
        locked: true,
        directLocked: false,
        inheritedLocked: true,
        lockedBy: 'folder',
        lockedFolderId: 'folder-1',
      })
    })

    it('assertResourceMutableUnlessUnlocking still blocks on a locked folder even while bypassing a direct resource lock', async () => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ locked: true, folderId: 'folder-1' }])
        .mockResolvedValueOnce([{ id: 'folder-1', parentId: null, locked: true }])
      await expect(
        assertResourceMutableUnlessUnlocking(resourceType, 'res-1', true)
      ).rejects.toThrow(ResourceLockedError)
    })

    it('assertResourceMutableUnlessUnlocking bypasses a direct resource lock when its folder chain is unlocked', async () => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([{ locked: true, folderId: 'folder-1' }])
        .mockResolvedValueOnce([{ id: 'folder-1', parentId: null, locked: false }])
      await expect(
        assertResourceMutableUnlessUnlocking(resourceType, 'res-1', true)
      ).resolves.toBeUndefined()
    })
  })
})

describe('WorkflowLockedError / FolderLockedError subclass regression', () => {
  it('WorkflowLockedError is still an instanceof itself and of the generic ResourceLockedError', () => {
    const error = new WorkflowLockedError('Workflow is locked')
    expect(error).toBeInstanceOf(WorkflowLockedError)
    expect(error).toBeInstanceOf(ResourceLockedError)
    expect(error.status).toBe(423)
    expect(error.message).toBe('Workflow is locked')
  })

  it('FolderLockedError is still an instanceof itself and of the generic ResourceLockedError', () => {
    const error = new FolderLockedError('Folder is locked')
    expect(error).toBeInstanceOf(FolderLockedError)
    expect(error).toBeInstanceOf(ResourceLockedError)
    expect(error.status).toBe(423)
    expect(error.message).toBe('Folder is locked')
  })
})
