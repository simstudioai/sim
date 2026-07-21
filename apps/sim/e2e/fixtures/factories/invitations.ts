import { db } from '@sim/db'
import { invitation, invitationWorkspaceGrant } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'

export async function arrangePendingInvitation(input: {
  email: string
  token: string
  inviterId: string
  organizationId: string
  role: 'admin' | 'member'
  expiresAt: Date
  workspaceGrants: Array<{
    workspaceId: string
    permission: 'admin' | 'write' | 'read'
  }>
}): Promise<{ invitationId: string; grantIds: string[] }> {
  const invitationId = generateId()
  const grantIds = input.workspaceGrants.map(() => generateId())
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
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    if (input.workspaceGrants.length > 0) {
      await tx.insert(invitationWorkspaceGrant).values(
        input.workspaceGrants.map((grant, index) => ({
          id: grantIds[index],
          invitationId,
          workspaceId: grant.workspaceId,
          permission: grant.permission,
          createdAt: now,
          updatedAt: now,
        }))
      )
    }
  })
  return { invitationId, grantIds }
}
