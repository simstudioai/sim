import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  type InvitationKind,
  type InvitationMembershipIntent,
  type InvitationStatus,
  invitation,
  invitationWorkspaceGrant,
  member,
  organization,
  permissions,
  user,
  workspace,
  workspaceEnvironment,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { PERMISSION_RANK, type PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import { applySessionPolicyToNewMember } from '@/lib/auth/session-policy'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  acquireOrganizationMutationLock,
  acquireOrgMembershipLock,
  ensureUserInOrganizationTx,
  getUserOrganization,
} from '@/lib/billing/organizations/membership'
import {
  type AcceptancePlanConversion,
  ensureTeamOrganizationForAcceptance,
} from '@/lib/billing/organizations/provision-seat'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { syncWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import type { DbOrTx } from '@/lib/db/types'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { captureServerEvent } from '@/lib/posthog/server'
import { getWorkspaceWithOwner, type WorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('InvitationCore')

export const INVITATION_EXPIRY_DAYS = 7

export function computeInvitationExpiry(daysFromNow = INVITATION_EXPIRY_DAYS): Date {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
}

export interface InvitationWithGrants {
  id: string
  kind: InvitationKind
  email: string
  organizationId: string | null
  membershipIntent: InvitationMembershipIntent
  inviterId: string
  role: string
  status: InvitationStatus
  token: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  grants: Array<{
    id: string
    workspaceId: string
    permission: 'admin' | 'write' | 'read'
    workspaceName: string | null
  }>
  organizationName: string | null
  inviterName: string | null
  inviterEmail: string | null
}

export async function getInvitationById(
  id: string,
  executor: DbOrTx = db
): Promise<InvitationWithGrants | null> {
  const [row] = await executor.select().from(invitation).where(eq(invitation.id, id)).limit(1)
  if (!row) return null
  return hydrateInvitation(row, executor)
}

export async function getInvitationByToken(
  token: string,
  executor: DbOrTx = db
): Promise<InvitationWithGrants | null> {
  const [row] = await executor.select().from(invitation).where(eq(invitation.token, token)).limit(1)
  if (!row) return null
  return hydrateInvitation(row, executor)
}

async function hydrateInvitation(
  row: typeof invitation.$inferSelect,
  executor: DbOrTx = db
): Promise<InvitationWithGrants> {
  const grantRows = await executor
    .select({
      id: invitationWorkspaceGrant.id,
      workspaceId: invitationWorkspaceGrant.workspaceId,
      permission: invitationWorkspaceGrant.permission,
      workspaceName: workspace.name,
    })
    .from(invitationWorkspaceGrant)
    .leftJoin(workspace, eq(workspace.id, invitationWorkspaceGrant.workspaceId))
    .where(eq(invitationWorkspaceGrant.invitationId, row.id))

  let organizationName: string | null = null
  if (row.organizationId) {
    const [orgRow] = await executor
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, row.organizationId))
      .limit(1)
    organizationName = orgRow?.name ?? null
  }

  const [inviterRow] = await executor
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, row.inviterId))
    .limit(1)

  return {
    id: row.id,
    kind: row.kind,
    email: row.email,
    organizationId: row.organizationId,
    membershipIntent: row.membershipIntent,
    inviterId: row.inviterId,
    role: row.role,
    status: row.status,
    token: row.token,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    grants: grantRows.map((grant) => ({
      id: grant.id,
      workspaceId: grant.workspaceId,
      permission: grant.permission,
      workspaceName: grant.workspaceName,
    })),
    organizationName,
    inviterName: inviterRow?.name ?? null,
    inviterEmail: inviterRow?.email ?? null,
  }
}

export function isInvitationExpired(inv: Pick<InvitationWithGrants, 'expiresAt'>): boolean {
  return new Date() > new Date(inv.expiresAt)
}

/**
 * Flip any still-pending invitations for the given organization whose
 * `expiresAt` has already passed to `expired`. Best-effort housekeeping
 * — callers can rely on this for display freshness, but seat math also
 * defensively filters by `expiresAt` at query time.
 */
export async function expireStalePendingInvitationsForOrganization(
  organizationId: string
): Promise<void> {
  try {
    await db
      .update(invitation)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, 'pending'),
          lte(invitation.expiresAt, new Date())
        )
      )
  } catch (error) {
    logger.error('Failed to expire stale pending invitations for organization', {
      organizationId,
      error,
    })
  }
}

