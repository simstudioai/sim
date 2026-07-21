import { db } from '@sim/db'
import { invitation, invitationWorkspaceGrant } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'

export async function arrangePendingInvitation(input: {
  email: string
  token: string
  inviterId: string
  organizationId: string
  workspaceId: string
  role: 'admin' | 'member'
  permission: 'admin' | 'write' | 'read'
}): Promise<{ invitationId: string; grantId: string }> {
  const invitationId = generateId()
  const grantId = generateId()
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(invitation).values({
      id: invitationId,
      kind: 'workspace',
      email: input.email.trim().toLowerCase(),
      inviterId: input.inviterId,
      organizationId: input.organizationId,
      membershipIntent: 'internal',
      role: input.role,
      status: 'pending',
      token: input.token,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
      createdAt: now,
      updatedAt: now,
    })
    await tx.insert(invitationWorkspaceGrant).values({
      id: grantId,
      invitationId,
      workspaceId: input.workspaceId,
      permission: input.permission,
      createdAt: now,
      updatedAt: now,
    })
  })
  return { invitationId, grantId }
}
