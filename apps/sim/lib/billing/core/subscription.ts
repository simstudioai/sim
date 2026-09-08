import { cache } from 'react'
import { db } from '@sim/db'
import { member, organization, subscription, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getEffectiveBillingStatus, isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import {
  getHighestPriorityPersonalSubscription,
  getHighestPrioritySubscription,
} from '@/lib/billing/core/plan'
import {
  isMaxTier,
  isOrgPlan,
  isEnterprise as isPlanEnterprise,
  isPro as isPlanPro,
  isTeam as isPlanTeam,
  sqlIsPaid,
} from '@/lib/billing/plan-helpers'
import {
  checkEnterprisePlan,
  checkOrgPlan,
  checkProPlan,
  checkTeamPlan,
  ENTITLED_SUBSCRIPTION_STATUSES,
  hasUsableSubscriptionAccess,
  USABLE_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'
import { env } from '@/lib/core/config/env'
import {
  isAccessControlEnabled,
  isBillingEnabled,
  isHosted,
  isInboxEnabled,
  isSandboxDeploymentEntitled,
  isSandboxesEnabled,
  isSsoEnabled,
} from '@/lib/core/config/env-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('SubscriptionCore')

export { getHighestPriorityPersonalSubscription, getHighestPrioritySubscription }

export interface SubscriptionMetadata {
  billingInterval?: 'month' | 'year'
  [key: string]: unknown
}

export interface HasPaidSubscriptionOptions {
  onError?: 'assume-active' | 'throw'
}

/**
 * Extract the billing interval from subscription metadata, defaulting to 'month'.
 */
export function getBillingInterval(
  metadata: SubscriptionMetadata | null | undefined
): 'month' | 'year' {
  return metadata?.billingInterval === 'year' ? 'year' : 'month'
}

/**
 * Resolves a subscription's effective billing interval. Prefers the Stripe-synced
 * `billingInterval` column — the only source populated on enterprise/manual
 * subscriptions, which skip the checkout flow that writes the metadata value — and
 * falls back to `metadata.billingInterval` (the column is often null on
 * checkout-created subs), defaulting to monthly. Where both are set they agree.
 */
export function resolveBillingInterval(
  sub: { billingInterval?: string | null; metadata?: unknown } | null | undefined
): 'month' | 'year' {
  const column = sub?.billingInterval
  if (column === 'year' || column === 'month') return column
  return getBillingInterval((sub?.metadata ?? null) as SubscriptionMetadata | null)
}

/**
 * Merge a `billingInterval` value into a subscription's metadata JSON column.
 */
export async function writeBillingInterval(
  subscriptionId: string,
  interval: 'month' | 'year'
): Promise<void> {
  const patch = JSON.stringify({ billingInterval: interval })
  await db
    .update(subscription)
    .set({
      metadata: sql`(COALESCE(metadata::jsonb, '{}'::jsonb) || ${patch}::jsonb)::json`,
    })
    .where(eq(subscription.id, subscriptionId))
}

/**
 * Sync the subscription's `plan` column to match Stripe. Closes a gap
 * where plan changes (Pro → Team upgrades, tier swaps) updated price,
 * seats, and referenceId at Stripe but left the DB plan stale.
 *
 * Enforces the billing invariant that organization-referenced
 * subscriptions only ever hold Team or Enterprise plans: when Stripe
 * resolves to a non-org plan (e.g. a Pro price was manually swapped onto
 * an org subscription in the Stripe dashboard), the write is refused and
 * an error is logged so operators fix the price in Stripe — the DB row
 * never becomes an org-scoped Pro subscription.
 *
 * Returns the plan the DB row holds after the call. Callers must drive all
 * downstream processing (org ensure, seat sync, usage limits) from this
 * value — never from the raw Stripe plan — so a refused write cannot leak
 * the rejected plan into the rest of the webhook handler.
 *
 * The organization lookup is inlined rather than delegated to
 * `isSubscriptionOrgScoped` because that helper lives in `core/billing.ts`,
 * which imports this module — delegating would create an import cycle.
 */
export async function syncSubscriptionPlan(
  subscriptionId: string,
  currentPlan: string | null,
  planFromStripe: string | null,
  referenceId: string
): Promise<string | null> {
  if (!planFromStripe) return currentPlan
  if (currentPlan === planFromStripe) return currentPlan

  if (!isOrgPlan(planFromStripe)) {
    const [referencedOrganization] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, referenceId))
      .limit(1)

    if (referencedOrganization) {
      logger.error(
        'Refusing to sync a non-org plan onto an organization-referenced subscription — fix the price in Stripe',
        {
          subscriptionId,
          organizationId: referenceId,
          currentPlan,
          rejectedPlan: planFromStripe,
        }
      )
      return currentPlan
    }
  }

  await db
    .update(subscription)
    .set({ plan: planFromStripe })
    .where(eq(subscription.id, subscriptionId))

  logger.info('Synced subscription plan name from Stripe', {
    subscriptionId,
    previousPlan: currentPlan,
    newPlan: planFromStripe,
  })

  return planFromStripe
}