/**
 * Flip any still-pending invitations with grants on the given workspaces
 * whose `expiresAt` has already passed to `expired`.
 */
export async function expireStalePendingInvitationsForWorkspaces(
  workspaceIds: string[]
): Promise<void> {
  if (workspaceIds.length === 0) return
  try {
    const staleIds = await db
      .select({ id: invitation.id })
      .from(invitation)
      .innerJoin(invitationWorkspaceGrant, eq(invitationWorkspaceGrant.invitationId, invitation.id))
      .where(
        and(
          inArray(invitationWorkspaceGrant.workspaceId, workspaceIds),
          eq(invitation.status, 'pending'),
          lte(invitation.expiresAt, new Date())
        )
      )

    if (staleIds.length === 0) return

    await db
      .update(invitation)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        inArray(
          invitation.id,
          staleIds.map((row) => row.id)
        )
      )
  } catch (error) {
    logger.error('Failed to expire stale pending invitations for workspaces', {
      workspaceCount: workspaceIds.length,
      error,
    })
  }
}

export type AcceptInvitationFailure =
  | { kind: 'not-found' }
  | { kind: 'already-processed' }
  | { kind: 'expired' }
  | { kind: 'email-mismatch' }
  | { kind: 'invalid-token' }
  | { kind: 'already-in-organization' }
  | { kind: 'no-seats-available' }
  | { kind: 'upgrade-required' }
  | { kind: 'server-error'; message?: string }

export type AcceptInvitationSuccess = {
  success: true
  invitation: InvitationWithGrants
  acceptedWorkspaceIds: string[]
  redirectPath: string
  membershipAlreadyExists: boolean
}

export type AcceptInvitationResult =
  | AcceptInvitationSuccess
  | ({ success: false } & AcceptInvitationFailure)

export interface AcceptInvitationInput {
  userId: string
  userEmail: string
  actorName?: string | null
  invitationId: string
  token: string | null
  request?: { headers: { get(name: string): string | null } }
}

/**
 * Thrown inside the grant transaction when the invitee's org membership was
 * removed concurrently (between the join and the grant) — detected under the
 * membership lock. Aborts the grant so we never write workspace access for a
 * user who is no longer an org member (the "zombie" state).
 */
class MembershipRevokedDuringAcceptError extends Error {
  constructor() {
    super('Org membership was revoked during invite acceptance')
    this.name = 'MembershipRevokedDuringAcceptError'
  }
}

interface InvitationAcceptancePostCommitEffects {
  organizationId: string | null
  memberRole: string | null
  reconcileSeats: boolean
  acceptedWorkspaceIds: string[]
  syncUsageLimitUserIds: string[]
  planConversions: AcceptancePlanConversion[]
  acceptedInvitation: InvitationWithGrants | null
  membershipAlreadyExists: boolean
}

/**
 * Compute the complete workspace lock set before taking any workspace lock.
 * A personal Pro→Team conversion attaches the billing owner's other personal
 * workspaces in the same transaction, so those rows must participate in the
 * same deterministic lock ordering as the invitation grants.
 */
async function getInvitationAcceptanceWorkspaceLockIds(
  tx: DbOrTx,
  inv: InvitationWithGrants
): Promise<{ workspaceIds: string[]; primaryWorkspace: WorkspaceWithOwner | null }> {
  const grantWorkspaceIds = inv.grants.map((grant) => grant.workspaceId)
  const primaryWorkspace = grantWorkspaceIds[0]
    ? await getWorkspaceWithOwner(grantWorkspaceIds[0], { executor: tx })
    : null
  if (
    !isBillingEnabled ||
    inv.membershipIntent === 'external' ||
    !primaryWorkspace ||
    primaryWorkspace.organizationId
  ) {
    return { workspaceIds: [...new Set(grantWorkspaceIds)].sort(), primaryWorkspace }
  }

  const attachableWorkspaces = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        eq(workspace.billedAccountUserId, primaryWorkspace.billedAccountUserId),
        isNull(workspace.organizationId),
        ne(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION)
      )
    )

  return {
    workspaceIds: [
      ...new Set([...grantWorkspaceIds, ...attachableWorkspaces.map((row) => row.id)]),
    ].sort(),
    primaryWorkspace,
  }
}

