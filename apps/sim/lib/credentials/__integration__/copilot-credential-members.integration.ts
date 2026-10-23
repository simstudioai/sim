/** Chat's in-process CLI sharing a workspace OAuth credential as the delegating credential admin. */

import { db } from '@sim/db'
import {
  account,
  auditLog,
  credential,
  credentialMember,
  member,
  organization,
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => ({ ...envFlagsMock, isAccessControlEnabled: true }))

import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import '@/app/api/v2/credentials/[credentialId]/members/route'
import '@/app/api/v2/credentials/[credentialId]/members/[userId]/route'

const ORIGIN = 'http://localhost:3000'
const organizationId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const adminId = generateId()
const teammateId = generateId()
const writerId = generateId()
const outsiderId = generateId()
const coAdminId = generateId()
const restrictedAdminId = generateId()
const credentialId = generateId()
const serviceAccountCredentialId = generateId()
const userIds = [adminId, teammateId, writerId, outsiderId, coAdminId, restrictedAdminId]

function chat(userId: string, chatWorkspaceId = workspaceId, targetCredentialId = credentialId) {
  const transport = createScopedCliTransport(ORIGIN, {
    userId,
    workspaceId: chatWorkspaceId,
    chatId: generateId(),
  })
  return (path: string, init?: { method: string; body?: unknown }) =>
    withWorkspaceInvocationScope({ workspaceId: chatWorkspaceId, organizationId }, () =>
      transport(`${ORIGIN}/api/v2/credentials/${targetCredentialId}/members${path}`, {
        method: init?.method ?? 'GET',
        ...(init?.body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(init.body),
            }),
      })
    )
}

const query = `?workspaceId=${workspaceId}`

function activeGrantsFor(userId: string) {
  return db
    .select({ role: credentialMember.role })
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.credentialId, credentialId),
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active')
      )
    )
}