/**
 * Get the organization's subscription row when its status is one of
 * `USABLE_SUBSCRIPTION_STATUSES` (product access — stricter than
 * `ENTITLED_SUBSCRIPTION_STATUSES` which also includes `past_due`).
 * Use this for feature-gating ("can this org use the product right
 * now"). Use `getOrganizationSubscription` (from `core/billing.ts`)
 * when you need the billing-side entitlement row that includes
 * past-due subscriptions. Returns `null` when there is no usable sub.
 */
interface GetOrganizationSubscriptionUsableOptions {
  onError?: 'return-null' | 'throw'
  executor?: DbOrTx
}

export async function getOrganizationSubscriptionUsable(
  organizationId: string,
  options: GetOrganizationSubscriptionUsableOptions = {}
) {
  const { onError = 'return-null', executor = db } = options
  try {
    const [orgSub] = await executor
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          inArray(subscription.status, USABLE_SUBSCRIPTION_STATUSES)
        )
      )
      .limit(1)

    return orgSub ?? null
  } catch (error) {
    logger.error('Error getting usable organization subscription', { error, organizationId })
    if (onError === 'throw') {
      throw error
    }
    return null
  }
}

/**
 * Check if a referenceId (user ID or org ID) has a paid subscription row.
 * Used for duplicate subscription prevention and transfer safety.
 *
 * Fails closed by default: returns true on error to prevent duplicate creation.
 */
export async function hasPaidSubscription(
  referenceId: string,
  options: HasPaidSubscriptionOptions = {}
): Promise<boolean> {
  const { onError = 'assume-active' } = options

  try {
    const [activeSub] = await db
      .select({ id: subscription.id })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, referenceId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .limit(1)

    return !!activeSub
  } catch (error) {
    logger.error('Error checking active subscription', { error, referenceId })

    if (onError === 'throw') {
      throw error
    }

    return true
  }
}

export type OrganizationCoverageResult =
  | { status: 'covered'; organizationId: string }
  | { status: 'not-covered' }
  | { status: 'unknown' }

/**
 * Check whether an organization already covers this user with an entitled
 * paid subscription (the user is a member of the org, any role).
 *
 * Used to block redundant personal checkouts: a member of a paid org has
 * their usage pooled to the org (personal Pro subscriptions are paused on
 * join), so buying a personal plan would double-bill the same human.
 *
 * Returns `'unknown'` on error so callers can fail closed (block checkout
 * rather than risk a duplicate subscription) with accurate messaging.
 */
export async function getOrganizationCoverageForMember(
  userId: string
): Promise<OrganizationCoverageResult> {
  try {
    const [row] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .innerJoin(subscription, eq(subscription.referenceId, member.organizationId))
      .where(
        and(
          eq(member.userId, userId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES),
          sqlIsPaid(subscription.plan)
        )
      )
      .limit(1)

    if (row) return { status: 'covered', organizationId: row.organizationId }
    return { status: 'not-covered' }
  } catch (error) {
    logger.error('Error checking organization coverage for member', { error, userId })
    return { status: 'unknown' }
  }
}

export async function getOrganizationIdForSubscriptionReference(
  referenceId: string
): Promise<string | null> {
  const [referencedOrganization] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, referenceId))
    .limit(1)

  if (referencedOrganization) {
    return referencedOrganization.id
  }

  const [memberRecord] = await db
    .select({
      organizationId: member.organizationId,
      role: member.role,
    })
    .from(member)
    .where(eq(member.userId, referenceId))
    .limit(1)

  if (memberRecord && isOrgAdminRole(memberRecord.role)) {
    return memberRecord.organizationId
  }

  return null
}

/**
 * Check if user is on Pro plan (direct or via organization)
 */