export async function acceptInvitation(
  input: AcceptInvitationInput
): Promise<AcceptInvitationResult> {
  const effects: InvitationAcceptancePostCommitEffects = {
    organizationId: null,
    memberRole: null,
    reconcileSeats: false,
    acceptedWorkspaceIds: [],
    syncUsageLimitUserIds: [],
    planConversions: [],
    acceptedInvitation: null,
    membershipAlreadyExists: false,
  }
  const result = await db.transaction(async (tx): Promise<AcceptInvitationResult> => {
    await acquireInvitationMutationLocks(tx, {
      invitationIds: [input.invitationId],
      workspaceIds: [],
    })

    await tx.execute(sql`select id from invitation where id = ${input.invitationId} for update`)

    const inv = await getInvitationById(input.invitationId, tx)
    if (!inv) {
      return { success: false, kind: 'not-found' }
    }

    const lockPlan = await getInvitationAcceptanceWorkspaceLockIds(tx, inv)
    await acquireInvitationMutationLocks(tx, {
      invitationIds: [],
      workspaceIds: lockPlan.workspaceIds,
    })

    // Re-read and row-lock the primary workspace only after the shared
    // workspace advisory lock is held. If a move won the lock first, every
    // billing and membership decision below now uses the committed post-move
    // organization/billing identity rather than the pre-lock snapshot.
    const lockedPrimaryWorkspace = inv.grants[0]
      ? await getWorkspaceWithOwner(inv.grants[0].workspaceId, {
          executor: tx,
          forUpdate: true,
        })
      : null

    return acceptLockedInvitation(
      input,
      inv,
      { ...lockPlan, primaryWorkspace: lockedPrimaryWorkspace },
      tx,
      effects
    )
  })
  if (result.success) {
    await runInvitationAcceptancePostCommitEffects(input, effects)
  }
  return result
}

