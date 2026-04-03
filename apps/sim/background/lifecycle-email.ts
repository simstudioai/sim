import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { getEmailSubject, renderOnboardingFollowupEmail } from '@/components/emails'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getPersonalEmailFrom } from '@/lib/messaging/email/utils'
import { LIFECYCLE_EMAIL_TASK_ID, type LifecycleEmailType } from '@/lib/messaging/lifecycle'

const logger = createLogger('LifecycleEmail')

interface LifecycleEmailParams {
  userId: string
  type: LifecycleEmailType
}

async function sendLifecycleEmail({ userId, type }: LifecycleEmailParams): Promise<void> {
  const [userData] = await db.select().from(user).where(eq(user.id, userId)).limit(1)

  if (!userData?.email) {
    logger.warn('[lifecycle-email] User not found or has no email', { userId, type })
    return
  }

  const subscription = await getHighestPrioritySubscription(userId)
  if (checkEnterprisePlan(subscription)) {
    logger.info('[lifecycle-email] Skipping lifecycle email for enterprise user', { userId, type })
    return
  }

  const { from, replyTo } = getPersonalEmailFrom()

  let html: string

  switch (type) {
    case 'onboarding-followup':
      html = await renderOnboardingFollowupEmail(userData.name || undefined)
      break
    default:
      logger.warn('[lifecycle-email] Unknown lifecycle email type', { type })
      return
  }

  await sendEmail({
    to: userData.email,
    subject: getEmailSubject(type),
    html,
    from,
    replyTo,
    emailType: 'transactional',
  })

  logger.info('[lifecycle-email] Sent lifecycle email', { userId, type })
}

export const lifecycleEmailTask = task({
  id: LIFECYCLE_EMAIL_TASK_ID,
  retry: { maxAttempts: 2 },
  run: async (params: LifecycleEmailParams) => {
    await sendLifecycleEmail(params)
  },
})
