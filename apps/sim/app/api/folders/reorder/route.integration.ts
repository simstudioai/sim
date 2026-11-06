/**
 * Folder reorder against real PostgreSQL with the transaction tripwire in `throw` mode: the lock
 * checks run inside the reorder transaction, so every query they issue must ride that
 * transaction's connection rather than check a second one out of the global pool.
 */
import { db } from '@sim/db'
import { folder, permissions, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { authMock, authMockFns, createMockRequest } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => authMock)

import { PUT } from '@/app/api/folders/reorder/route'

const userId = generateId()
const workspaceId = generateId()
const lockedRootId = generateId()
const lockedChildId = generateId()
const openRootId = generateId()
const openChildId = generateId()
const destinationId = generateId()

function reorder(updates: Array<{ id: string; sortOrder: number; parentId?: string | null }>) {
  return PUT(
    createMockRequest('PUT', { workspaceId, resourceType: 'workflow', updates }),
    undefined
  )
}

describe('PUT /api/folders/reorder in PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Folder reorder fixture',
      email: `${userId}@fixture.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Folder reorder fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    const base = { resourceType: 'workflow' as const, userId, workspaceId }
    await db.insert(folder).values([
      { ...base, id: lockedRootId, name: 'Locked root', locked: true },
      { ...base, id: openRootId, name: 'Open root' },
      { ...base, id: destinationId, name: 'Destination' },
    ])
    await db.insert(folder).values([
      { ...base, id: lockedChildId, name: 'Locked child', parentId: lockedRootId },
      { ...base, id: openChildId, name: 'Open child', parentId: openRootId },
    ])
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: userId } })
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it('reparents and reorders unlocked folders', async () => {
    const response = await reorder([
      { id: openChildId, sortOrder: 3, parentId: destinationId },
      { id: openRootId, sortOrder: 1 },
    ])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, updated: 2 })
    const rows = await db
      .select({ id: folder.id, parentId: folder.parentId, sortOrder: folder.sortOrder })
      .from(folder)
      .where(inArray(folder.id, [openChildId, openRootId]))
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: openChildId, parentId: destinationId, sortOrder: 3 },
        { id: openRootId, parentId: null, sortOrder: 1 },
      ])
    )
  })

  it('refuses to move a folder that inherits a lock from its ancestor', async () => {
    const response = await reorder([{ id: lockedChildId, sortOrder: 0, parentId: destinationId }])

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'Folder is locked by an ancestor folder' })
    const [row] = await db
      .select({ parentId: folder.parentId })
      .from(folder)
      .where(eq(folder.id, lockedChildId))
    expect(row.parentId).toBe(lockedRootId)
  })

  it('refuses to move a folder into a locked destination', async () => {
    const response = await reorder([{ id: destinationId, sortOrder: 0, parentId: lockedRootId }])

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'Folder is locked' })
  })
})
