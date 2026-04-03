import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getEmailSubject, renderAbandonedCheckoutEmail } from '@/components/emails'
import { isProPlan } from '@/lib/billing/core/subscription'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getPersonalEmailFrom } from '@/lib/messaging/email/utils'

const logger = createLogger('CheckoutWebhooks')

/**
 * Handles checkout.session.expired — fires when a user starts an upgrade but doesn't complete it.
 * Sends a plain personal email to check in and offer help.
 * Only fires for subscription-mode sessions to avoid misfires on credit purchase or setup sessions.
 * Skips users who have already completed a subscription (session may expire after a successful upgrade).
 */
export async function handleAbandonedCheckout(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session

  if (session.mode !== 'subscription') return

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  if (!customerId) {
    logger.warn('No customer ID on expired session', { sessionId: session.id })
    return
  }

  const [userData] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.stripeCustomerId, customerId))
    .limit(1)

  if (!userData?.email) {
    logger.warn('No user found for Stripe customer', { customerId, sessionId: session.id })
    return
  }

  // Skip if the user already has a paid plan (direct or via org) — covers session expiring after a successful upgrade
  const alreadySubscribed = await isProPlan(userData.id)
  if (alreadySubscribed) return

  const { from, replyTo } = getPersonalEmailFrom()
  const html = await renderAbandonedCheckoutEmail(userData.name || undefined)

  await sendEmail({
    to: userData.email,
    subject: getEmailSubject('abandoned-checkout'),
    html,
    from,
    replyTo,
    emailType: 'notifications',
  })

  logger.info('Sent abandoned checkout email', { userId: userData.id, sessionId: session.id })
}