export async function isProPlan(userId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)
    const isPro =
      subscription &&
      (checkProPlan(subscription) ||
        checkTeamPlan(subscription) ||
        checkEnterprisePlan(subscription))

    if (isPro) {
      logger.info('User has pro-level plan', { userId, plan: subscription.plan })
    }

    return !!isPro
  } catch (error) {
    logger.error('Error checking pro plan status', { error, userId })
    return false
  }
}

/**
 * Check if user is on Team plan (direct or via organization)
 */
export async function isTeamPlan(userId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)
    const isTeam =
      subscription && (checkTeamPlan(subscription) || checkEnterprisePlan(subscription))

    if (isTeam) {
      logger.info('User has team-level plan', { userId, plan: subscription.plan })
    }

    return !!isTeam
  } catch (error) {
    logger.error('Error checking team plan status', { error, userId })
    return false
  }
}

/**
 * Check if user is on Enterprise plan (direct or via organization)
 */
export async function isEnterprisePlan(userId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)
    const isEnterprise = subscription && checkEnterprisePlan(subscription)

    if (isEnterprise) {
      logger.info('User has enterprise plan', { userId, plan: subscription.plan })
    }

    return !!isEnterprise
  } catch (error) {
    logger.error('Error checking enterprise plan status', { error, userId })
    return false
  }
}

/**
 * Check if user is an admin or owner of an enterprise organization
 * Returns true if:
 * - User is a member of an enterprise organization AND
 * - User's role in that organization is 'owner' or 'admin'
 *
 * In non-production environments, returns true for convenience.
 */
export async function isEnterpriseOrgAdminOrOwner(userId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    const [memberRecord] = await db
      .select({
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1)

    if (!memberRecord) {
      return false
    }

    if (memberRecord.role !== 'owner' && memberRecord.role !== 'admin') {
      return false
    }

    const billingStatus = await getEffectiveBillingStatus(userId)
    if (billingStatus.billingBlocked) {
      return false
    }

    const orgSub = await getOrganizationSubscriptionUsable(memberRecord.organizationId)

    const isEnterprise = orgSub && checkEnterprisePlan(orgSub)

    if (isEnterprise) {
      logger.info('User is enterprise org admin/owner', {
        userId,
        organizationId: memberRecord.organizationId,
        role: memberRecord.role,
      })
    }

    return !!isEnterprise
  } catch (error) {
    logger.error('Error checking enterprise org admin/owner status', { error, userId })
    return false
  }
}

/**
 * Whether an organization's entitlement actually comes from its subscription
 * row, as opposed to being granted by deployment configuration.
 *
 * `resolveOrganizationEnterprisePlan` short-circuits to `true` in two modes —
 * billing disabled, and self-hosted with access control enabled — where no
 * `subscription` row need exist at all. Anything that wants to re-verify an
 * entitlement against the subscription table must consult this first, or it
 * will read a missing row as a lapse and refuse work that should proceed.
 * Exported so those callers cannot drift from the short-circuits below.
 */
export function isSubscriptionBackedEntitlement(): boolean {
  return isBillingEnabled && !(isAccessControlEnabled && !isHosted)
}

/**
 * What a billing-read failure resolves to for the Enterprise gate.
 *
 * `'return-false'` (the default) fails closed for a *feature* gate: the feature
 * is hidden, and the worst outcome is a button that is briefly missing.
 *
 * `'throw'` is for callers where "no Enterprise plan" is not a smaller answer
 * but a different regime. Access Control resolves to `config: null` when the
 * organization is not entitled, and `null` means *every* capability allowed and
 * every allowlist off — so a swallowed subscription-read failure would silently
 * disable the whole permission-group regime for the request instead of
 * surfacing an error. Those callers must pass `'throw'`.
 *
 * A primitive rather than an options object on purpose: `cache()` keys on the
 * argument list, and a fresh object literal per call would miss the memo every
 * time.
 */
export type EnterprisePlanErrorPolicy = 'return-false' | 'throw'