async function acceptLockedInvitation(
  input: AcceptInvitationInput,
  inv: InvitationWithGrants,
  lockPlan: { workspaceIds: string[]; primaryWorkspace: WorkspaceWithOwner | null },
  tx: DbOrTx,
  effects: InvitationAcceptancePostCommitEffects
): Promise<AcceptInvitationResult> {
  if (input.token && inv.token !== input.token) {
    return { success: false, kind: 'invalid-token' }
  }

  if (inv.status !== 'pending') {
    return { success: false, kind: 'already-processed' }
  }

  if (isInvitationExpired(inv)) {
    await tx
      .update(invitation)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(invitation.id, inv.id), eq(invitation.status, 'pending')))
    return { success: false, kind: 'expired' }
  }

  if (normalizeEmail(input.userEmail) !== normalizeEmail(inv.email)) {
    return { success: false, kind: 'email-mismatch' }
  }

  let membershipAlreadyExists = false
  let acceptedMembershipIntent = inv.membershipIntent
  let shouldJoinOrganization = inv.membershipIntent !== 'external'

  const primaryGrant = inv.grants[0]
  let billingOwnerUserId = inv.inviterId
  let workspaceOrganizationId = inv.organizationId
  if (primaryGrant && lockPlan.primaryWorkspace) {
    billingOwnerUserId = lockPlan.primaryWorkspace.billedAccountUserId
    workspaceOrganizationId = lockPlan.primaryWorkspace.organizationId
  }

  const existingMembership = await getUserOrganization(input.userId, tx)
  const inviteeAlreadyInDifferentOrg =
    !!existingMembership &&
    (workspaceOrganizationId ? existingMembership.organizationId !== workspaceOrganizationId : true)

  if (shouldJoinOrganization && inviteeAlreadyInDifferentOrg) {
    if (inv.kind !== 'workspace' || inv.grants.length === 0) {
      return { success: false, kind: 'already-in-organization' }
    }
    acceptedMembershipIntent = 'external'
    shouldJoinOrganization = false
  }

  let targetOrganizationId = workspaceOrganizationId

  if (shouldJoinOrganization) {
    const alreadyMemberOfTarget =
      !!existingMembership &&
      !!workspaceOrganizationId &&
      existingMembership.organizationId === workspaceOrganizationId

    let fixedSeats = false

    if (isBillingEnabled && !alreadyMemberOfTarget) {
      if (workspaceOrganizationId) {
        await acquireOrganizationMutationLock(tx, workspaceOrganizationId)
      }
      const orgResult = await ensureTeamOrganizationForAcceptance({
        billingOwnerUserId,
        workspaceOrganizationId,
        executor: tx,
        workspaceIdsToAttach: lockPlan.workspaceIds,
      })
      if (!orgResult.success) {
        return { success: false, kind: orgResult.failureCode }
      }
      targetOrganizationId = orgResult.organizationId
      fixedSeats = orgResult.fixedSeats
      if (orgResult.postCommitEffects) {
        effects.planConversions.push(...orgResult.postCommitEffects.planConversions)
        effects.syncUsageLimitUserIds.push(...orgResult.postCommitEffects.usageLimitUserIds)
      }
    }

    // Team plans manage seats by reconciling to the member count after the
    // join (and charging async), so the synchronous seat-cap validation is
    // skipped. Enterprise keeps its fixed-seat validation, and when billing is
    // disabled we leave validation in place unchanged.
    const billingManagesSeats = isBillingEnabled && !fixedSeats

    if (targetOrganizationId) {
      const membershipResult = await ensureUserInOrganizationTx(tx, {
        userId: input.userId,
        organizationId: targetOrganizationId,
        role: (inv.role || 'member') as 'admin' | 'member' | 'owner',
        acceptingInvitationId: inv.id,
        // If the pre-lock membership read said the user already belonged to
        // this org but a concurrent removal won the org lock first, fall back
        // to normal validation instead of accidentally bypassing Enterprise's
        // fixed-seat cap with stale state.
        skipSeatValidation: billingManagesSeats && !alreadyMemberOfTarget,
      })

      if (!membershipResult.success) {
        if (membershipResult.existingOrgId) {
          return { success: false, kind: 'already-in-organization' }
        }
        if (membershipResult.failureCode === 'no-seats-available') {
          return { success: false, kind: 'no-seats-available' }
        }
        return { success: false, kind: 'server-error', message: membershipResult.error }
      }
      membershipAlreadyExists = membershipResult.alreadyMember

      if (!membershipResult.alreadyMember) {
        effects.memberRole = inv.role || 'member'
      }

      // Grow the paid seat count to match the new member and push the charge
      // to Stripe asynchronously (Team plans only; Enterprise seats are
      // fixed). Best-effort: the member is already in, and a transient
      // failure self-heals on the next join/removal reconcile, matching the
      // removal path's seat accounting.
      if (billingManagesSeats && !membershipResult.alreadyMember) {
        effects.reconcileSeats = true
      }
    } else {
      shouldJoinOrganization = false
    }
  }

  const acceptedWorkspaceIds: string[] = []

  try {
    /**
     * The caller's transaction holds the invitation and workspace locks for
     * this entire acceptance, including membership validation and grants.
     */
    if (shouldJoinOrganization && targetOrganizationId) {
      await acquireOrgMembershipLock(tx, input.userId, targetOrganizationId)
      const [stillMember] = await tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.organizationId, targetOrganizationId), eq(member.userId, input.userId))
        )
        .limit(1)
      if (!stillMember) {
        throw new MembershipRevokedDuringAcceptError()
      }
    }

    await tx
      .update(invitation)
      .set({
        status: 'accepted',
        membershipIntent: acceptedMembershipIntent,
        updatedAt: new Date(),
      })
      .where(and(eq(invitation.id, inv.id), eq(invitation.status, 'pending')))

    for (const grant of inv.grants) {
      const [existingPermission] = await tx
        .select({ id: permissions.id, permissionType: permissions.permissionType })
        .from(permissions)
        .where(
          and(
            eq(permissions.entityId, grant.workspaceId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.userId, input.userId)
          )
        )
        .limit(1)

      const newPermission = grant.permission as PermissionType
      const newRank = PERMISSION_RANK[newPermission] ?? 0

      if (existingPermission) {
        const existingRank =
          PERMISSION_RANK[existingPermission.permissionType as PermissionType] ?? 0
        if (newRank > existingRank) {
          await tx
            .update(permissions)
            .set({ permissionType: newPermission, updatedAt: new Date() })
            .where(eq(permissions.id, existingPermission.id))
        }
      } else {
        await tx.insert(permissions).values({
          id: generateId(),
          entityType: 'workspace',
          entityId: grant.workspaceId,
          userId: input.userId,
          permissionType: newPermission,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }

      acceptedWorkspaceIds.push(grant.workspaceId)
    }
  } catch (grantError) {
    if (grantError instanceof MembershipRevokedDuringAcceptError) {
      logger.warn('Aborted invite acceptance: org membership revoked concurrently', {
        userId: input.userId,
        organizationId: targetOrganizationId,
        invitationId: inv.id,
      })
      return { success: false, kind: 'already-processed' }
    }
    throw grantError
  }

  effects.organizationId = shouldJoinOrganization ? targetOrganizationId : null
  effects.acceptedWorkspaceIds = acceptedWorkspaceIds
  if (shouldJoinOrganization && targetOrganizationId && !membershipAlreadyExists) {
    effects.syncUsageLimitUserIds.push(input.userId)
  }
  const acceptedInvitation: InvitationWithGrants = {
    ...inv,
    organizationId: targetOrganizationId,
    status: 'accepted',
    membershipIntent: acceptedMembershipIntent,
  }
  effects.acceptedInvitation = acceptedInvitation
  effects.membershipAlreadyExists = membershipAlreadyExists

  const redirectPath =
    inv.kind === 'workspace' && acceptedWorkspaceIds.length > 0
      ? `/workspace/${acceptedWorkspaceIds[0]}/home`
      : '/workspace'

  return {
    success: true,
    invitation: acceptedInvitation,
    acceptedWorkspaceIds,
    redirectPath,
    membershipAlreadyExists,
  }
}

