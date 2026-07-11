import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, permissions, workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { creditsToDollars } from '@/lib/billing/credits/conversion'
import { setOrgMemberUsageLimit } from '@/lib/billing/organizations/member-limits'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'

interface AdminActor {
  id: string | null
  name: string
  email: string | null
}

export async function updateDashboardExternalCollaboratorUsageLimit(
  organizationId: string,
  userId: string,
  usageLimitCredits: number | null,
  actor: AdminActor
): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)

    const [internalMember] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1)
    if (internalMember) {
      throw new Error('Target user is an internal organization member')
    }

    const [externalPermission] = await tx
      .select({ userId: permissions.userId })
      .from(permissions)
      .innerJoin(
        workspace,
        and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspace.id))
      )
      .where(
        and(
          eq(permissions.userId, userId),
          eq(workspace.organizationId, organizationId),
          isNull(workspace.archivedAt)
        )
      )
      .limit(1)
    if (!externalPermission) {
      throw new Error('User is not a current external collaborator for this organization')
    }

    await setOrgMemberUsageLimit(
      organizationId,
      userId,
      usageLimitCredits === null ? null : creditsToDollars(usageLimitCredits),
      actor.id ?? undefined,
      tx
    )
  })

  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description:
      usageLimitCredits === null
        ? 'Admin cleared external collaborator usage cap'
        : 'Admin updated external collaborator usage cap',
    metadata: { targetUserId: userId, usageLimitCredits },
  })
}