async function resolveOrganizationEnterprisePlan(
  organizationId: string,
  onError: EnterprisePlanErrorPolicy = 'return-false',
  executor: DbOrTx = db
): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    if (isAccessControlEnabled && !isHosted) {
      return true
    }

    if (await isOrganizationBillingBlocked(organizationId, executor)) {
      return false
    }

    /**
     * The subscription read soft-fails to `null` by default, which would arrive
     * here as an ordinary "no usable subscription" and return a successful
     * `false` — the catch below never sees it. A caller that asked to throw
     * needs that failure propagated too.
     */
    const orgSub = await getOrganizationSubscriptionUsable(organizationId, {
      executor,
      ...(onError === 'throw' ? { onError: 'throw' as const } : {}),
    })

    return !!orgSub && checkEnterprisePlan(orgSub)
  } catch (error) {
    logger.error('Error checking organization enterprise plan status', { error, organizationId })
    if (onError === 'throw') {
      throw error
    }
    return false
  }
}

/**
 * Resolves whether an organization holds a paying organization plan — Pro for
 * Teams, Max for Teams, or Enterprise — without request memoization.
 *
 * Gates features every paying organization gets, as opposed to
 * {@link resolveOrganizationEnterprisePlan}, which gates the Enterprise-only
 * tier. A billing-blocked organization resolves false either way.
 */
interface ResolveOrganizationPlanOptions {
  /**
   * What a billing-read failure resolves to. `'return-false'` (default) fails
   * closed, which is what a one-shot gate wants. A caller that *caches* the
   * answer must pass `'throw'`: a swallowed failure is indistinguishable from a
   * real plan lapse, so caching it would hold the gate shut for the whole TTL
   * over what may be a momentary outage.
   */
  onError?: 'return-false' | 'throw'
}

export async function resolveOrganizationPlan(
  organizationId: string,
  options: ResolveOrganizationPlanOptions = {}
): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    /**
     * The block state and the subscription row are independent reads, so they
     * go out together — this runs on the workflow execution path, where a
     * second serial round trip is per-block latency. A blocked organization
     * pays for one subscription read it does not use, which is the rare case.
     */
    const [blocked, orgSub] = await Promise.all([
      isOrganizationBillingBlocked(organizationId),
      /**
       * The subscription read soft-fails to `null` by default, which would
       * arrive here as a perfectly ordinary "no usable subscription" and return
       * a successful `false` — the outer catch never sees it. A caller that
       * asked to throw needs that failure propagated too, or a cached answer
       * would still record an outage as a plan lapse.
       */
      getOrganizationSubscriptionUsable(
        organizationId,
        options.onError === 'throw' ? { onError: 'throw' } : {}
      ),
    ])

    if (blocked) {
      return false
    }

    return !!orgSub && checkOrgPlan(orgSub)
  } catch (error) {
    logger.error('Error checking organization plan status', { error, organizationId })
    if (options.onError === 'throw') {
      throw error
    }
    return false
  }
}

/**
 * Check if an organization has an enterprise plan
 * Used for Access Control (Permission Groups) feature gating
 *
 * Request-memoized: a settings render gates several sections on the same
 * organization's plan, and it cannot change mid-render. `cache()` keys on the
 * whole argument list, so the default and `'throw'` policies memoize
 * separately — a request that mixes both pays for two reads, and a rejection is
 * replayed to every later caller that asked for the same policy, which is the
 * fail-closed behavior those callers want.
 *
 * Pass `'throw'` from any caller for which a swallowed read failure would read
 * as a *permissive* answer rather than a restrictive one — see
 * {@link EnterprisePlanErrorPolicy}.
 */
export const isOrganizationOnEnterprisePlan = cache(resolveOrganizationEnterprisePlan)

/**
 * Entitlement for a single org-scoped enterprise feature.
 *
 * When billing runs, the organization's plan decides and every feature moves
 * together. When it does not, there is no plan to read, so deployment
 * configuration decides per feature — which is what lets an operator run, say,
 * audit logs without whitelabeling.
 *
 * Pass the matching flag from `@/lib/core/config/env-flags` as
 * `selfHostEntitlement`; those already resolve the master switch and the
 * feature's legacy default.
 *
 * Prefer this over calling {@link isOrganizationOnEnterprisePlan} directly in a
 * feature gate. That helper is feature-agnostic and answers `true` for
 * everything once billing is off, which is exactly the behavior that made
 * self-hosted flags meaningless.
 */
export async function isOrganizationFeatureEntitled(
  organizationId: string,
  selfHostEntitlement: boolean,
  executor: DbOrTx = db
): Promise<boolean> {
  if (!isBillingEnabled) return selfHostEntitlement
  return isOrganizationOnEnterprisePlan(organizationId, 'return-false', executor)
}

