/**
 * Workspace updates against real Postgres: the session route keeps its legacy
 * refusals, and Chat's settings tool renames a workspace only as an admin and
 * never reaches billing or the personal-key policy.
 */
import { db } from '@sim/db'
import { auditLog, permissions, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => authMock)

import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { settingsServerTool } from '@/lib/mothership/tools/server/settings'
import { updateWorkspace } from '@/lib/workspaces/application/update-workspace'
import { PATCH } from '@/app/api/workspaces/[id]/route'

const adminId = generateId()
const secondAdminId = generateId()
const writerId = generateId()
const outsiderId = generateId()
const workspaceId = generateId()
const archivedWorkspaceId = generateId()
const ORIGINAL_NAME = 'Workspace update fixture'

function signIn(userId: string) {
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: userId, name: 'Fixture', email: `${userId}@workspace-update.test` },
    session: { id: generateId() },
  })
}

function patchWorkspace(id: string, body: Record<string, unknown>) {
  return PATCH(
    new NextRequest(`http://localhost:3000/api/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id }) }
  )
}

function chatSettings(userId: string, input: Record<string, unknown>) {
  return settingsServerTool.execute(
    { scope: 'workspace', ...input } as Parameters<typeof settingsServerTool.execute>[0],
    { copilotToolExecution: true, userId, workspaceId, toolCallId: generateId() }
  )
}

async function readWorkspace() {
  const [row] = await db.select().from(workspace).where(eq(workspace.id, workspaceId))
  return row
}

describe('workspace update operations', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      [adminId, secondAdminId, writerId, outsiderId].map((id) => ({
        id,
        name: 'Workspace update fixture',
        email: `${id}@workspace-update.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await insertWorkspaceFixture(db, [
      {
        id: workspaceId,
        name: ORIGINAL_NAME,
        ownerId: adminId,
        billedAccountUserId: adminId,
        allowPersonalApiKeys: true,
      },
      {
        id: archivedWorkspaceId,
        name: 'Archived fixture',
        ownerId: adminId,
        billedAccountUserId: adminId,
        archivedAt: now,
      },
    ])
    await db.insert(permissions).values([
      ...[workspaceId, archivedWorkspaceId].map((entityId) => ({
        id: generateId(),
        entityType: 'workspace',
        entityId,
        userId: adminId,
        permissionType: 'admin' as const,
      })),
      {
        id: generateId(),
        entityType: 'workspace',
        entityId: workspaceId,
        userId: secondAdminId,
        permissionType: 'admin' as const,
      },
      {
        id: generateId(),
        entityType: 'workspace',
        entityId: workspaceId,
        userId: writerId,
        permissionType: 'write' as const,
      },
    ])
  }, 30_000)

  afterAll(async () => {
    await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
    await db
      .delete(permissions)
      .where(inArray(permissions.entityId, [workspaceId, archivedWorkspaceId]))
    await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, archivedWorkspaceId]))
    await db.delete(user).where(inArray(user.id, [adminId, secondAdminId, writerId, outsiderId]))
  })

  describe('session route', () => {
    it.each([
      ['a write member', writerId, workspaceId],
      ['a non-member', outsiderId, workspaceId],
      ['an admin of an archived workspace', adminId, archivedWorkspaceId],
    ])('refuses %s with the legacy 403 body', async (_label, userId, id) => {
      signIn(userId)
      const response = await patchWorkspace(id, { name: 'Renamed by someone else' })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: 'Insufficient permissions' })
      expect((await readWorkspace()).name).toBe(ORIGINAL_NAME)
    })

    it('rejects an empty patch from an admin', async () => {
      signIn(adminId)
      const response = await patchWorkspace(workspaceId, {})
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'No updates provided' })
    })

    it('refuses a billed-account change to a non-admin with the legacy message', async () => {
      signIn(adminId)
      const response = await patchWorkspace(workspaceId, { billedAccountUserId: writerId })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: 'Billed account must be a workspace admin',
      })
      expect((await readWorkspace()).billedAccountUserId).toBe(adminId)
    })

    it('updates as an admin and answers with the workspace and the admin role', async () => {
      signIn(adminId)
      const response = await patchWorkspace(workspaceId, { allowPersonalApiKeys: false })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.workspace).toMatchObject({
        id: workspaceId,
        allowPersonalApiKeys: false,
        permissions: 'admin',
      })
      expect((await readWorkspace()).allowPersonalApiKeys).toBe(false)
      await db
        .update(workspace)
        .set({ allowPersonalApiKeys: true })
        .where(eq(workspace.id, workspaceId))
    })
  })

  describe('Chat settings tool', () => {
    it('refuses a write member renaming the workspace', async () => {
      await expect(
        chatSettings(writerId, {
          action: 'update',
          section: 'general',
          changes: { name: 'Renamed by a writer' },
        })
      ).rejects.toThrow('Insufficient workspace permissions')
      expect((await readWorkspace()).name).toBe(ORIGINAL_NAME)
    })

    it.each([
      ['billedAccountUserId', { billedAccountUserId: secondAdminId }],
      ['allowPersonalApiKeys', { allowPersonalApiKeys: false }],
    ])('cannot change %s', async (_field, changes) => {
      await expect(
        chatSettings(adminId, { action: 'update', section: 'general', changes })
      ).rejects.toThrow(/Unrecognized key/)
      const row = await readWorkspace()
      expect(row.billedAccountUserId).toBe(adminId)
      expect(row.allowPersonalApiKeys).toBe(true)
    })

    it('cannot reach the full workspace update as a delegated principal', async () => {
      const principal = createTrustedCopilotPrincipal(
        { userId: adminId, workspaceId, delegationId: generateId() },
        { audience: 'sim:settings', ttlMs: 60_000 }
      )
      await expect(
        updateWorkspace.execute({
          principal,
          input: { workspaceId, patch: { billedAccountUserId: adminId } },
        })
      ).rejects.toThrow('cannot perform operation workspaces.update')
    })

    it('renames the workspace as an admin and audits the change as Chat acting for them', async () => {
      const result = await chatSettings(adminId, {
        action: 'update',
        section: 'general',
        changes: { name: '  Renamed by Chat  ' },
      })
      expect(result).toMatchObject({
        status: 'updated',
        value: { id: workspaceId, name: 'Renamed by Chat' },
      })
      expect((await readWorkspace()).name).toBe('Renamed by Chat')
      await vi.waitFor(async () => {
        const entries = await db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.actorId, adminId)))
        const entry = entries.find(
          (row) => toRecord(row.metadata).operation === 'workspaces.identity.update'
        )
        expect(entry).toMatchObject({ action: 'workspace.updated', resourceId: workspaceId })
        expect(entry?.metadata).toMatchObject({
          operation: 'workspaces.identity.update',
          changes: { name: { from: ORIGINAL_NAME, to: 'Renamed by Chat' } },
        })
      })
    })
  })
})
