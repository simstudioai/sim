/** Chat's in-process CLI inviting teammates through the public workspace invitation command. */

import { db } from '@sim/db'
import {
  auditLog,
  invitation,
  invitationWorkspaceGrant,
  member,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import '@/app/api/v2/workspaces/[workspaceId]/invitations/route'

const ORIGIN = 'http://localhost:3000'
const organizationId = generateId()
const workspaceId = generateId()
const adminId = generateId()
const writerId = generateId()
const pendingInvitationId = generateId()
const fixtureDomain = `${generateId()}.invite.test`
const newInvitee = `new@${fixtureDomain}`
const pendingInvitee = `pending@${fixtureDomain}`
const writerInvitee = `writer-target@${fixtureDomain}`

function inviteFromChat(userId: string, emails: string[]) {
  const transport = createScopedCliTransport(ORIGIN, { userId, workspaceId, chatId: generateId() })
  return withWorkspaceInvocationScope({ workspaceId, organizationId }, () =>
    transport(`${ORIGIN}/api/v2/workspaces/${workspaceId}/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emails, permission: 'write', membership: 'member' }),
    })
  )
}

function pendingInvitationsFor(email: string) {
  return db
    .select({ id: invitation.id, inviterId: invitation.inviterId })
    .from(invitation)
    .where(and(eq(invitation.email, email), eq(invitation.status, 'pending')))
}

function grantsOf(invitationId: string) {
  return db
    .select({
      workspaceId: invitationWorkspaceGrant.workspaceId,
      permission: invitationWorkspaceGrant.permission,
    })
    .from(invitationWorkspaceGrant)
    .where(eq(invitationWorkspaceGrant.invitationId, invitationId))
}

describe('chat-delegated workspace invitations', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      [adminId, writerId].map((id) => ({
        id,
        name: 'Invitation fixture',
        email: `${id}@${fixtureDomain}`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values({
      id: organizationId,
      name: 'Invitation fixture',
      slug: organizationId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(member).values(
      [adminId, writerId].map((userId) => ({
        id: generateId(),
        userId,
        organizationId,
        role: 'member',
        createdAt: now,
      }))
    )
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Invitation fixture',
      ownerId: adminId,
      billedAccountUserId: adminId,
      organizationId,
      workspaceMode: 'organization',
    })
    await db.insert(permissions).values([
      {
        id: generateId(),
        userId: adminId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'admin',
      },
      {
        id: generateId(),
        userId: writerId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'write',
      },
    ])
    await db.insert(invitation).values({
      id: pendingInvitationId,
      kind: 'organization',
      email: pendingInvitee,
      inviterId: adminId,
      organizationId,
      membershipIntent: 'internal',
      role: 'member',
      status: 'pending',
      token: generateId(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    })
  })

  afterAll(async () => {
    await db
      .delete(invitation)
      .where(inArray(invitation.email, [newInvitee, pendingInvitee, writerInvitee]))
    await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await db.delete(user).where(inArray(user.id, [adminId, writerId]))
  })

  it('lets a workspace admin invite a new teammate', async () => {
    const response = await inviteFromChat(adminId, [newInvitee])

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { success: true, successful: [newInvitee], failed: [] },
    })
    const [created] = await pendingInvitationsFor(newInvitee)
    expect(created.inviterId).toBe(adminId)
    expect(await grantsOf(created.id)).toEqual([{ workspaceId, permission: 'write' }])
    await vi.waitFor(async () => {
      const [audit] = await db
        .select({ actorId: auditLog.actorId, metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.resourceName, newInvitee)))
      expect(audit).toMatchObject({
        actorId: adminId,
        metadata: {
          operation: 'workspace_invitations.send_batch',
          actor: { kind: 'delegated', serviceId: 'copilot' },
        },
      })
    })
  })

  it('adds the workspace to a pending organization invitation instead of creating another', async () => {
    const response = await inviteFromChat(adminId, [pendingInvitee])

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { success: true, successful: [pendingInvitee], failed: [] },
    })
    expect(await pendingInvitationsFor(pendingInvitee)).toEqual([
      { id: pendingInvitationId, inviterId: adminId },
    ])
    expect(await grantsOf(pendingInvitationId)).toEqual([{ workspaceId, permission: 'write' }])
  })

  it('refuses a member without workspace admin rights', async () => {
    const response = await inviteFromChat(writerId, [writerInvitee])

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' } },
    })
    expect(await pendingInvitationsFor(writerInvitee)).toEqual([])
  })
})
