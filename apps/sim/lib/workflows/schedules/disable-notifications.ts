import { db } from '@sim/db'
import { user, workflow, workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getEmailSubject, renderScheduleDisabledEmail } from '@/components/emails'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import type { ScheduleDisableReason } from '@/lib/workflows/schedules/disable-reasons'
import { getUsersWithPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ScheduleDisableNotifications')

/**
 * Fan-out cap so one tick over a large workspace can't turn into hundreds of
 * inline sends. The schedule's creator is always kept.
 */
const MAX_SCHEDULE_DISABLE_RECIPIENTS = 20

interface Recipient {
  email: string
  name: string | null
}

/**
 * Emails the schedule's creator and the workspace admins after Sim turns a
 * schedule off on its own.
 *
 * Best-effort by contract: this never throws, because a mail failure must not
 * fault the schedule tick that called it.
 */
export async function notifyScheduleAutoDisabled(params: {
  scheduleId: string
  reason: ScheduleDisableReason
  requestId?: string
}): Promise<void> {
  const { scheduleId, reason, requestId } = params

  try {
    const rows = await db
      .select({
        failedCount: workflowSchedule.failedCount,
        workflowId: workflowSchedule.workflowId,
        workflowName: workflow.name,
        workflowUserId: workflow.userId,
        workflowWorkspaceId: workflow.workspaceId,
      })
      .from(workflowSchedule)
      .leftJoin(workflow, eq(workflow.id, workflowSchedule.workflowId))
      .where(eq(workflowSchedule.id, scheduleId))
      .limit(1)

    const row = rows[0]
    if (!row) {
      logger.warn('Schedule auto-disabled but the row could not be read', { scheduleId, reason })
      return
    }

    const ownerUserId = row.workflowUserId
    const workspaceId = row.workflowWorkspaceId
    const resourceName = row.workflowName ?? undefined

    const recipients = await resolveRecipients(ownerUserId, workspaceId)
    if (recipients.length === 0) {
      logger.warn('Schedule auto-disabled but no recipients could be resolved', {
        scheduleId,
        reason,
        workspaceId,
      })
      return
    }

    const manageLink = buildManageLink(workspaceId, row.workflowId)
    const subject = getEmailSubject('schedule-disabled')

    for (const recipient of recipients) {
      try {
        const html = await renderScheduleDisabledEmail({
          recipientName: recipient.name ?? undefined,
          resourceName,
          reason,
          failedCount: row.failedCount,
          manageLink,
        })

        await sendEmail({
          to: recipient.email,
          subject,
          html,
          emailType: 'notifications',
        })
      } catch (error) {
        logger.error('Failed to send schedule-disabled email', error, {
          scheduleId,
          requestId,
        })
      }
    }

    logger.info('Sent schedule-disabled notification', {
      scheduleId,
      reason,
      recipientCount: recipients.length,
      requestId,
    })
  } catch (error) {
    logger.error('Failed to notify schedule auto-disable', error, { scheduleId, reason, requestId })
  }
}

/**
 * Creator first, then workspace admins. Deduped on lowercased email so someone
 * who is both only receives one message.
 *
 * The two lookups are independent and each failure is contained: losing one
 * must not zero out the other, or a blip in either turns an auto-disable back
 * into the silent event this notification exists to prevent.
 */
async function resolveRecipients(
  ownerUserId: string | null,
  workspaceId: string | null
): Promise<Recipient[]> {
  const recipients: Recipient[] = []
  const seen = new Set<string>()

  const add = (email: string | null, name: string | null) => {
    if (!email) return
    const key = email.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    recipients.push({ email, name })
  }

  if (ownerUserId) {
    try {
      const ownerRows = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, ownerUserId))
        .limit(1)
      add(ownerRows[0]?.email ?? null, ownerRows[0]?.name ?? null)
    } catch (error) {
      logger.error('Failed to resolve schedule creator for disable email', error, { ownerUserId })
    }
  }

  if (workspaceId) {
    try {
      const members = await getUsersWithPermissions(workspaceId)
      for (const member of members) {
        if (member.permissionType !== 'admin') continue
        add(member.email, member.name)
      }
    } catch (error) {
      logger.error('Failed to resolve workspace admins for disable email', error, { workspaceId })
    }
  }

  return recipients.slice(0, MAX_SCHEDULE_DISABLE_RECIPIENTS)
}

function buildManageLink(
  workspaceId: string | null,
  workflowId: string | null
): string | undefined {
  if (!workspaceId || !workflowId) return undefined
  return `${getBaseUrl()}/workspace/${workspaceId}/w/${workflowId}`
}
