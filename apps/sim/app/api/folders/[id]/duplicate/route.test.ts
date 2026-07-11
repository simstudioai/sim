/**
 * Tests for the folder-duplicate route's target-parent ancestor walk.
 *
 * @vitest-environment node
 */
import { FolderLockedError } from '@sim/platform-authz/workflow'
import { describe, expect, it, vi } from 'vitest'
import { assertTargetParentFolderMutable } from '@/app/api/folders/[id]/duplicate/route'

describe('assertTargetParentFolderMutable', () => {
  const workspaceId = 'workspace-123'
  const sourceFolderId = 'source-folder'

  /**
   * `assertTargetParentFolderMutable` issues one `select().from().where().limit()`
   * per ancestor hop, in walk order (target parent, then its parent, ...).
   * `eq(folderTable.id, currentFolderId)` isn't inspectable without mocking
   * drizzle-orm, so this mock returns each `chain` entry in call order instead.
   */
  function buildTx(chain: Array<Record<string, unknown> | undefined>) {
    let call = 0
    const limit = vi.fn().mockImplementation(() => {
      const row = chain[call]
      call += 1
      return row ? [row] : []
    })
    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            for: vi.fn().mockReturnValue({ limit }),
            limit,
          }),
        }),
      }),
    } as unknown as Parameters<typeof assertTargetParentFolderMutable>[0]
  }

  it('allows a target parent whose full ancestor chain is active', async () => {
    const tx = buildTx([
      {
        id: 'parent',
        parentId: 'grandparent',
        locked: false,
        workspaceId,
        resourceType: 'workflow',
        deletedAt: null,
      },
      {
        id: 'grandparent',
        parentId: null,
        locked: false,
        workspaceId,
        resourceType: 'workflow',
        deletedAt: null,
      },
    ])

    await expect(
      assertTargetParentFolderMutable(tx, 'parent', workspaceId, sourceFolderId)
    ).resolves.toBeUndefined()
  })

  it('rejects when the immediate target parent is soft-deleted', async () => {
    const tx = buildTx([
      {
        id: 'parent',
        parentId: null,
        locked: false,
        workspaceId,
        resourceType: 'workflow',
        deletedAt: new Date(),
      },
    ])

    await expect(
      assertTargetParentFolderMutable(tx, 'parent', workspaceId, sourceFolderId)
    ).rejects.toThrow('Target parent folder not found')
  })

  it('rejects when an ANCESTOR beyond the immediate parent is soft-deleted (regression: previously only checked the first hop)', async () => {
    const tx = buildTx([
      {
        id: 'parent',
        parentId: 'grandparent',
        locked: false,
        workspaceId,
        resourceType: 'workflow',
        deletedAt: null,
      },
      {
        id: 'grandparent',
        parentId: null,
        locked: false,
        workspaceId,
        resourceType: 'workflow',
        deletedAt: new Date(),
      },
    ])

    await expect(
      assertTargetParentFolderMutable(tx, 'parent', workspaceId, sourceFolderId)
    ).rejects.toThrow('Target parent folder not found')
  })

  it('rejects when the target parent belongs to a different workspace', async () => {
    const tx = buildTx([
      {
        id: 'parent',
        parentId: null,
        locked: false,
        workspaceId: 'other-workspace',
        resourceType: 'workflow',
        deletedAt: null,
      },
    ])

    await expect(
      assertTargetParentFolderMutable(tx, 'parent', workspaceId, sourceFolderId)
    ).rejects.toThrow('Target parent folder not found')
  })

  it('rejects duplicating into the source folder itself', async () => {
    const tx = buildTx([
      {
        id: sourceFolderId,
        parentId: null,
        locked: false,
        workspaceId,
        resourceType: 'workflow',
        deletedAt: null,
      },
    ])

    await expect(
      assertTargetParentFolderMutable(tx, sourceFolderId, workspaceId, sourceFolderId)
    ).rejects.toThrow('Cannot duplicate folder into itself or one of its descendants')
  })

  it('rejects when the target parent is locked', async () => {
    const tx = buildTx([
      {
        id: 'parent',
        parentId: null,
        locked: true,
        workspaceId,
        resourceType: 'workflow',
        deletedAt: null,
      },
    ])

    await expect(
      assertTargetParentFolderMutable(tx, 'parent', workspaceId, sourceFolderId)
    ).rejects.toThrow(FolderLockedError)
  })

  it('is a no-op for a null parentId (duplicating to root)', async () => {
    const tx = buildTx([])

    await expect(
      assertTargetParentFolderMutable(tx, null, workspaceId, sourceFolderId)
    ).resolves.toBeUndefined()
  })
})