async function runInvitationAcceptancePostCommitEffects(
  input: AcceptInvitationInput,
  effects: InvitationAcceptancePostCommitEffects
): Promise<void> {
  if (effects.acceptedInvitation) {
    const accepted = effects.acceptedInvitation
    recordAudit({
      workspaceId: effects.acceptedWorkspaceIds[0] ?? null,
      actorId: input.userId,
      actorName: input.actorName ?? undefined,
      actorEmail: input.userEmail,
      action:
        accepted.kind === 'workspace'
          ? AuditAction.INVITATION_ACCEPTED
          : AuditAction.ORG_INVITATION_ACCEPTED,
      resourceType:
        accepted.kind === 'workspace'
          ? AuditResourceType.WORKSPACE
          : AuditResourceType.ORGANIZATION,
      resourceId: accepted.organizationId ?? effects.acceptedWorkspaceIds[0] ?? accepted.id,
      description: `Accepted ${accepted.kind} invitation for ${accepted.email}`,
      metadata: {
        invitationId: accepted.id,
        targetEmail: accepted.email,
        targetRole: accepted.role,
        kind: accepted.kind,
        membershipIntent: accepted.membershipIntent,
        workspaceIds: effects.acceptedWorkspaceIds,
        membershipAlreadyExists: effects.membershipAlreadyExists,
      },
      request: input.request,
    })
  }

  if (effects.organizationId && effects.memberRole) {
    // Pre-join sessions keep their old expiry until the next sliding refresh;
    // apply the org's session policy to them now (best-effort, never throws).
    await applySessionPolicyToNewMember(input.userId, effects.organizationId)

    recordAudit({
      workspaceId: null,
      actorId: input.userId,
      action: AuditAction.ORG_MEMBER_ADDED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: effects.organizationId,
      description: `Joined organization as ${effects.memberRole} via invite acceptance`,
      metadata: { invitationId: input.invitationId, memberRole: effects.memberRole },
    })
    captureServerEvent(
      input.userId,
      'org_member_added',
      { organization_id: effects.organizationId, member_role: effects.memberRole },
      { groups: { organization: effects.organizationId } }
    )
  }

  for (const conversion of effects.planConversions) {
    recordAudit({
      workspaceId: null,
      actorId: conversion.actorId,
      action: AuditAction.ORG_PLAN_CONVERTED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: conversion.organizationId,
      description: `Converted ${conversion.fromPlan} to ${conversion.toPlan}`,
      metadata: {
        fromPlan: conversion.fromPlan,
        toPlan: conversion.toPlan,
        trigger: 'invite-acceptance',
      },
    })
    captureServerEvent(conversion.actorId, 'subscription_changed', {
      from_plan: conversion.fromPlan,
      to_plan: conversion.toPlan,
      interval: 'unchanged',
    })
  }

  if (effects.organizationId && effects.reconcileSeats) {
    try {
      await reconcileOrganizationSeats({
        organizationId: effects.organizationId,
        reason: 'member-accepted-invite',
        actorId: input.userId,
      })
    } catch (seatError) {
      logger.error('Failed to reconcile organization seats after invite acceptance', {
        userId: input.userId,
        organizationId: effects.organizationId,
        invitationId: input.invitationId,
        error: seatError,
      })
    }
  }

  if (effects.organizationId) {
    try {
      await setActiveOrganizationForCurrentSession(effects.organizationId)
    } catch (activeOrgError) {
      logger.error('Failed to activate organization after accepting invitation', {
        userId: input.userId,
        organizationId: effects.organizationId,
        invitationId: input.invitationId,
        error: activeOrgError,
      })
    }
  }

  for (const workspaceId of effects.acceptedWorkspaceIds) {
    try {
      const [wsEnvRow] = await db
        .select({ variables: workspaceEnvironment.variables })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, workspaceId))
        .limit(1)
      const wsEnvKeys = Object.keys((wsEnvRow?.variables as Record<string, string>) || {})
      if (wsEnvKeys.length > 0) {
        await syncWorkspaceEnvCredentials({
          workspaceId,
          envKeys: wsEnvKeys,
          actingUserId: input.userId,
        })
      }
    } catch (envError) {
      logger.error('Failed to sync workspace env credentials after invitation accept', {
        userId: input.userId,
        workspaceId,
        invitationId: input.invitationId,
        error: envError,
      })
    }
  }

  for (const userId of new Set(effects.syncUsageLimitUserIds)) {
    try {
      await syncUsageLimitsFromSubscription(userId)
    } catch (syncError) {
      logger.error('Failed to sync usage limits after joining org', {
        userId,
        organizationId: effects.organizationId,
        invitationId: input.invitationId,
        error: syncError,
      })
    }
  }
}