describe('chat-delegated credential sharing', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      userIds.map((id) => ({
        id,
        name: 'Credential sharing fixture',
        email: `${id}@credential-sharing.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values({
      id: organizationId,
      name: 'Credential sharing fixture',
      slug: organizationId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(member).values(
      userIds.map((userId) => ({
        id: generateId(),
        userId,
        organizationId,
        role: 'member',
        createdAt: now,
      }))
    )
    await insertWorkspaceFixture(
      db,
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: 'Credential sharing fixture',
        ownerId: adminId,
        billedAccountUserId: adminId,
        organizationId,
        workspaceMode: 'organization' as const,
      }))
    )
    await db.insert(permissions).values(
      (
        [
          [adminId, workspaceId, 'admin'],
          [adminId, otherWorkspaceId, 'admin'],
          [coAdminId, workspaceId, 'admin'],
          [restrictedAdminId, workspaceId, 'admin'],
          [teammateId, workspaceId, 'write'],
          [writerId, workspaceId, 'write'],
          [outsiderId, otherWorkspaceId, 'write'],
        ] as const
      ).map(([userId, entityId, permissionType]) => ({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId,
        permissionType,
      }))
    )
    const accountId = generateId()
    await db.insert(account).values({
      id: accountId,
      userId: adminId,
      providerId: 'slack',
      accountId: generateId(),
      accessToken: 'fixture-access',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(credential).values({
      id: credentialId,
      type: 'oauth',
      workspaceId,
      accountId,
      providerId: 'slack',
      displayName: 'Slack fixture',
      createdBy: adminId,
    })
    await db.insert(credential).values({
      id: serviceAccountCredentialId,
      type: 'service_account',
      workspaceId,
      providerId: 'slack',
      displayName: 'Service account fixture',
      createdBy: adminId,
    })
    const groupId = generateId()
    await db.insert(permissionGroup).values({
      id: groupId,
      organizationId,
      name: 'No integrations',
      createdBy: adminId,
      config: { hideIntegrationsTab: true },
    })
    await db.insert(permissionGroupWorkspace).values({
      id: generateId(),
      permissionGroupId: groupId,
      workspaceId,
      organizationId,
    })
    await db.insert(permissionGroupMember).values({
      id: generateId(),
      permissionGroupId: groupId,
      organizationId,
      userId: restrictedAdminId,
    })
  })

  afterAll(async () => {
    await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
    await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await db.delete(user).where(inArray(user.id, userIds))
  })

  it('shares, lists and unshares the credential as its admin', async () => {
    const asAdmin = chat(adminId)

    const shared = await asAdmin(query, {
      method: 'POST',
      body: { userId: teammateId, role: 'member' },
    })
    expect(shared.status).toBe(201)
    expect(await shared.json()).toMatchObject({
      data: { userId: teammateId, role: 'member', created: true },
    })
    expect(await activeGrantsFor(teammateId)).toEqual([{ role: 'member' }])
    await vi.waitFor(async () => {
      const [audit] = await db
        .select({ actorId: auditLog.actorId, metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.resourceId, credentialId)))
      expect(audit).toMatchObject({
        actorId: adminId,
        metadata: {
          operation: 'credentials.members.upsert',
          actor: { kind: 'delegated', serviceId: 'copilot' },
          targetUserId: teammateId,
        },
      })
    })

    const listed = await asAdmin(query)
    expect(listed.status).toBe(200)
    expect((await listed.json()).data).toContainEqual(
      expect.objectContaining({ userId: teammateId, role: 'member' })
    )

    const removed = await asAdmin(`/${teammateId}${query}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toMatchObject({ data: { userId: teammateId, revoked: true } })
    expect(await activeGrantsFor(teammateId)).toEqual([])
  })

  it('refuses sharing from a workspace member who is not a credential admin', async () => {
    const response = await chat(writerId)(query, {
      method: 'POST',
      body: { userId: teammateId, role: 'admin' },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', details: { code: 'CREDENTIAL_ADMIN_ACCESS_REQUIRED' } },
    })
    expect(await activeGrantsFor(teammateId)).toEqual([])
  })

  it('refuses sharing with someone outside the credential workspace', async () => {
    const response = await chat(adminId)(query, {
      method: 'POST',
      body: { userId: outsiderId, role: 'member' },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { message: 'Target user must belong to the credential workspace' },
    })
    expect(await activeGrantsFor(outsiderId)).toEqual([])
  })

  it('refuses a chat pinned to another workspace', async () => {
    const response = await chat(adminId, otherWorkspaceId)(query, {
      method: 'POST',
      body: { userId: teammateId, role: 'member' },
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Resource not found in the selected workspace' },
    })
    expect(await activeGrantsFor(teammateId)).toEqual([])
  })

  it('confines Chat to OAuth credentials even for a workspace admin', async () => {
    const asAdmin = chat(adminId, workspaceId, serviceAccountCredentialId)
    const refusal = { error: { message: 'Only oauth credentials can be managed by this caller' } }

    const listed = await asAdmin(query)
    expect(listed.status).toBe(400)
    expect(await listed.json()).toMatchObject(refusal)

    const shared = await asAdmin(query, {
      method: 'POST',
      body: { userId: teammateId, role: 'member' },
    })
    expect(shared.status).toBe(400)
    expect(await shared.json()).toMatchObject(refusal)
  })

  it("refuses demoting or removing a workspace admin's existing grant", async () => {
    const asAdmin = chat(adminId)
    const granted = await asAdmin(query, {
      method: 'POST',
      body: { userId: coAdminId, role: 'admin' },
    })
    expect(granted.status).toBe(201)
    expect(await activeGrantsFor(coAdminId)).toEqual([{ role: 'admin' }])

    const demoted = await asAdmin(query, {
      method: 'POST',
      body: { userId: coAdminId, role: 'member' },
    })
    expect(demoted.status).toBe(400)
    expect(await demoted.json()).toMatchObject({
      error: {
        message: 'Workspace admins are automatically credential admins and cannot be demoted',
      },
    })
    expect(await activeGrantsFor(coAdminId)).toEqual([{ role: 'admin' }])

    const removed = await asAdmin(`/${coAdminId}${query}`, { method: 'DELETE' })
    expect(removed.status).toBe(400)
    expect(await removed.json()).toMatchObject({
      error: {
        message: 'Workspace admins are automatically credential admins and cannot be removed',
      },
    })
    expect(await activeGrantsFor(coAdminId)).toEqual([{ role: 'admin' }])
  })

  it('refuses an admin whose permission group withholds integration management', async () => {
    const asRestricted = chat(restrictedAdminId)
    const blocked = {
      error: { code: 'FORBIDDEN', details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' } },
    }

    const listed = await asRestricted(query)
    expect(listed.status).toBe(403)
    expect(await listed.json()).toMatchObject(blocked)

    const shared = await asRestricted(query, {
      method: 'POST',
      body: { userId: teammateId, role: 'member' },
    })
    expect(shared.status).toBe(403)
    expect(await shared.json()).toMatchObject(blocked)
    expect(await activeGrantsFor(teammateId)).toEqual([])
  })
})
