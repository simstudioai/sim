import { db } from '@sim/db'
import { member, organization, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { subscriptionTransferContract } from '@/lib/api/contracts/user'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isOrgPlan } from '@/lib/billing/plan-helpers'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  hasPaidSubscriptionStatus,
} from '@/lib/billing/subscriptions/utils'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SubscriptionTransferAPI')

type TransferOutcome =
  | { kind: 'error'; status: number; error: string }
  | { kind: 'noop'; message: string }
  | { kind: 'success'; message: string }

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        logger.warn('Unauthorized subscription transfer attempt')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(subscriptionTransferContract, request, context)
      if (!parsed.success) return parsed.response

      const subscriptionId = parsed.data.params.id
      const { organizationId } = parsed.data.body
      const userId = session.user.id
      logger.info('Processing subscription transfer', { subscriptionId, organizationId })

      const outcome = await db.transaction(async (tx): Promise<TransferOutcome> => {
        const [sub] = await tx
          .select()
          .from(subscription)
          .where(eq(subscription.id, subscriptionId))
          .for('update')

        if (!sub) {
          return { kind: 'error', status: 404, error: 'Subscription not found' }
        }

        if (!isOrgPlan(sub.plan) || !hasPaidSubscriptionStatus(sub.status)) {
          return {
            kind: 'error',
            status: 400,
            error:
              'Only active Team or Enterprise subscriptions can be transferred to an organization.',
          }
        }

        const [org] = await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, organizationId))
          .for('update')

        if (!org) {
          return { kind: 'error', status: 404, error: 'Organization not found' }
        }

        const [mem] = await tx
          .select({ role: member.role })
          .from(member)
          .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
          .limit(1)

        if (!mem || (mem.role !== 'owner' && mem.role !== 'admin')) {
          return {
            kind: 'error',
            status: 403,
            error: 'Unauthorized - user is not admin of organization',
          }
        }

        if (sub.referenceId === organizationId) {
          return { kind: 'noop', message: 'Subscription already belongs to this organization' }
        }

        if (sub.referenceId !== userId) {
          return {
            kind: 'error',
            status: 403,
            error: 'Unauthorized - subscription does not belong to user',
          }
        }

        const [existingOrgSub] = await tx
          .select({ id: subscription.id })
          .from(subscription)
          .where(
            and(
              eq(subscription.referenceId, organizationId),
              inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
            )
          )
          .limit(1)

        if (existingOrgSub) {
          return {
            kind: 'error',
            status: 409,
            error: 'Organization already has an active subscription',
          }
        }

        await tx
          .update(subscription)
          .set({ referenceId: organizationId })
          .where(eq(subscription.id, subscriptionId))

        return { kind: 'success', message: 'Subscription transferred successfully' }
      })

      if (outcome.kind === 'error') {
        return NextResponse.json({ error: outcome.error }, { status: outcome.status })
      }

      if (outcome.kind === 'success') {
        logger.info('Subscription transfer completed', {
          subscriptionId,
          organizationId,
          userId,
        })
      }

      return NextResponse.json({ success: true, message: outcome.message })
    } catch (error) {
      logger.error('Error transferring subscription', {
        error: toError(error).message,
      })
      return NextResponse.json({ error: 'Failed to transfer subscription' }, { status: 500 })
    }
  }
)