/**
 * Check if user has access to SSO feature
 * Returns true if:
 * - SSO_ENABLED env var is set (self-hosted override), OR
 * - User is admin/owner of an enterprise organization
 *
 * In non-production environments, returns true for convenience.
 */
export async function hasSSOAccess(userId: string): Promise<boolean> {
  try {
    if (isSsoEnabled && !isHosted) {
      return true
    }

    return isEnterpriseOrgAdminOrOwner(userId)
  } catch (error) {
    logger.error('Error checking SSO access', { error, userId })
    return false
  }
}

/**
 * Check whether a workspace is entitled to workspace-scoped enterprise features
 * — today, copilot BYOK. Entitlement follows the workspace's billing entity:
 * - self-hosted override honored via ACCESS_CONTROL_ENABLED, OR
 * - billing disabled, OR
 * - the workspace belongs to an enterprise-plan organization (org-mode), OR
 * - the billed user has an individual enterprise subscription (personal workspace).
 *
 * Org-scoped Access Control (Permission Groups) gates on
 * {@link isOrganizationOnEnterprisePlan} instead — it has no workspace to resolve.
 */
export async function isWorkspaceOnEnterprisePlan(workspaceId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) return true
    if (isAccessControlEnabled && !isHosted) return true

    return await hasWorkspaceTierAccess(workspaceId, isPlanEnterprise)
  } catch (error) {
    logger.error('Error checking workspace enterprise plan status', { error, workspaceId })
    return false
  }
}

/**
 * How a workspace tier gate treats subscription status and billing-blocked state.
 *
 * - `'active-use'` — the payer must hold an `active` subscription and must not be
 *   billing-blocked. Correct for gating use of a feature.
 * - `'retention'` — `active` and `past_due` both count, and block state is
 *   ignored, so a transient payment failure never triggers destructive teardown of
 *   already-provisioned infrastructure. Only reconciliation guards want this.
 */
type WorkspaceTierIntent = 'active-use' | 'retention'

interface WorkspaceTierAccessOptions {
  intent?: WorkspaceTierIntent
  /**
   * Result when the workspace row no longer exists. Teardown guards pass `true`
   * so a missing workspace never reads as "safe to destroy".
   */
  onMissingWorkspace?: boolean
  /**
   * What a subscription-read failure resolves to. By default the reads soft-fail
   * to "no subscription", which a one-shot gate correctly reads as a denial. A
   * caller that *caches* the answer must pass `'throw'`: a swallowed failure is
   * indistinguishable from a real lapse, and caching it would hold the gate
   * shut for a whole TTL over a momentary outage. Honored on the `retention`
   * reads, which are the only ones a cached caller uses.
   */
  onError?: 'return-null' | 'throw'
}

/**
 * Whether the workspace's payer is on a plan satisfying `isTierEntitled`.
 *
 * Entitlement follows the workspace's billing entity — not the acting user — so
 * any workspace admin (including an external member) qualifies when the
 * workspace's organization, or its billed account for personal workspaces, is on
 * a qualifying plan.
 *
 * This is the single payer resolution behind every workspace-scoped tier gate.
 * Callers supply only the tier predicate and their own feature's env override;
 * keeping the org/personal fork here is what stops the gates from drifting apart
 * as billing edge cases are handled.
 *
 * The personal branch reads `getEffectiveBillingStatus`, NOT `userStats.billingBlocked`
 * directly. Both express the same shipped policy — `blockOrgMembers` fans a
 * delinquent org's block out to every member's own row, so membership in a
 * delinquent org blocks you on personal resources too — but the fan-out is a
 * point-in-time write and goes stale: nothing marks a member who joins an
 * already-blocked org, and `unblockOrgMembers` clears the row even when a second
 * delinquent org still covers them. Re-deriving from membership is what makes
 * the read agree with the policy in those cases.
 */
