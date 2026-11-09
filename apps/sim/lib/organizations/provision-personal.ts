import { db } from '@sim/db'
import { member, organization, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  acquireOrganizationMutationLock,
  acquireUserBillingIdentityLock,
} from '@/lib/billing/organizations/membership'
import type { DbTransaction } from '@/lib/db/types'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import {
  isInstanceOrganizationMode,
  joinInstanceOrganization,
} from '@/lib/organizations/instance-org'
import { createPersonalOrganizationTx } from '@/lib/organizations/personal'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'
import { transferWorkspaceProjects } from '@/lib/projects/membership'

const logger = createLogger('PersonalOrganizationProvision')

export type ProvisionPersonalOrganizationResult =
  | {
      status: 'provisioned'
      organizationId: string
      created: boolean
      attachedWorkspaceIds: string[]
      /** Workspaces left without an organization because their Project spans other owners. */
      skippedWorkspaceIds: string[]
    }
  /** Already in a team: their organization-less workspaces stay where they are. */
  | { status: 'team-member'; organizationId: string }
  | { status: 'user-missing' }

/**
 * The backfill's write: gives a user outside every team their personal organization and attaches
 * the workspaces they own without one. Only `scripts/backfill-personal-organizations.ts` calls it,
 * after every process runs the release that bills a personal organization's workspaces to their
 * owner; on-demand provisioning ({@link createPersonalOrganization}) never attaches anything.
 * Idempotent and resumable: a user who already has their personal organization only gets any
 * newly found organization-less workspaces attached, and a user in a team is left alone. Safe
 * beside concurrent signups, joins and workspace creation: it takes the workspace invitation
 * locks, the organization lock and the user's billing-identity lock in the order every attach
 * path uses, re-reads membership under them, and only ever attaches rows still without an
 * organization. A workspace whose Project also holds another owner's environment cannot move
 * without that environment and is reported in `skippedWorkspaceIds` instead.
 *
 * Attaching changes no payer: a personal organization's workspaces bill their billed account
 * exactly as before, so no storage ledger, subscription or limit moves.
 */
export async function provisionPersonalOrganization(
  userId: string
): Promise<ProvisionPersonalOrganizationResult> {
  const candidates = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.ownerId, userId), isNull(workspace.organizationId)))
    .orderBy(asc(workspace.id))
  const candidateIds = candidates.map((row) => row.id)

  return db.transaction(async (tx) => {
    await acquireInvitationMutationLocks(tx, { invitationIds: [], workspaceIds: candidateIds })

    const [existing] = await tx
      .select({ organizationId: member.organizationId, kind: organization.kind })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .limit(1)
    if (existing?.kind === 'team') {
      return { status: 'team-member', organizationId: existing.organizationId }
    }

    const organizationId = existing?.organizationId ?? `org_${generateId()}`
    await acquireOrganizationMutationLock(tx, organizationId)
    await acquireUserBillingIdentityLock(tx, userId)

    const [locked] = await tx
      .select({ organizationId: member.organizationId, kind: organization.kind })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .limit(1)
    if (locked?.kind === 'team') {
      return { status: 'team-member', organizationId: locked.organizationId }
    }
    if (locked && locked.organizationId !== organizationId) {
      throw new Error('Personal organization changed while provisioning; retry')
    }

    const created = !locked
    if (created && !(await createPersonalOrganizationTx(tx, userId, organizationId))) {
      return { status: 'user-missing' }
    }

    const { attachedWorkspaceIds, skippedWorkspaceIds } = await attachUnassignedWorkspacesTx(tx, {
      userId,
      organizationId,
      candidateIds,
    })
    return {
      status: 'provisioned',
      organizationId,
      created,
      attachedWorkspaceIds,
      skippedWorkspaceIds,
    }
  })
}

async function attachUnassignedWorkspacesTx(
  tx: DbTransaction,
  {
    userId,
    organizationId,
    candidateIds,
  }: { userId: string; organizationId: string; candidateIds: string[] }
): Promise<{ attachedWorkspaceIds: string[]; skippedWorkspaceIds: string[] }> {
  if (candidateIds.length === 0) return { attachedWorkspaceIds: [], skippedWorkspaceIds: [] }

  const lockedRows = await tx
    .select({
      id: workspace.id,
      projectId: workspace.projectId,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .where(
      and(
        inArray(workspace.id, candidateIds),
        eq(workspace.ownerId, userId),
        isNull(workspace.organizationId)
      )
    )
    .orderBy(asc(workspace.id))
    .for('no key update')
  if (lockedRows.length === 0) return { attachedWorkspaceIds: [], skippedWorkspaceIds: [] }

  const lockedIds = new Set(lockedRows.map((row) => row.id))
  const projectIds = [
    ...new Set(lockedRows.flatMap((row) => (row.projectId ? [row.projectId] : []))),
  ]
  const environments = await tx
    .select({ id: workspace.id, projectId: workspace.projectId })
    .from(workspace)
    .where(inArray(workspace.projectId, projectIds))
  const splitProjectIds = new Set<string | null>(
    environments.filter((row) => !lockedIds.has(row.id)).map((row) => row.projectId)
  )
  const movable = lockedRows.filter((row) => !splitProjectIds.has(row.projectId))
  const skippedWorkspaceIds = lockedRows
    .filter((row) => splitProjectIds.has(row.projectId))
    .map((row) => row.id)
  if (skippedWorkspaceIds.length > 0) {
    logger.warn('Left workspaces outside the personal organization: their Project spans owners', {
      userId,
      organizationId,
      skippedWorkspaceIds,
    })
  }
  if (movable.length === 0) return { attachedWorkspaceIds: [], skippedWorkspaceIds }

  await transferWorkspaceProjects(
    tx,
    movable.map((row) => row.id),
    organizationId,
    undefined,
    movable.map((row) => ({
      workspaceId: row.id,
      organizationId,
      billedAccountUserId: row.billedAccountUserId,
      expectedCurrentPayer: { organizationId: null, billedAccountUserId: row.billedAccountUserId },
    }))
  )
  const now = new Date()
  await tx
    .update(workspace)
    .set({ organizationAssignedAt: now, updatedAt: now })
    .where(
      inArray(
        workspace.id,
        movable.map((row) => row.id)
      )
    )

  return { attachedWorkspaceIds: movable.map((row) => row.id), skippedWorkspaceIds }
}

/**
 * Creates the personal organization of a user who belongs to no organization, with them as its
 * owner, and nothing else: workspaces they already own stay organization-less (they open in this
 * organization's shell, billed as before) until the backfill or an explicit flow attaches them.
 * One short transaction under the user's billing-identity lock, re-checking membership there, so
 * concurrent calls create one organization (`member_user_id_unique` backs it). Returns the
 * organization they belong to afterwards, or null when the user no longer exists.
 */
export async function createPersonalOrganization(userId: string): Promise<string | null> {
  await db.transaction((tx) => createPersonalOrganizationTx(tx, userId))
  return resolveOrganizationLanding(userId, null)
}

/**
 * Puts a user who belongs to no organization into one and returns it: the instance organization on
 * an instance-organization deployment, otherwise their personal organization
 * ({@link createPersonalOrganization}, which attaches no workspace). Surfaces reach it only through
 * the `ensureViewerOrganization` command.
 */
export async function ensureUserOrganization(userId: string): Promise<string | null> {
  if (!isInstanceOrganizationMode()) return createPersonalOrganization(userId)
  await joinInstanceOrganization(userId)
  return resolveOrganizationLanding(userId, null)
}