export type RejectInvitationResult =
  | { success: true; invitation: InvitationWithGrants }
  | { success: false; kind: AcceptInvitationFailure['kind'] }

export async function rejectInvitation(
  input: AcceptInvitationInput
): Promise<RejectInvitationResult> {
  const inv = await getInvitationById(input.invitationId)

  if (!inv) return { success: false, kind: 'not-found' }
  if (input.token && inv.token !== input.token) return { success: false, kind: 'invalid-token' }
  if (inv.status !== 'pending') return { success: false, kind: 'already-processed' }
  if (isInvitationExpired(inv)) {
    await db
      .update(invitation)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(invitation.id, inv.id), eq(invitation.status, 'pending')))
    return { success: false, kind: 'expired' }
  }
  if (normalizeEmail(input.userEmail) !== normalizeEmail(inv.email)) {
    return { success: false, kind: 'email-mismatch' }
  }

  await db
    .update(invitation)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(eq(invitation.id, inv.id))

  return { success: true, invitation: { ...inv, status: 'rejected' } }
}

export async function cancelInvitation(invitationId: string): Promise<boolean> {
  const result = await db
    .update(invitation)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')))
    .returning({ id: invitation.id })

  return result.length > 0
}

export async function listPendingInvitationsForOrganization(organizationId: string) {
  return db
    .select({
      id: invitation.id,
      kind: invitation.kind,
      email: invitation.email,
      role: invitation.role,
      membershipIntent: invitation.membershipIntent,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterName: user.name,
      inviterEmail: user.email,
    })
    .from(invitation)
    .leftJoin(user, eq(invitation.inviterId, user.id))
    .where(eq(invitation.organizationId, organizationId))
    .orderBy(invitation.createdAt)
}

export async function listInvitationsForWorkspaces(workspaceIds: string[]) {
  if (workspaceIds.length === 0) return []
  return db
    .select({
      id: invitation.id,
      kind: invitation.kind,
      email: invitation.email,
      token: invitation.token,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      organizationId: invitation.organizationId,
      membershipIntent: invitation.membershipIntent,
      inviterId: invitation.inviterId,
      workspaceId: invitationWorkspaceGrant.workspaceId,
      permission: invitationWorkspaceGrant.permission,
    })
    .from(invitationWorkspaceGrant)
    .innerJoin(invitation, eq(invitation.id, invitationWorkspaceGrant.invitationId))
    .where(inArray(invitationWorkspaceGrant.workspaceId, workspaceIds))
}
