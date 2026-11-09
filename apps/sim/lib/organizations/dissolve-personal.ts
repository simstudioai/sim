import { db } from '@sim/db'
import { member, organization, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { transferWorkspaceProjects } from '@/lib/projects/membership'

const logger = createLogger('PersonalOrganizationDissolve')

/** The user's personal organization, or null when they have none (or belong to a team). */
export async function getPersonalOrganizationId(
  userId: string,
  executor: DbOrTx = db
): Promise<string | null> {
  const [row] = await executor
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), eq(organization.kind, 'personal')))
    .limit(1)
  return row?.organizationId ?? null
}

export interface DissolvePersonalOrganizationResult {
  dissolvedOrganizationId: string | null
  movedWorkspaceIds: string[]
}

/**
 * Folds a user's personal organization into the team organization they are joining, so the
 * one-membership-per-user rule holds without refusing the join: every workspace in the personal
 * organization (archived ones too) and its Project move into the team, billed to the team's
 * owner exactly as an owned personal workspace is when it follows its owner into a team; then the
 * personal membership and organization are deleted.
 *
 * Collaborators on the moved workspaces stay workspace guests: joining a team never adds a seat
 * the team did not invite. Organization-scoped content created under the personal organization
 * (organization-level chats, their files, memory spaces) is removed with it by its foreign keys.
 *
 * The caller holds the target's organization lock and the user's billing-identity lock, which
 * personal-organization workspace creation also takes, so no workspace can land in the personal
 * organization after it is read here. A no-op for a user without a personal organization.
 */
export async function dissolvePersonalOrganizationTx(
  tx: DbTransaction,
  {
    userId,
    targetOrganizationId,
    targetBilledAccountUserId,
  }: { userId: string; targetOrganizationId: string; targetBilledAccountUserId: string }
): Promise<DissolvePersonalOrganizationResult> {
  const personalOrganizationId = await getPersonalOrganizationId(userId, tx)
  if (!personalOrganizationId) return { dissolvedOrganizationId: null, movedWorkspaceIds: [] }
  if (personalOrganizationId === targetOrganizationId) {
    throw new Error('A personal organization cannot be dissolved into itself')
  }

  const personalWorkspaces = await tx
    .select({ id: workspace.id, billedAccountUserId: workspace.billedAccountUserId })
    .from(workspace)
    .where(eq(workspace.organizationId, personalOrganizationId))
    .orderBy(asc(workspace.id))
    .for('no key update')
  const movedWorkspaceIds = personalWorkspaces.map((row) => row.id)

  if (movedWorkspaceIds.length > 0) {
    await transferWorkspaceProjects(
      tx,
      movedWorkspaceIds,
      targetOrganizationId,
      undefined,
      personalWorkspaces.map((row) => ({
        workspaceId: row.id,
        organizationId: targetOrganizationId,
        billedAccountUserId: targetBilledAccountUserId,
        expectedCurrentPayer: {
          organizationId: personalOrganizationId,
          billedAccountUserId: row.billedAccountUserId,
        },
      }))
    )
    const now = new Date()
    await tx
      .update(workspace)
      .set({ workspaceMode: 'organization', organizationAssignedAt: now, updatedAt: now })
      .where(inArray(workspace.id, movedWorkspaceIds))
    await tx
      .insert(permissions)
      .values(
        movedWorkspaceIds.map((workspaceId) => ({
          id: generateId(),
          userId: targetBilledAccountUserId,
          entityType: 'workspace' as const,
          entityId: workspaceId,
          permissionType: 'admin' as const,
          createdAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: [permissions.userId, permissions.entityType, permissions.entityId],
        set: { permissionType: 'admin', updatedAt: now },
      })
  }

  await tx
    .delete(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, personalOrganizationId)))
  await tx.delete(organization).where(eq(organization.id, personalOrganizationId))

  logger.info('Dissolved personal organization into team', {
    userId,
    personalOrganizationId,
    targetOrganizationId,
    movedWorkspaceCount: movedWorkspaceIds.length,
  })

  return { dissolvedOrganizationId: personalOrganizationId, movedWorkspaceIds }
}
