import type { BetterAuthPlugin } from 'better-auth'
import { createAuthEndpoint, getSessionFromCtx, sessionMiddleware } from 'better-auth/api'
import { createLogger } from '@/lib/logs/console/logger'
import { requireLoopsClient } from '@/lib/billing/loops-client'
import { getPlans } from '@/lib/billing/plans'
import { authorizeSubscriptionReference } from '@/lib/billing/authorization'
import {
  handleSubscriptionCreated,
  handleSubscriptionDeleted,
} from '@/lib/billing/webhooks/subscription'
import { sendPlanWelcomeEmail } from '@/lib/billing'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import {
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleInvoiceFinalized,
} from '@/lib/billing/webhooks/invoices'
import { handleManualEnterpriseSubscription } from '@/lib/billing/webhooks/enterprise'
import { db } from '@sim/db'
import { subscription as subscriptionTable } from '@sim/db/schema'
import { eq, or } from 'drizzle-orm'

const logger = createLogger('LoopsPlugin')

export interface LoopsPluginOptions {
  loopsClient: ReturnType<typeof requireLoopsClient>
  loopsWebhookSecret?: string
  createCustomerOnSignUp?: boolean
  onCustomerCreate?: (data: { loopsCustomerId: string; user: { id: string } }) => Promise<void>
  subscription?: {
    enabled?: boolean
    plans?: Array<{
      name: string
      priceId: string
      limits?: {
        cost?: number
      }
    }>
    authorizeReference?: (data: { user: { id: string }; referenceId: string }) => Promise<boolean>
    getCheckoutSessionParams?: (data: {
      plan: { name: string; priceId: string }
      subscription?: { seats?: number }
    }) => Promise<{
      params?: {
        metadata?: Record<string, string>
        [key: string]: any
      }
    }>
    onSubscriptionComplete?: (data: {
      subscription: {
        id: string
        referenceId: string
        plan: string | null
        status: string
      }
    }) => Promise<void>
    onSubscriptionUpdate?: (data: {
      subscription: {
        id: string
        referenceId: string
        plan: string | null
        status: string
      }
    }) => Promise<void>
    onSubscriptionDeleted?: (data: {
      subscription: {
        id: string
        referenceId: string
        plan: string | null
        status: string
      }
    }) => Promise<void>
  }
  onEvent?: (event: {
    type: string
    id: string
    data: any
  }) => Promise<void>
}

