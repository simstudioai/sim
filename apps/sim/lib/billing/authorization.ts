import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { APIError } from 'better-auth/api'
import { hasPaidSubscription } from '@/lib/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { getOrganizationCoverageForMember } from '@/lib/billing/core/subscription'
import {
  assertNoUnresolvedEnterpriseIssuance,
  EnterpriseIssuanceInProgressError,
} from '@/lib/billing/enterprise-outbox'
import { isOrgPlan } from '@/lib/billing/plan-helpers'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'

const logger = createLogger('BillingAuthorization')

/**
 * Classify a `/subscription/upgrade` request as a personal checkout using
 * the same reference resolution as the Better Auth Stripe plugin
 * (`@better-auth/stripe` 1.6.13): an explicit `referenceId` defines the
 * reference (personal iff it is the session user); without one, the
 * reference defaults to the user unless `customerType: 'organization'`
 * selects the session's active organization.
 *
 * This mirror exists because the plugin does not expose its resolution and
 * skips `authorizeReference` for personal references entirely. Re-verify
 * against the plugin's `referenceMiddleware`/`getReferenceId` when
 * upgrading better-auth.
 */
export function isPersonalCheckoutRequest(
  body: { referenceId?: unknown; customerType?: unknown },
  sessionUserId: string
): boolean {
  if (body.referenceId) return body.referenceId === sessionUserId
  return body.customerType !== 'organization'
}

/**
 * Guard for personal (user-referenced) checkouts on `/subscription/upgrade`.
 *
 * A member of an organization with an entitled paid subscription is already
 * covered by that org — their usage pools to it and personal Pro
 * subscriptions are paused on join — so a personal checkout would bill the
 * same human twice. Throws {@link APIError} with a user-facing message; the
 * checkout UI surfaces it as-is.
 *
 * Called from the Better Auth `hooks.before` middleware, NOT from
 * `authorizeReference`: the Stripe plugin skips `authorizeReference`
 * entirely when the reference is the session user, so this is the only
 * enforcement point that personal checkouts actually pass through.
 *
 * Fails closed: when coverage cannot be determined, the checkout is
 * rejected rather than risking a duplicate subscription.
 */
export async function assertPersonalCheckoutAllowed(userId: string): Promise<void> {
  const coverage = await getOrganizationCoverageForMember(userId)

  if (coverage.status === 'covered') {
    logger.warn(
      'Blocking personal checkout - user is already covered by an organization subscription',
      { userId, organizationId: coverage.organizationId }
    )
    throw new APIError('FORBIDDEN', {
      message:
        "You're already covered by your organization's plan, so a personal plan would bill you twice. Manage your plan from the organization's billing settings.",
    })
  }

  if (coverage.status === 'unknown') {
    logger.error(
      'Blocking personal checkout - could not verify organization coverage; failing closed',
      { userId }
    )
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'We could not verify your billing status. Please try again in a moment.',
    })
  }
}

/**
 * Check if a user is authorized to manage billing for a given reference ID.
 * Only invoked for organization references — the Stripe plugin skips this
 * callback when the reference is the session user itself (personal
 * checkouts are guarded by {@link assertPersonalCheckoutAllowed} in the
 * `hooks.before` middleware instead).
 *
 * For `upgrade-subscription` (checkout) this enforces, each thrown as an
 * {@link APIError} with a descriptive message so callers see the real
 * reason instead of a generic "Unauthorized":
 * - Organizations can only check out Team or Enterprise plans — a `pro_*`
 *   plan can never become org-referenced.
 * - Organizations cannot start a checkout while they already have an
 *   active subscription (prevents duplicates).
 * - Checkout is deferred while an Enterprise issuance is unresolved.
 */
export async function authorizeSubscriptionReference(
  userId: string,
  referenceId: string,
  action?: string,
  plan?: string
): Promise<boolean> {
  if (!isOrgScopedSubscription({ referenceId }, userId)) {
    return true
  }

  if (action === 'upgrade-subscription' && !isOrgPlan(plan)) {
    logger.warn('Blocking checkout - organizations can only subscribe to Team or Enterprise', {
      userId,
      referenceId,
      plan: plan ?? null,
    })
    throw new APIError('FORBIDDEN', {
      message: 'Organizations can only subscribe to Team or Enterprise plans.',
    })
  }

  if (action === 'upgrade-subscription' && (await hasPaidSubscription(referenceId))) {
    logger.warn('Blocking checkout - active subscription already exists for organization', {
      userId,
      referenceId,
    })
    throw new APIError('CONFLICT', {
      message:
        'This organization already has an active subscription. Manage it from the billing settings.',
    })
  }

  if (action === 'upgrade-subscription') {
    try {
      // This is an early checkout admission check, not the transactional
      // fence: canonical Sim-side entitlement conversion paths re-check under
      // the organization mutation lock before changing local billing state.
      await assertNoUnresolvedEnterpriseIssuance(db, referenceId)
    } catch (error) {
      if (!(error instanceof EnterpriseIssuanceInProgressError)) throw error
      logger.warn('Blocking checkout - Enterprise issuance is unfinished for organization', {
        userId,
        referenceId,
      })
      throw new APIError('CONFLICT', {
        message:
          'This organization has an Enterprise plan setup in progress. Please try again in a few minutes or contact support.',
      })
    }
  }

  return isOrganizationOwnerOrAdmin(userId, referenceId)
}
