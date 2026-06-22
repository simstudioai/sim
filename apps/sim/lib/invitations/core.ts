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
import { and, eq, inArray, lte } from 'drizzle-orm'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  acquireOrgMembershipLock,
  ensureUserInOrganization,
  getUserOrganization,
} from '@/lib/billing/organizations/membership'
import { ensureTeamOrganizationForAcceptance } from '@/lib/billing/organizations/provision-seat'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { syncWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import { captureServerEvent } from '@/lib/posthog/server'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

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

export async function getInvitationById(id: string): Promise<InvitationWithGrants | null> {
  const [row] = await db.select().from(invitation).where(eq(invitation.id, id)).limit(1)
  if (!row) return null
  return hydrateInvitation(row)
}

export async function getInvitationByToken(token: string): Promise<InvitationWithGrants | null> {
  const [row] = await db.select().from(invitation).where(eq(invitation.token, token)).limit(1)
  if (!row) return null
  return hydrateInvitation(row)
}

async function hydrateInvitation(
  row: typeof invitation.$inferSelect
): Promise<InvitationWithGrants> {
  const grantRows = await db
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
    const [orgRow] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, row.organizationId))
      .limit(1)
    organizationName = orgRow?.name ?? null
  }

  const [inviterRow] = await db
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
  invitationId: string
  token: string | null
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

/**
 * An invitee who already belongs to a different organization cannot join a
 * second one. A workspace invite (with grants) falls back to external access;
 * anything else is rejected. Returns `true` when the caller should downgrade to
 * external membership, `false` when the invite was rejected as cross-org.
 */
async function downgradeOrRejectCrossOrgInvite(inv: InvitationWithGrants): Promise<boolean> {
  if (inv.kind === 'workspace' && inv.grants.length > 0) {
    return true
  }
  await db
    .update(invitation)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(eq(invitation.id, inv.id))
  return false
}

