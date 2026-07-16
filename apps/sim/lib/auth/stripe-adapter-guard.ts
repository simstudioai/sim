import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { eq } from 'drizzle-orm'
import { isOrgPlan } from '@/lib/billing/plan-helpers'

const logger = createLogger('StripeAdapterGuard')

type BetterAuthAdapter = ReturnType<ReturnType<typeof drizzleAdapter>>

type SubscriptionWriteSurface = Pick<
  BetterAuthAdapter,
  'create' | 'update' | 'updateMany' | 'findOne' | 'findMany'
>

/**
 * The Better Auth Stripe plugin persists webhook state through the raw
 * database adapter BEFORE invoking our subscription callbacks — including the
 * `plan` column resolved from the Stripe price. That makes the adapter the
 * only in-process seam that can enforce the billing invariant that
 * organization-referenced subscriptions hold Team/Enterprise plans: by the
 * time `syncSubscriptionPlan` runs in a callback, the plugin's write has
 * already landed.
 *
 * Checkout admission blocks user-driven violations; this guard blocks the
 * remaining vector — an operator swapping an org subscription onto a personal
 * price in the Stripe dashboard. It never repairs state: an invalid `plan`
 * write is refused (update: the field is stripped so status/period/seat sync
 * still lands; create: the whole insert is rejected) and an error is logged
 * so operators fix the price in Stripe.
 *
 * Transactions are wrapped recursively so writes inside
 * `adapter.transaction(...)` callbacks go through the same guard.
 */
export function guardSubscriptionPlanWrites(adapter: BetterAuthAdapter): BetterAuthAdapter {
  const guarded: BetterAuthAdapter = {
    ...adapter,
    ...guardWriteSurface(adapter),
  }

  const transaction = adapter.transaction
  if (typeof transaction === 'function') {
    guarded.transaction = (callback) =>
      transaction((trx) => callback({ ...trx, ...guardWriteSurface(trx) }))
  }

  return guarded
}

function guardWriteSurface<TAdapter extends SubscriptionWriteSurface>(
  adapter: TAdapter
): SubscriptionWriteSurface {
  return {
    findOne: adapter.findOne,
    findMany: adapter.findMany,
    create: async (data) => {
      if (data.model === 'subscription') {
        const values = data.data as Record<string, unknown>
        const plan = values.plan
        const referenceId = values.referenceId
        if (
          typeof plan === 'string' &&
          !isOrgPlan(plan) &&
          typeof referenceId === 'string' &&
          (await isOrganizationReference(referenceId))
        ) {
          logger.error(
            'Blocked creating an organization-referenced subscription with a non-org plan — fix the plan or reference in Stripe',
            { referenceId, rejectedPlan: plan }
          )
          throw new Error(
            `Organization-referenced subscriptions must hold a Team or Enterprise plan (got '${plan}')`
          )
        }
      }
      return adapter.create(data)
    },
    update: async (data) => {
      if (data.model === 'subscription' && hasNonOrgPlanWrite(data.update)) {
        const row = await adapter.findOne<SubscriptionRowSlice>({
          model: 'subscription',
          where: data.where,
        })
        const sanitized = await stripPlanWhenOrgReferenced(
          row ? [row] : [],
          data.update as Record<string, unknown>
        )
        if (sanitized.blockedAll) return row as never
        return adapter.update({ ...data, update: sanitized.update as never })
      }
      return adapter.update(data)
    },
    updateMany: async (data) => {
      if (data.model === 'subscription' && hasNonOrgPlanWrite(data.update)) {
        const rows = await adapter.findMany<SubscriptionRowSlice>({
          model: 'subscription',
          where: data.where,
        })
        const sanitized = await stripPlanWhenOrgReferenced(rows, data.update)
        if (sanitized.blockedAll) return 0
        return adapter.updateMany({ ...data, update: sanitized.update })
      }
      return adapter.updateMany(data)
    },
  }
}

interface SubscriptionRowSlice {
  id: string
  referenceId: string
  plan: string
}

function hasNonOrgPlanWrite(update: unknown): boolean {
  if (!update || typeof update !== 'object' || !('plan' in update)) return false
  const plan = (update as { plan: unknown }).plan
  return typeof plan === 'string' && !isOrgPlan(plan)
}

async function isOrganizationReference(referenceId: string): Promise<boolean> {
  const [referencedOrganization] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, referenceId))
    .limit(1)
  return Boolean(referencedOrganization)
}

interface SanitizedSubscriptionUpdate {
  update: Record<string, unknown>
  /** True when stripping the invalid plan left nothing to write. */
  blockedAll: boolean
}

/**
 * Strip a non-org `plan` (and its derived `limits`) from an update when ANY
 * targeted row is organization-referenced. The remaining fields (status,
 * periods, seats, cancellation state) are legitimate Stripe state and still
 * sync. Evaluating every targeted row keeps multi-row updates safe: a mixed
 * personal/org target set must not leak the invalid plan onto the org rows.
 */
async function stripPlanWhenOrgReferenced(
  rows: SubscriptionRowSlice[],
  update: Record<string, unknown>
): Promise<SanitizedSubscriptionUpdate> {
  let organizationRow: SubscriptionRowSlice | null = null
  for (const row of rows) {
    if (await isOrganizationReference(row.referenceId)) {
      organizationRow = row
      break
    }
  }
  if (!organizationRow) {
    return { update, blockedAll: false }
  }

  logger.error(
    'Blocked writing a non-org plan onto an organization-referenced subscription — fix the price in Stripe',
    {
      subscriptionId: organizationRow.id,
      organizationId: organizationRow.referenceId,
      currentPlan: organizationRow.plan,
      rejectedPlan: update.plan,
    }
  )

  const { plan: _plan, limits: _limits, ...rest } = update
  return { update: rest, blockedAll: Object.keys(rest).length === 0 }
}