export function loops(options: LoopsPluginOptions) {
  const {
    loopsClient,
    loopsWebhookSecret,
    createCustomerOnSignUp = true,
    onCustomerCreate,
    subscription = {},
    onEvent,
  } = options

  const {
    enabled: subscriptionEnabled = true,
    plans: subscriptionPlans,
    authorizeReference,
    getCheckoutSessionParams,
    onSubscriptionComplete,
    onSubscriptionUpdate,
    onSubscriptionDeleted,
  } = subscription

  return {
    id: 'loops',
    endpoints: {
      // Create checkout session for subscription
      createCheckoutSession: createAuthEndpoint(
        '/loops/checkout-session',
        {
          method: 'POST',
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx)

          if (!session?.user) {
            return ctx.json({ error: 'Unauthorized' }, { status: 401 })
          }

          const { plan, referenceId, seats } = ctx.body as {
            plan: string
            referenceId?: string
            seats?: number
          }

          if (!plan) {
            return ctx.json({ error: 'Plan is required' }, { status: 400 })
          }

          const availablePlans = subscriptionPlans || getPlans()
          const selectedPlan = availablePlans.find((p) => p.name === plan)

          if (!selectedPlan) {
            return ctx.json({ error: 'Invalid plan' }, { status: 400 })
          }

          // Authorize reference if provided
          const refId = referenceId || session.user.id
          if (authorizeReference) {
            const authorized = await authorizeReference({
              user: { id: session.user.id },
              referenceId: refId,
            })

            if (!authorized) {
              return ctx.json({ error: 'Unauthorized to manage this subscription' }, { status: 403 })
            }
          }

          // Get checkout session params
          let checkoutParams: any = {}
          if (getCheckoutSessionParams) {
            const params = await getCheckoutSessionParams({
              plan: selectedPlan,
              subscription: seats ? { seats } : undefined,
            })
            checkoutParams = params.params || {}
          }

          try {
            // Create checkout session with Loops
            // Check Loops SDK documentation for exact parameter names
            const checkoutSession = await loopsClient.checkoutSessions.create({
              paymentLinkId: selectedPlan.priceId, // Using priceId as paymentLinkId
              externalCustomerId: session.user.id,
              metadata: {
                plan: plan,
                referenceId: refId,
                userId: session.user.id,
                ...(seats ? { seats: seats.toString() } : {}),
                ...checkoutParams.metadata,
              } as Record<string, string>,
            } as any)

            return ctx.json({
              url: (checkoutSession as any).url || (checkoutSession as any).checkoutUrl || '',
              sessionId: checkoutSession.id,
            })
          } catch (error: any) {
            logger.error('Failed to create checkout session', { error })
            return ctx.json({ error: 'Failed to create checkout session' }, { status: 500 })
          }
        }
      ),

      // List subscriptions
      listSubscriptions: createAuthEndpoint(
        '/loops/subscriptions',
        {
          method: 'GET',
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx)

          if (!session?.user) {
            return ctx.json({ error: 'Unauthorized' }, { status: 401 })
          }

          try {
            // Get subscriptions from database directly
            // Subscription table uses referenceId which can be userId or organizationId
            const subscriptions = await db
              .select()
              .from(subscriptionTable)
              .where(eq(subscriptionTable.referenceId, session.user.id))

            return ctx.json({ subscriptions })
          } catch (error: any) {
            logger.error('Failed to list subscriptions', { error })
            return ctx.json({ error: 'Failed to list subscriptions' }, { status: 500 })
          }
        }
      ),

      // Webhook endpoint
      webhook: createAuthEndpoint(
        '/loops/webhook',
        {
          method: 'POST',
        },
        async (ctx) => {
          if (!ctx.request) {
            return ctx.json({ error: 'Invalid request' }, { status: 400 })
          }

          // Verify webhook signature if secret is provided
          if (loopsWebhookSecret) {
            const signature = ctx.request.headers.get('x-loops-signature')
            // TODO: Implement signature verification when Loops provides webhook signature details
          }

          const event = (await ctx.request.json()) as {
            type: string
            id: string
            data: any
          }

          logger.info('[webhook] Received Loops webhook', {
            eventId: event.id,
            eventType: event.type,
          })

          try {
            // Call custom event handler if provided
            if (onEvent) {
              await onEvent(event)
            }

            // Handle specific event types
            switch (event.type) {
              case 'checkout.session.completed':
                // Handle completed checkout
                if (onSubscriptionComplete && event.data?.subscription) {
                  await onSubscriptionComplete({
                    subscription: {
                      id: event.data.subscription.id,
                      referenceId: event.data.subscription.metadata?.referenceId || '',
                      plan: event.data.subscription.metadata?.plan || null,
                      status: event.data.subscription.status || 'active',
                    },
                  })
                }
                break
              case 'checkout.session.expired':
                // Handle expired checkout
                break
              default:
                logger.info('[webhook] Ignoring unsupported webhook event', {
                  eventId: event.id,
                  eventType: event.type,
                })
                break
            }

            return ctx.json({ received: true })
          } catch (error: any) {
            logger.error('[webhook] Failed to process webhook', {
              eventId: event.id,
              eventType: event.type,
              error,
            })
            return ctx.json({ error: 'Failed to process webhook' }, { status: 500 })
          }
        }
      ),
    },
  } satisfies BetterAuthPlugin
}

// Note: Customer creation on signup should be handled in the main auth.ts databaseHooks
// This keeps the plugin focused on endpoint handling only