async function hasWorkspaceTierAccess(
  workspaceId: string,
  isTierEntitled: (plan: string) => boolean,
  options: WorkspaceTierAccessOptions = {}
): Promise<boolean> {
  const { intent = 'active-use', onMissingWorkspace = false, onError } = options
  const readOptions = onError === 'throw' ? ({ onError: 'throw' } as const) : {}

  const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
  const ws = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
  if (!ws) return onMissingWorkspace

  if (intent === 'retention') {
    if (ws.organizationId) {
      const { getOrganizationSubscription } = await import('@/lib/billing/core/billing')
      const orgSub = await getOrganizationSubscription(ws.organizationId, readOptions)
      return !!orgSub && isTierEntitled(orgSub.plan)
    }

    const billedSub = await getHighestPriorityPersonalSubscription(
      ws.billedAccountUserId,
      readOptions
    )
    return !!billedSub && isTierEntitled(billedSub.plan)
  }

  if (ws.organizationId) {
    const [billingBlocked, orgSub] = await Promise.all([
      isOrganizationBillingBlocked(ws.organizationId),
      getOrganizationSubscriptionUsable(ws.organizationId),
    ])
    if (!orgSub) return false
    if (!hasUsableSubscriptionAccess(orgSub.status, billingBlocked)) return false
    return isTierEntitled(orgSub.plan)
  }

  const [billedSub, billingStatus] = await Promise.all([
    getHighestPriorityPersonalSubscription(ws.billedAccountUserId),
    getEffectiveBillingStatus(ws.billedAccountUserId),
  ])
  if (!billedSub) return false
  if (!hasUsableSubscriptionAccess(billedSub.status, billingStatus.billingBlocked)) return false
  return isTierEntitled(billedSub.plan)
}

/**
 * Whether the workspace's payer is on a usable Max-or-Enterprise subscription.
 * Shared by the inbox (Sim Mailer), live sync, and custom sandboxes, which all
 * sit on the same entitlement tier.
 *
 * Request-memoized: these features are gated side by side on one settings render,
 * each otherwise repeating the identical workspace and subscription reads. The
 * per-feature deployment and env short-circuits live in the wrappers and still run
 * per call.
 */
const hasMaxTierWorkspaceAccess = cache(
  (workspaceId: string): Promise<boolean> => hasWorkspaceTierAccess(workspaceId, isMaxTier)
)

/**
 * Check whether a workspace is entitled to the inbox (Sim Mailer) feature.
 * Entitlement follows the workspace's billing entity — not the acting user — so
 * any workspace admin (including an external member) can manage the inbox when
 * the workspace's organization, or its billed account for personal workspaces,
 * is on a Max or enterprise plan.
 *
 * Always false without `COPILOT_API_KEY` — inbox tasks are executed by the
 * mothership and answered with a link to the resulting chat, so neither half
 * works without it. That check comes first because the `!isBillingEnabled`
 * shortcut below would otherwise hand every self-hosted deployment a broken
 * Inbox.
 *
 * Otherwise returns true if:
 * - INBOX_ENABLED env var is set (self-hosted override), OR
 * - billing is disabled, OR
 * - the workspace belongs to an organization on a Max/enterprise plan (org-mode), OR
 * - the billed user has an individual Max/enterprise subscription (personal workspace).
 */
export async function hasWorkspaceInboxAccess(workspaceId: string): Promise<boolean> {
  try {
    if (!env.COPILOT_API_KEY) return false
    if (isInboxEnabled) return true
    if (!isBillingEnabled) return true
    return await hasMaxTierWorkspaceAccess(workspaceId)
  } catch (error) {
    logger.error('Error checking workspace inbox access', { error, workspaceId })
    return false
  }
}

/**
 * Whether a workspace should RETAIN its provisioned inbox (Sim Mailer)
 * infrastructure. Unlike {@link hasWorkspaceInboxAccess}, which gates active use
 * on a *usable* (active) subscription, this uses the broader *entitled* status
 * set (active OR `past_due`) so a transient payment failure never triggers the
 * destructive teardown of a paying customer's inbox.
 *
 * Reconciliation should delete AgentMail resources only when this returns
 * `false` — i.e. the plan is genuinely terminal (canceled, downgraded off
 * Max/Enterprise, or gone). Fails open (returns `true`) on any error or
 * ambiguity: never tear down on uncertainty.
 */
export async function hasWorkspaceInboxGraceAccess(workspaceId: string): Promise<boolean> {
  try {
    if (isInboxEnabled) return true
    if (!isBillingEnabled) return true

    return await hasWorkspaceTierAccess(workspaceId, isMaxTier, {
      intent: 'retention',
      onMissingWorkspace: true,
    })
  } catch (error) {
    logger.error('Error checking workspace inbox grace access', { error, workspaceId })
    return true
  }
}

/**
 * Checks whether the exact workspace payer can use five-minute connector sync.
 */
