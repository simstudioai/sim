/**
 * @vitest-environment node
 *
 * `checkFolderCircularReference` is the generic (resourceType-agnostic) cycle
 * guard shared by all four folder update paths -- regression coverage for the
 * bug where the knowledge_base/table branch of performUpdateFolder had no
 * cycle check at all (only workflow/file did), letting a folder be reparented
 * into its own descendant and silently detach the subtree from the root.
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

import {
  assertFolderParentValid,
  checkFolderCircularReference,
} from '@/lib/folders/parent-validation'

describe('checkFolderCircularReference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('detects a direct cycle (moving a folder under its immediate child)', async () => {
    const result = await checkFolderCircularReference('folder-a', 'folder-a')
    expect(result).toBe(true)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('detects an indirect cycle (moving a folder under a deeper descendant)', async () => {
    // folder-a is being moved under folder-c, whose chain is c -> b -> a.
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ parentId: 'folder-b' }]) // folder-c's parent
      .mockResolvedValueOnce([{ parentId: 'folder-a' }]) // folder-b's parent

    const result = await checkFolderCircularReference('folder-a', 'folder-c')
    expect(result).toBe(true)
  })

  it('allows reparenting into an unrelated folder', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ parentId: 'folder-y' }])
      .mockResolvedValueOnce([{ parentId: null }])

    const result = await checkFolderCircularReference('folder-a', 'folder-x')
    expect(result).toBe(false)
  })

  it('allows reparenting to root (no ancestor chain to walk)', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ parentId: null }])

    const result = await checkFolderCircularReference('folder-a', 'folder-x')
    expect(result).toBe(false)
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(1)
  })

  it('treats an already-corrupt chain (unrelated cycle) as a cycle rather than looping forever', async () => {
    // folder-x -> folder-y -> folder-x (pre-existing corruption unrelated to folder-a).
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ parentId: 'folder-y' }])
      .mockResolvedValueOnce([{ parentId: 'folder-x' }])

    const result = await checkFolderCircularReference('folder-a', 'folder-x')
    expect(result).toBe(true)
  })
})

describe('assertFolderParentValid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns null (valid) for a null parentId', async () => {
    const result = await assertFolderParentValid(null, {
      workspaceId: 'ws-1',
      resourceType: 'knowledge_base',
    })
    expect(result).toBeNull()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('rejects a parent in a different workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: 'ws-other', resourceType: 'knowledge_base', deletedAt: null },
    ])

    const result = await assertFolderParentValid('folder-1', {
      workspaceId: 'ws-1',
      resourceType: 'knowledge_base',
    })
    expect(result).toMatchObject({ error: 'Parent folder not found', errorCode: 'validation' })
  })

  it('rejects a soft-deleted parent', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: 'ws-1', resourceType: 'knowledge_base', deletedAt: new Date() },
    ])

    const result = await assertFolderParentValid('folder-1', {
      workspaceId: 'ws-1',
      resourceType: 'knowledge_base',
    })
    expect(result).toMatchObject({ error: 'Parent folder not found', errorCode: 'validation' })
  })

  it('accepts a valid, active, same-workspace, same-resourceType parent', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: 'ws-1', resourceType: 'knowledge_base', deletedAt: null },
    ])

    const result = await assertFolderParentValid('folder-1', {
      workspaceId: 'ws-1',
      resourceType: 'knowledge_base',
    })
    expect(result).toBeNull()
  })
})