export async function acceptInvitation(
  input: AcceptInvitationInput
): Promise<AcceptInvitationResult> {
  const inv = await getInvitationById(input.invitationId)

  if (!inv) {
    return { success: false, kind: 'not-found' }
  }

  if (input.token && inv.token !== input.token) {
    return { success: false, kind: 'invalid-token' }
  }

  if (inv.status !== 'pending') {
    return { success: false, kind: 'already-processed' }
  }

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

  let membershipAlreadyExists = false
  let acceptedMembershipIntent = inv.membershipIntent
  let shouldJoinOrganization = inv.membershipIntent !== 'external'

  const primaryGrant = inv.grants[0]
  let billingOwnerUserId = inv.inviterId
  let workspaceOrganizationId = inv.organizationId
  if (primaryGrant) {
    const grantWorkspace = await getWorkspaceWithOwner(primaryGrant.workspaceId)
    if (grantWorkspace) {
      billingOwnerUserId = grantWorkspace.billedAccountUserId
      workspaceOrganizationId = grantWorkspace.organizationId ?? inv.organizationId
    }
  }

  const existingMembership = await getUserOrganization(input.userId)
  const inviteeAlreadyInDifferentOrg =
    !!existingMembership &&
    (workspaceOrganizationId ? existingMembership.organizationId !== workspaceOrganizationId : true)

  if (shouldJoinOrganization && inviteeAlreadyInDifferentOrg) {
    if (await downgradeOrRejectCrossOrgInvite(inv)) {
      acceptedMembershipIntent = 'external'
      shouldJoinOrganization = false
    } else {
      return { success: false, kind: 'already-in-organization' }
    }
  }

  let targetOrganizationId = workspaceOrganizationId

  if (shouldJoinOrganization) {
    const alreadyMemberOfTarget =
      !!existingMembership &&
      !!workspaceOrganizationId &&
      existingMembership.organizationId === workspaceOrganizationId

    let fixedSeats = false

    if (isBillingEnabled && !alreadyMemberOfTarget) {
      const orgResult = await ensureTeamOrganizationForAcceptance({
        billingOwnerUserId,
        workspaceOrganizationId,
      })
      if (!orgResult.success) {
        return { success: false, kind: orgResult.failureCode }
      }
      targetOrganizationId = orgResult.organizationId
      fixedSeats = orgResult.fixedSeats
    }

    // Team plans manage seats by reconciling to the member count after the
    // join (and charging async), so the synchronous seat-cap validation is
    // skipped. Enterprise keeps its fixed-seat validation, and when billing is
    // disabled we leave validation in place unchanged.
    const billingManagesSeats = isBillingEnabled && !fixedSeats

    if (targetOrganizationId) {
      const membershipResult = await ensureUserInOrganization({
        userId: input.userId,
        organizationId: targetOrganizationId,
        role: (inv.role || 'member') as 'admin' | 'member' | 'owner',
        acceptingInvitationId: inv.id,
        skipSeatValidation: billingManagesSeats,
      })

      if (!membershipResult.success) {
        if (membershipResult.existingOrgId) {
          if (await downgradeOrRejectCrossOrgInvite(inv)) {
            acceptedMembershipIntent = 'external'
            shouldJoinOrganization = false
          } else {
            return { success: false, kind: 'already-in-organization' }
          }
        } else if (membershipResult.failureCode === 'no-seats-available') {
          return { success: false, kind: 'no-seats-available' }
        } else {
          return { success: false, kind: 'server-error', message: membershipResult.error }
        }
      } else {
        membershipAlreadyExists = membershipResult.alreadyMember

        // Grow the paid seat count to match the new member and push the charge
        // to Stripe asynchronously (Team plans only; Enterprise seats are
        // fixed). Best-effort: the member is already in, and a transient
        // failure self-heals on the next join/removal reconcile, matching the
        // removal path's seat accounting.
        if (billingManagesSeats && !membershipResult.alreadyMember) {
          try {
            const seatResult = await reconcileOrganizationSeats({
              organizationId: targetOrganizationId,
              reason: 'member-accepted-invite',
            })

            if (seatResult.changed) {
              const previousSeats = seatResult.previousSeats ?? 0
              const seats = seatResult.seats ?? 0
              recordAudit({
                workspaceId: null,
                actorId: input.userId,
                action: AuditAction.ORG_SEAT_PROVISIONED,
                resourceType: AuditResourceType.ORGANIZATION,
                resourceId: targetOrganizationId,
                description: `Provisioned ${seats} seat(s) after invite acceptance`,
                metadata: {
                  invitationId: inv.id,
                  previousSeats,
                  seats,
                  reason: 'member-accepted-invite',
                },
              })
              captureServerEvent(input.userId, 'seats_provisioned', {
                organization_id: targetOrganizationId,
                previous_seats: previousSeats,
                seats,
                reason: 'member-accepted-invite',
              })
            }
          } catch (seatError) {
            logger.error('Failed to reconcile organization seats after invite acceptance', {
              userId: input.userId,
              organizationId: targetOrganizationId,
              invitationId: inv.id,
              error: seatError,
            })
          }
        }
      }
    } else {
      shouldJoinOrganization = false
    }
  }

  const acceptedWorkspaceIds: string[] = []

  try {
    await db.transaction(async (tx) => {
      /**
       * When this acceptance joins an organization, serialize against a
       * concurrent member-removal for the same user+org and confirm the member
       * still exists before granting workspace access. Without this, a removal
       * landing between the join and the grant would leave the user with
       * workspace access but no org membership/seat.
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
        .where(eq(invitation.id, inv.id))

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
    })
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

  if (shouldJoinOrganization && targetOrganizationId) {
    try {
      await setActiveOrganizationForCurrentSession(targetOrganizationId)
    } catch (activeOrgError) {
      logger.error('Failed to activate organization after accepting invitation', {
        userId: input.userId,
        organizationId: targetOrganizationId,
        invitationId: inv.id,
        error: activeOrgError,
      })
    }
  }

  for (const workspaceId of acceptedWorkspaceIds) {
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
        invitationId: inv.id,
        error: envError,
      })
    }
  }

  if (shouldJoinOrganization && targetOrganizationId && !membershipAlreadyExists) {
    try {
      await syncUsageLimitsFromSubscription(input.userId)
    } catch (syncError) {
      logger.error('Failed to sync usage limits after joining org', {
        userId: input.userId,
        organizationId: targetOrganizationId,
        invitationId: inv.id,
        error: syncError,
      })
    }
  }

  const redirectPath =
    inv.kind === 'workspace' && acceptedWorkspaceIds.length > 0
      ? `/workspace/${acceptedWorkspaceIds[0]}/home`
      : '/workspace'

  return {
    success: true,
    invitation: { ...inv, status: 'accepted', membershipIntent: acceptedMembershipIntent },
    acceptedWorkspaceIds,
    redirectPath,
    membershipAlreadyExists,
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