export async function hasWorkspaceLiveSyncAccess(workspaceId: string): Promise<boolean> {
  try {
    if (!isHosted || !isBillingEnabled) return true
    return await hasMaxTierWorkspaceAccess(workspaceId)
  } catch (error) {
    logger.error('Error checking workspace live sync access', { error, workspaceId })
    return false
  }
}

/**
 * Checks whether the exact workspace payer can discover, author, or directly
 * select custom Sim sandboxes through Copilot.
 *
 * A configured remote Function provider is mandatory. On billing-free
 * deployments, the Enterprise pair or Sandbox-specific pair grants access. With
 * billing enabled, an explicit Sandbox deployment override wins; otherwise the
 * workspace payer must hold a usable Max or Enterprise subscription. Builds cost
 * provider compute and storage, so this deliberately sits above the plain paid
 * tier.
 *
 * Function execution consults the retention variant,
 * {@link hasWorkspaceSandboxRetentionAccess}, so a payment retry never fails a
 * running workflow while a terminal downgrade does. Copilot discovery,
 * mutations, attachments, and direct run_function selections re-check this
 * usable-plan gate.
 */
export async function hasWorkspaceSandboxAccess(workspaceId: string): Promise<boolean> {
  try {
    if (!isSandboxesEnabled) return false
    if (isSandboxDeploymentEntitled) return true
    if (!isBillingEnabled) return false
    return await hasMaxTierWorkspaceAccess(workspaceId)
  } catch (error) {
    logger.error('Error checking workspace sandbox access', { error, workspaceId })
    return false
  }
}

/**
 * Whether a workspace may keep EXECUTING the sandboxes already attached to its
 * Function blocks.
 *
 * Unlike {@link hasWorkspaceSandboxAccess}, which gates authoring on a *usable*
 * subscription, this uses the retention status set — `active` or `past_due`,
 * block state ignored — so a transient payment failure never turns a deployed
 * workflow into a run-time outage. Only a terminal lapse (cancelled, downgraded
 * off Max/Enterprise, or gone) fails the block. The deployment overrides
 * short-circuit exactly as they do for authoring.
 *
 * The execution path reads this through a bounded cache
 * (`hasWorkspaceSandboxRetentionAccessCached`), which is why `onError: 'throw'`
 * exists: a swallowed read failure is indistinguishable from a real lapse, and
 * caching it would hold every Function block shut for a whole TTL over a
 * momentary outage. The default keeps the one-shot fail-closed behavior.
 */
export async function hasWorkspaceSandboxRetentionAccess(
  workspaceId: string,
  options: { onError?: 'return-false' | 'throw' } = {}
): Promise<boolean> {
  try {
    if (!isSandboxesEnabled) return false
    if (isSandboxDeploymentEntitled) return true
    if (!isBillingEnabled) return false
    return await hasWorkspaceTierAccess(workspaceId, isMaxTier, {
      intent: 'retention',
      onMissingWorkspace: true,
      ...(options.onError === 'throw' ? { onError: 'throw' as const } : {}),
    })
  } catch (error) {
    logger.error('Error checking workspace sandbox retention access', { error, workspaceId })
    if (options.onError === 'throw') throw error
    return false
  }
}

/**
 * Send welcome email for Pro and Team plan subscriptions
 */
export async function sendPlanWelcomeEmail(subscription: any): Promise<void> {
  try {
    const subPlan = subscription.plan
    if (isPlanPro(subPlan) || isPlanTeam(subPlan)) {
      const userId = subscription.referenceId
      const users = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)

      if (users.length > 0 && users[0].email) {
        const { getPlanWelcomeSubject, renderPlanWelcomeEmail } = await import(
          '@/components/emails'
        )
        const { sendEmail } = await import('@/lib/messaging/email/mailer')

        const baseUrl = getBaseUrl()
        const { getDisplayPlanName } = await import('@/lib/billing/plan-helpers')
        const displayName = getDisplayPlanName(subPlan)

        const html = await renderPlanWelcomeEmail({
          planName: displayName,
          userName: users[0].name || undefined,
          loginLink: `${baseUrl}/login`,
        })

        await sendEmail({
          to: users[0].email,
          subject: getPlanWelcomeSubject(displayName),
          html,
          emailType: 'updates',
        })

        logger.info('Plan welcome email sent successfully', {
          userId,
          email: users[0].email,
          plan: subPlan,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to send plan welcome email', {
      error,
      subscriptionId: subscription.id,
      plan: subscription.plan,
    })
    throw error
  }
}
