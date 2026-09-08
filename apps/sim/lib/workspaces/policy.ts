import { db } from '@sim/db'
import { member, type WorkspaceMode, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, count, eq, isNull } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import {
  acquireOrganizationUserMutationLocks,
  getUserOrganization,
} from '@/lib/billing/organizations/membership'
import type { PlanCategory } from '@/lib/billing/plan-helpers'
import { getPlanType, isEnterprise, isMaxTier, isPro, isTeam } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'
import {
  capabilityRefusal,
  isEntitledOrganizationCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { isOrganizationPermissionRegimeActive } from '@/lib/permission-groups/resolve.server'
import {
  CONTACT_OWNER_TO_UPGRADE_REASON,
  UPGRADE_TO_INVITE_REASON,
} from '@/lib/workspaces/policy-constants'

const logger = createLogger('WorkspacePolicy')

export const WORKSPACE_MODE = {
  PERSONAL: 'personal',
  ORGANIZATION: 'organization',
  GRANDFATHERED_SHARED: 'grandfathered_shared',
} as const satisfies Record<string, WorkspaceMode>

interface WorkspaceOwnershipState {
  organizationId: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
  ownerId: string
}

export {
  CONTACT_OWNER_TO_UPGRADE_REASON,
  UPGRADE_TO_INVITE_REASON,
} from '@/lib/workspaces/policy-constants'

export interface WorkspaceInvitePolicy {
  allowed: boolean
  reason: string | null
  requiresSeat: boolean
  organizationId: string | null
  upgradeRequired: boolean
}

/** Caller-facing invite flags derived from an evaluated invite policy. */
export interface WorkspaceInviteFlags {
  inviteMembersEnabled: boolean
  inviteDisabledReason: string | null
  inviteUpgradeRequired: boolean
}

/**
 * Derives the caller-facing invite flags for a workspace response. Only the
 * billed user can act on an upgrade, so everyone else gets the contact-owner
 * message when invites are disabled.
 */
export function resolveInviteFlags(
  invitePolicy: WorkspaceInvitePolicy,
  callerIsBilledUser: boolean
): WorkspaceInviteFlags {
  return {
    inviteMembersEnabled: invitePolicy.allowed,
    inviteDisabledReason: invitePolicy.allowed
      ? null
      : callerIsBilledUser
        ? (invitePolicy.reason ?? UPGRADE_TO_INVITE_REASON)
        : CONTACT_OWNER_TO_UPGRADE_REASON,
    inviteUpgradeRequired: invitePolicy.upgradeRequired && callerIsBilledUser,
  }
}

export interface WorkspaceCreationPolicy {
  canCreate: boolean
  workspaceMode: WorkspaceMode
  organizationId: string | null
  billedAccountUserId: string
  maxWorkspaces: number | null
  currentWorkspaceCount: number
  reason: string | null
  status: number
  /**
   * The organization the caller belonged to when this decision was made
   * (`null` for none). A PERSONAL decision is legitimate for an existing
   * member whose organization has no usable Team/Enterprise plan, so
   * creation compares membership against this snapshot instead of treating
   * any membership as a mid-create join.
   */
  observedOrganizationId: string | null
  /**
   * The organization whose permission-group regime governed this decision, from
   * {@link resolveGoverningPermissionGroupOrganization} (`null` for none).
   *
   * Carried on the policy so creation can reuse it instead of resolving the
   * identical value a second time: React's `cache()` memo does not span these
   * two calls (an App Route installs no cache dispatcher), so the entitlement
   * read would otherwise be issued twice per request.
   */
  governingPermissionGroupOrganizationId: string | null
  /** Discriminant for blocked states the workspace mode cannot distinguish. */
  blockedReasonCode?: 'organization-subscription-inactive' | 'permission-group-denied'
}

export class WorkspaceCreationContextChangedError extends Error {
  constructor(message = 'Workspace creation context changed before the workspace was inserted') {
    super(message)
    this.name = 'WorkspaceCreationContextChangedError'
  }
}

/**
 * The permission-group case of {@link WorkspaceCreationContextChangedError}.
 *
 * A subclass rather than a sibling so every caller that already treats a changed
 * context as retryable keeps working unchanged, while a surface that wants to
 * say *why* — the create route answers 403 with the capability refusal instead
 * of 409 "membership changed" — can narrow to it.
 */
export class WorkspaceCreationCapabilityWithheldError extends WorkspaceCreationContextChangedError {
  constructor() {
    super(capabilityRefusal('workspace.create'))
    this.name = 'WorkspaceCreationCapabilityWithheldError'
  }
}

/**
 * The organization whose permission-group regime governs this creation, or
 * `null` when none does — resolved BEFORE the transaction opens and passed into
 * {@link lockWorkspaceCreationContext}.
 *
 * Falls back to `observedOrganizationId` so a personal workspace stays governed
 * by the caller's own organization — see {@link getWorkspaceCreationPolicy} for
 * why exempting it would defeat the gate. {@link lockWorkspaceCreationContext}
 * refuses to commit unless live membership still equals that value, so a verdict
 * reached here can never be applied to a different organization.
 *
 * This path settles entitlement during preflight. A concurrent entitlement
 * lapse can keep the group's restrictions for this request; a concurrent grant
 * can leave them inactive until the next request. The permission-group lock
 * alone does not serialize subscription changes.
 *
 * The `forUpdate` subscription re-read below accepts Team *or* Enterprise; the
 * permission-group regime is Enterprise-only, so it cannot stand in for this.
 *
 * The mutable half — the default group's `workspace.create` capability — is NOT
 * decided here. It is re-read inside the transaction under the permission-group
 * lock, which is what actually closes the revocation window.
 */
export async function resolveGoverningPermissionGroupOrganization(params: {
  organizationId: string | null
  observedOrganizationId: string | null
}): Promise<string | null> {
  const organizationId = params.organizationId ?? params.observedOrganizationId
  if (!organizationId) return null
  return (await isOrganizationPermissionRegimeActive(organizationId)) ? organizationId : null
}

/**
 * Serializes the membership/ownership context with the workspace insert and
 * row-locks the paid entitlement used by organization mode. Returns the live
 * billing owner. The caller must invoke this in the same transaction as the
 * insert.
 *
 * permission-group-enforced: workspace.create — the capability is re-read here,
 * under `permission_group:<org>`, the same advisory lock every permission-group
 * mutation takes. That is the whole point of doing it inside the transaction:
 * reading it anywhere else leaves a window in which an admin's revocation
 * commits between the check and the insert. The caller supplies
 * `governingPermissionGroupOrganizationId` because the entitlement half of that
 * decision cannot run on a transaction executor — see
 * {@link resolveGoverningPermissionGroupOrganization}.
 *
 * LOCK ORDER: `organization-mutation:<org>` → `user-billing-identity:<user>` →
 * `<user>:<org>` → `permission_group:<org>` (a leaf lock — see
 * `lib/permission-groups/locks.ts`). The permission-group lock is taken LAST,
 * and only AFTER live membership has been confirmed, so a caller who turns out
 * not to belong to the organization never serializes against its admins.
 *
 * It is also taken after the organization's own revalidation — the `FOR UPDATE`
 * subscription re-read and the owner lookup — so an org-wide key that every
 * permission-group admin write contends on is not held across a blocking row
 * lock that can wait out the full `lock_timeout`. Only the capability read and
 * the caller's inserts need its protection. The refusal order shifts with it:
 * an organization that BOTH lapsed and withholds the capability now reports the
 * lapse, which is the condition the admin must fix first anyway.
 */
export async function lockWorkspaceCreationContext(
  tx: DbOrTx,
  {
    userId,
    organizationId,
    observedOrganizationId,
    governingPermissionGroupOrganizationId,
  }: {
    userId: string
    organizationId: string | null
    observedOrganizationId: string | null
    governingPermissionGroupOrganizationId: string | null
  }
): Promise<{ billedAccountUserId: string }> {
  await acquireOrganizationUserMutationLocks(tx, {
    userId,
    organizationIds: organizationId ? [organizationId] : [],
  })
  const currentMembership = await getUserOrganization(userId, tx)
  if (
    (currentMembership?.organizationId ?? null) !== observedOrganizationId ||
    (organizationId !== null && currentMembership?.organizationId !== organizationId)
  ) {
    throw new WorkspaceCreationContextChangedError()
  }

  let billedAccountUserId = userId
  if (organizationId) {
    if (isBillingEnabled) {
      if (!currentMembership || !isOrgAdminRole(currentMembership.role)) {
        throw new WorkspaceCreationContextChangedError()
      }
      const currentSubscription = await getOrganizationSubscription(organizationId, {
        executor: tx,
        onError: 'throw',
        forUpdate: true,
      })
      if (
        !currentSubscription ||
        !hasUsableSubscriptionStatus(currentSubscription.status) ||
        (!isTeam(currentSubscription.plan) && !isEnterprise(currentSubscription.plan))
      ) {
        throw new WorkspaceCreationContextChangedError()
      }
    }

    const currentOwnerId = await getOrganizationOwnerId(organizationId, tx)
    if (!currentOwnerId) throw new WorkspaceCreationContextChangedError()
    billedAccountUserId = currentOwnerId
  }

  if (governingPermissionGroupOrganizationId) {
    await acquirePermissionGroupOrgLock(tx, governingPermissionGroupOrganizationId, {
      lockTimeoutAlreadyBounded: true,
    })
    if (
      await isEntitledOrganizationCapabilityWithheld(
        governingPermissionGroupOrganizationId,
        'workspace.create',
        tx
      )
    ) {
      throw new WorkspaceCreationCapabilityWithheldError()
    }
  }

  return { billedAccountUserId }
}

interface GetWorkspaceCreationPolicyParams {
  userId: string
  activeOrganizationId?: string | null
  /**
   * When true, `activeOrganizationId` is authoritative: it is used exactly as given
   * (including `null`, which means a personal workspace) and never falls back to the
   * caller's membership org. Forks set this so the child always lands in the SOURCE's
   * org, not whatever org the acting user happens to belong to.
   */
  pinOrganization?: boolean
}

export function isOrganizationWorkspace(
  workspaceState: Pick<WorkspaceOwnershipState, 'workspaceMode' | 'organizationId'>
): boolean {
  return (
    workspaceState.workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
    workspaceState.organizationId !== null &&
    workspaceState.organizationId.length > 0
  )
}

/**
 * Computes whether new members can be invited to the given workspace
 * under the active product policy.
 *
 * Any paid billed account (Pro, Team, or Enterprise) may invite — the
 * seat, and any Pro→Team upgrade, is provisioned when the invitee
 * accepts, so invites are no longer seat-gated at this layer. Free
 * accounts are blocked with an upgrade tooltip because there is no
 * payment method to charge at acceptance.
 *
 * - `organization`: allowed; the org already holds a Team/Enterprise
 *   subscription. Only Enterprise keeps an invite-time `requiresSeat`
 *   gate (fixed seats).
 * - `personal` / `grandfathered_shared`: allowed when the billed user is
 *   Pro/Team/Enterprise. For Pro, acceptance creates the org and moves the
 *   subscription to the Team tier.
 *
 * Billing-disabled deployments always allow invites. Existing members
 * keep their access — this policy only governs *new* invitations.
 */
export async function getWorkspaceInvitePolicy(
  workspaceState: WorkspaceOwnershipState
): Promise<WorkspaceInvitePolicy> {
  const billedPlanCategory = isBillingEnabled
    ? await resolveBilledPlanCategory(workspaceState)
    : 'free'
  return evaluateWorkspaceInvitePolicy(workspaceState, { billedPlanCategory })
}

/**
 * Pure evaluator — given the billed account's resolved plan category,
 * returns the policy synchronously. Exposed so bulk callers (e.g. listing
 * every workspace a user can see) can batch the subscription lookups by
 * unique billed account user rather than re-querying per workspace.
 */
export function evaluateWorkspaceInvitePolicy(
  workspaceState: WorkspaceOwnershipState,
  context: { billedPlanCategory: PlanCategory }
): WorkspaceInvitePolicy {
  if (!isBillingEnabled) {
    return {
      allowed: true,
      reason: null,
      requiresSeat: false,
      organizationId: workspaceState.organizationId,
      upgradeRequired: false,
    }
  }

  if (workspaceState.workspaceMode === WORKSPACE_MODE.ORGANIZATION) {
    if (workspaceState.organizationId === null || context.billedPlanCategory === 'free') {
      return blockInvite(workspaceState.organizationId)
    }

    return {
      allowed: true,
      reason: null,
      requiresSeat: context.billedPlanCategory === 'enterprise',
      organizationId: workspaceState.organizationId,
      upgradeRequired: false,
    }
  }

  switch (context.billedPlanCategory) {
    case 'pro':
    case 'team':
      return {
        allowed: true,
        reason: null,
        requiresSeat: false,
        organizationId: workspaceState.organizationId,
        upgradeRequired: false,
      }
    case 'enterprise':
      return {
        allowed: true,
        reason: null,
        requiresSeat: true,
        organizationId: workspaceState.organizationId,
        upgradeRequired: false,
      }
    default:
      return blockInvite(workspaceState.organizationId)
  }
}

function blockInvite(organizationId: string | null): WorkspaceInvitePolicy {
  return {
    allowed: false,
    reason: UPGRADE_TO_INVITE_REASON,
    requiresSeat: false,
    organizationId,
    upgradeRequired: true,
  }
}

async function resolveBilledPlanCategory(
  workspaceState: WorkspaceOwnershipState
): Promise<PlanCategory> {
  if (
    workspaceState.workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
    workspaceState.organizationId
  ) {
    return getInvitePlanCategoryForOrganization(workspaceState.organizationId)
  }
  return getInvitePlanCategoryForUser(workspaceState.billedAccountUserId)
}

/**
 * Resolve the invite-governing plan category for an organization from its
 * subscription. Exposed so bulk callers can batch by unique organization id.
 * Returns `'free'` when there is no usable subscription so lapsed orgs are
 * blocked consistently with accept-time provisioning.
 */
export async function getInvitePlanCategoryForOrganization(
  organizationId: string
): Promise<PlanCategory> {
  try {
    const orgSub = await getOrganizationSubscription(organizationId)
    if (!orgSub || !hasUsableSubscriptionStatus(orgSub.status)) return 'free'
    return getPlanType(orgSub.plan)
  } catch (error) {
    logger.error('Failed to resolve organization subscription for invite policy', {
      organizationId,
      error,
    })
    return 'free'
  }
}

/**
 * Resolve the invite-governing plan category for a single billed account
 * user. Exposed so bulk callers can batch by unique user id. Returns
 * `'free'` when there is no usable paid subscription.
 */
export async function getInvitePlanCategoryForUser(
  userId: string,
  executor: DbOrTx = db
): Promise<PlanCategory> {
  try {
    const sub = await getHighestPrioritySubscription(userId, { executor })
    if (!sub || !hasUsableSubscriptionStatus(sub.status)) return 'free'
    return getPlanType(sub.plan)
  } catch (error) {
    logger.error('Failed to resolve subscription for invite policy', { userId, error })
    return 'free'
  }
}

export async function getWorkspaceCreationPolicy({
  userId,
  activeOrganizationId,
  pinOrganization = false,
}: GetWorkspaceCreationPolicyParams): Promise<WorkspaceCreationPolicy> {
  const membership = await getUserOrganization(userId)
  const organizationId = pinOrganization
    ? (activeOrganizationId ?? null)
    : (activeOrganizationId ?? membership?.organizationId ?? null)
  const orgRole =
    organizationId == null
      ? undefined
      : membership?.organizationId === organizationId
        ? membership.role
        : (
            await db
              .select({ role: member.role })
              .from(member)
              .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
              .limit(1)
          )[0]?.role

  /**
   * Resolved once here and returned on the policy, so the creation call that
   * follows in the same request does not re-issue the entitlement read.
   */
  const governingPermissionGroupOrganizationId = await resolveGoverningPermissionGroupOrganization({
    organizationId,
    observedOrganizationId: membership?.organizationId ?? null,
  })
  if (governingPermissionGroupOrganizationId) {
    /**
     * A new workspace carries no `permissionGroupWorkspace` row, so a member of
     * a scoped group would land in a workspace that group does not target — the
     * one place the whole regime can be stepped out of. Gating the policy rather
     * than the create route also covers forking and the "can I create?" signal
     * the sidebar renders from the same decision.
     *
     * Governed by the organization the caller belongs to even when the resulting
     * workspace would be personal: a personal workspace is precisely the escape,
     * so exempting it would leave the gate answering only the case it is not for.
     */
    // permission-group-enforced: workspace.create — no workspace exists yet, so the workspace-scoped funnel has nothing to resolve a group against
    if (
      await isEntitledOrganizationCapabilityWithheld(
        governingPermissionGroupOrganizationId,
        'workspace.create',
        db
      )
    ) {
      return {
        canCreate: false,
        workspaceMode:
          organizationId === null ? WORKSPACE_MODE.PERSONAL : WORKSPACE_MODE.ORGANIZATION,
        organizationId,
        billedAccountUserId:
          organizationId === null
            ? userId
            : ((await getOrganizationOwnerId(organizationId)) ?? userId),
        maxWorkspaces: null,
        currentWorkspaceCount: 0,
        reason:
          'Your permission group does not allow creating workspaces. Ask an organization admin to change it.',
        status: 403,
        observedOrganizationId: membership?.organizationId ?? null,
        governingPermissionGroupOrganizationId,
        blockedReasonCode: 'permission-group-denied',
      }
    }
  }

  if (activeOrganizationId && !orgRole) {
    const billedAccountUserId = await requireOrganizationOwnerId(activeOrganizationId)

    return {
      canCreate: false,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      organizationId: activeOrganizationId,
      billedAccountUserId,
      maxWorkspaces: null,
      currentWorkspaceCount: 0,
      reason: 'Only organization owners and admins can create organization workspaces.',
      status: 403,
      observedOrganizationId: membership?.organizationId ?? null,
      governingPermissionGroupOrganizationId,
    }
  }

  if (!isBillingEnabled) {
    if (organizationId && orgRole) {
      const billedAccountUserId = await requireOrganizationOwnerId(organizationId)

      /**
       * Members may create organization workspaces once billing is off.
       *
       * The admin-only rule exists because an organization workspace draws on
       * the organization's paid seats and usage. Without billing there is
       * nothing to draw on, and the rule instead produces a dead end: a user
       * auto-joined as a plain member — by instance-organization mode, or by
       * SSO organization provisioning — resolves to an organization context and
       * is then refused any workspace at all, including the personal one they
       * would have received before joining. Members could always create
       * personal workspaces here, so this changes where a new workspace lands,
       * not whether they may make one.
       */
      return {
        canCreate: true,
        workspaceMode: WORKSPACE_MODE.ORGANIZATION,
        organizationId,
        billedAccountUserId,
        maxWorkspaces: null,
        currentWorkspaceCount: 0,
        reason: null,
        status: 200,
        observedOrganizationId: membership?.organizationId ?? null,
        governingPermissionGroupOrganizationId,
      }
    }

    const currentWorkspaceCount = await countNonOrganizationOwnedWorkspaces(userId)

    return {
      canCreate: true,
      workspaceMode: WORKSPACE_MODE.PERSONAL,
      organizationId: null,
      billedAccountUserId: userId,
      maxWorkspaces: null,
      currentWorkspaceCount,
      reason: null,
      status: 200,
      observedOrganizationId: membership?.organizationId ?? null,
      governingPermissionGroupOrganizationId,
    }
  }

  if (organizationId && orgRole) {
    const organizationSubscription = await getOrganizationSubscription(organizationId)

    if (
      organizationSubscription &&
      hasUsableSubscriptionStatus(organizationSubscription.status) &&
      (isTeam(organizationSubscription.plan) || isEnterprise(organizationSubscription.plan))
    ) {
      const billedAccountUserId = await requireOrganizationOwnerId(organizationId)

      if (!isOrgAdminRole(orgRole)) {
        return {
          canCreate: false,
          workspaceMode: WORKSPACE_MODE.ORGANIZATION,
          organizationId,
          billedAccountUserId,
          maxWorkspaces: null,
          currentWorkspaceCount: 0,
          reason: 'Only organization owners and admins can create organization workspaces.',
          status: 403,
          observedOrganizationId: membership?.organizationId ?? null,
          governingPermissionGroupOrganizationId,
        }
      }

      return {
        canCreate: true,
        workspaceMode: WORKSPACE_MODE.ORGANIZATION,
        organizationId,
        billedAccountUserId,
        maxWorkspaces: null,
        currentWorkspaceCount: 0,
        reason: null,
        status: 200,
        observedOrganizationId: membership?.organizationId ?? null,
        governingPermissionGroupOrganizationId,
      }
    }

    /**
     * Lapsed organization (no usable Team/Enterprise plan). A plain member
     * gets NO personal fallback: letting them create workspaces here would
     * hand them an estate outside every admin's view purely because billing
     * lapsed — exactly the purview escape this regime closes. Owners and
     * admins DO fall through to the personal regime below: they sit at the top
     * of the hierarchy, so there is no purview to escape, and after a
     * downgrade they are usually back on a personal plan they still pay for.
     */
    if (!isOrgAdminRole(orgRole)) {
      return {
        canCreate: false,
        workspaceMode: WORKSPACE_MODE.ORGANIZATION,
        organizationId,
        billedAccountUserId: (await getOrganizationOwnerId(organizationId)) ?? userId,
        maxWorkspaces: null,
        currentWorkspaceCount: 0,
        reason:
          "Your organization's subscription is inactive. Ask an organization owner to reactivate it before creating workspaces.",
        status: 403,
        observedOrganizationId: membership?.organizationId ?? null,
        governingPermissionGroupOrganizationId,
        blockedReasonCode: 'organization-subscription-inactive',
      }
    }
  }

  const highestPrioritySubscription = await getHighestPrioritySubscription(userId)
  const plan = highestPrioritySubscription?.plan
  /**
   * Personal (non-organization) workspace cap. Organization workspaces are
   * uncapped and returned above, so this is only reached when the org branch does
   * not apply — including when a Team/Enterprise org's subscription is `past_due`
   * and therefore not `hasUsableSubscriptionStatus`.
   *
   * Deliberately tier-only: `getHighestPrioritySubscription` already admits
   * `past_due`, and delinquency is enforced by the billing-blocked gates rather
   * than by shrinking the cap, which would only obstruct recovery.
   */
  const maxWorkspaces = isMaxTier(plan) ? 10 : isPro(plan) ? 3 : 1
  const currentWorkspaceCount = await countNonOrganizationOwnedWorkspaces(userId)

  if (currentWorkspaceCount >= maxWorkspaces) {
    return {
      canCreate: false,
      workspaceMode: WORKSPACE_MODE.PERSONAL,
      organizationId: null,
      billedAccountUserId: userId,
      maxWorkspaces,
      currentWorkspaceCount,
      reason: `This plan supports up to ${maxWorkspaces} personal workspace${maxWorkspaces === 1 ? '' : 's'}.`,
      status: 403,
      observedOrganizationId: membership?.organizationId ?? null,
      governingPermissionGroupOrganizationId,
    }
  }

  return {
    canCreate: true,
    workspaceMode: WORKSPACE_MODE.PERSONAL,
    organizationId: null,
    billedAccountUserId: userId,
    maxWorkspaces,
    currentWorkspaceCount,
    reason: null,
    status: 200,
    observedOrganizationId: membership?.organizationId ?? null,
    governingPermissionGroupOrganizationId,
  }
}

async function countNonOrganizationOwnedWorkspaces(userId: string): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(workspace)
    .where(and(eq(workspace.ownerId, userId), isNull(workspace.organizationId)))

  return result?.value ?? 0
}

/**
 * Returns the userId of the organization owner, or `null` if the
 * organization has no owner row. Unexpected DB errors propagate to the
 * caller so data-integrity issues surface loudly rather than being
 * silently fallen back to the caller's identity.
 */
export async function getOrganizationOwnerId(
  organizationId: string,
  executor: DbOrTx = db
): Promise<string | null> {
  const [ownerMembership] = await executor
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  return ownerMembership?.userId ?? null
}

/**
 * Like `getOrganizationOwnerId` but throws when no owner row exists.
 * Use when the caller needs a guaranteed billed-account userId — every
 * Better Auth organization is expected to have exactly one owner, so a
 * missing owner is a data-integrity issue that should surface loudly.
 */
async function requireOrganizationOwnerId(organizationId: string): Promise<string> {
  const ownerId = await getOrganizationOwnerId(organizationId)
  if (!ownerId) {
    logger.error('Organization is missing its owner membership row', { organizationId })
    throw new Error(`Organization ${organizationId} has no owner membership`)
  }
  return ownerId
}
