import {
  db,
  mothershipInboxAllowedSender,
  mothershipInboxTask,
  mothershipInboxWebhook,
  permissions,
  user,
  workspace,
} from '@sim/db'
import { createLogger } from '@sim/logger'
import { tasks } from '@trigger.dev/sdk'
import { and, eq, gt, ne, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'
import { generateId } from '@/lib/core/utils/uuid'
import { executeInboxTask } from '@/lib/mothership/inbox/executor'
import type { AgentMailWebhookPayload, RejectionReason } from '@/lib/mothership/inbox/types'

const logger = createLogger('AgentMailWebhook')

const AUTOMATED_SENDERS = ['mailer-daemon@', 'noreply@', 'no-reply@', 'postmaster@']
const MAX_EMAILS_PER_HOUR = 20

export async function POST(req: Request) {
  try {
    const rawBody = await req.text()
    const svixId = req.headers.get('svix-id')
    const svixTimestamp = req.headers.get('svix-timestamp')
    const svixSignature = req.headers.get('svix-signature')

    const payload = JSON.parse(rawBody) as AgentMailWebhookPayload

    if (payload.event_type !== 'message.received') {
      return NextResponse.json({ ok: true })
    }

    const { message } = payload
    const inboxId = message?.inbox_id
    if (!message || !inboxId) {
      return NextResponse.json({ ok: true })
    }

    const [result] = await db
      .select({
        id: workspace.id,
        inboxEnabled: workspace.inboxEnabled,
        inboxAddress: workspace.inboxAddress,
        inboxProviderId: workspace.inboxProviderId,
        webhookSecret: mothershipInboxWebhook.secret,
      })
      .from(workspace)
      .leftJoin(mothershipInboxWebhook, eq(mothershipInboxWebhook.workspaceId, workspace.id))
      .where(eq(workspace.inboxProviderId, inboxId))
      .limit(1)

    if (!result || !result.webhookSecret) {
      if (!result) {
        logger.warn('No workspace found for inbox', { inboxId })
      } else {
        logger.warn('No webhook secret found for workspace', { workspaceId: result.id })
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const wh = new Webhook(result.webhookSecret)
      wh.verify(rawBody, {
        'svix-id': svixId || '',
        'svix-timestamp': svixTimestamp || '',
        'svix-signature': svixSignature || '',
      })
    } catch (verifyErr) {
      logger.warn('Webhook signature verification failed', {
        workspaceId: result.id,
        error: verifyErr instanceof Error ? verifyErr.message : 'Unknown error',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!result.inboxEnabled) {
      logger.info('Inbox disabled, rejecting', { workspaceId: result.id })
      return NextResponse.json({ ok: true })
    }

    const fromEmail = extractSenderEmail(message.from_) || ''
    logger.info('Webhook received', { fromEmail, from_raw: message.from_, workspaceId: result.id })

    if (result.inboxAddress && fromEmail === result.inboxAddress.toLowerCase()) {
      logger.info('Skipping email from inbox itself', { workspaceId: result.id })
      return NextResponse.json({ ok: true })
    }

    if (AUTOMATED_SENDERS.some((prefix) => fromEmail.startsWith(prefix))) {
      await createRejectedTask(result.id, message, 'automated_sender')
      return NextResponse.json({ ok: true })
    }

    const emailMessageId = message.message_id
    const inReplyTo = message.in_reply_to || null

    const [existingResult, isAllowed, recentCount, parentTaskResult] = await Promise.all([
      emailMessageId
        ? db
            .select({ id: mothershipInboxTask.id })
            .from(mothershipInboxTask)
            .where(eq(mothershipInboxTask.emailMessageId, emailMessageId))
            .limit(1)
        : Promise.resolve([]),
      isSenderAllowed(fromEmail, result.id),
      getRecentTaskCount(result.id),
      inReplyTo
        ? db
            .select({ chatId: mothershipInboxTask.chatId })
            .from(mothershipInboxTask)
            .where(eq(mothershipInboxTask.responseMessageId, inReplyTo))
            .limit(1)
        : Promise.resolve([]),
    ])

    if (existingResult[0]) {
      logger.info('Duplicate webhook, skipping', { emailMessageId })
      return NextResponse.json({ ok: true })
    }

    if (!isAllowed) {
      await createRejectedTask(result.id, message, 'sender_not_allowed')
      return NextResponse.json({ ok: true })
    }

    if (recentCount >= MAX_EMAILS_PER_HOUR) {
      await createRejectedTask(result.id, message, 'rate_limit_exceeded')
      return NextResponse.json({ ok: true })
    }

    const chatId = parentTaskResult[0]?.chatId ?? null

    const fromName = extractDisplayName(message.from_)

    const taskId = generateId()
    const bodyText = message.text?.substring(0, 50_000) || null
    const bodyHtml = message.html?.substring(0, 50_000) || null
    const bodyPreview = (bodyText || '')?.substring(0, 200) || null

    await db.insert(mothershipInboxTask).values({
      id: taskId,
      workspaceId: result.id,
      fromEmail,
      fromName,
      subject: message.subject || '(no subject)',
      bodyPreview,
      bodyText,
      bodyHtml,
      emailMessageId,
      inReplyTo,
      agentmailMessageId: message.message_id,
      status: 'received',
      chatId,
      hasAttachments: (message.attachments?.length ?? 0) > 0,
      ccRecipients: message.cc?.length ? JSON.stringify(message.cc) : null,
    })

    if (isTriggerDevEnabled) {
      try {
        const handle = await tasks.trigger(
          'mothership-inbox-execution',
          { taskId },
          {
            tags: [`workspaceId:${result.id}`, `taskId:${taskId}`],
          }
        )
        await db
          .update(mothershipInboxTask)
          .set({ triggerJobId: handle.id })
          .where(eq(mothershipInboxTask.id, taskId))
      } catch (triggerError) {
        logger.warn('Trigger.dev dispatch failed, falling back to local execution', {
          taskId,
          triggerError,
        })
        executeInboxTask(taskId).catch((err) => {
          logger.error('Local inbox task execution failed', {
            taskId,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        })
      }
    } else {
      logger.info('Trigger.dev not available, executing inbox task locally', { taskId })
      executeInboxTask(taskId).catch((err) => {
        logger.error('Local inbox task execution failed', {
          taskId,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('AgentMail webhook error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function isSenderAllowed(email: string, workspaceId: string): Promise<boolean> {
  const [allowedSenderResult, memberResult] = await Promise.all([
    db
      .select({ id: mothershipInboxAllowedSender.id })
      .from(mothershipInboxAllowedSender)
      .where(
        and(
          eq(mothershipInboxAllowedSender.workspaceId, workspaceId),
          eq(mothershipInboxAllowedSender.email, email)
        )
      )
      .limit(1),
    db
      .select({ userId: permissions.userId })
      .from(permissions)
      .innerJoin(user, eq(permissions.userId, user.id))
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId),
          sql`lower(${user.email}) = ${email}`
        )
      )
      .limit(1),
  ])

  return !!(allowedSenderResult[0] || memberResult[0])
}

async function getRecentTaskCount(workspaceId: string): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mothershipInboxTask)
    .where(
      and(
        eq(mothershipInboxTask.workspaceId, workspaceId),
        gt(mothershipInboxTask.createdAt, oneHourAgo),
        ne(mothershipInboxTask.status, 'rejected')
      )
    )
  return result?.count ?? 0
}

async function createRejectedTask(
  workspaceId: string,
  message: AgentMailWebhookPayload['message'],
  reason: RejectionReason
): Promise<void> {
  await db.insert(mothershipInboxTask).values({
    id: generateId(),
    workspaceId,
    fromEmail: extractSenderEmail(message.from_) || 'unknown',
    fromName: extractDisplayName(message.from_),
    subject: message.subject || '(no subject)',
    bodyPreview: (message.text || '').substring(0, 200) || null,
    emailMessageId: message.message_id,
    agentmailMessageId: message.message_id,
    status: 'rejected',
    rejectionReason: reason,
    hasAttachments: (message.attachments?.length ?? 0) > 0,
  })
}

/**
 * Extract the raw email address from AgentMail's from_ field.
 * Format: "username@domain.com" or "Display Name <username@domain.com>"
 */
function extractSenderEmail(from: string): string {
  const openBracket = from.indexOf('<')
  const closeBracket = from.indexOf('>', openBracket + 1)
  if (openBracket !== -1 && closeBracket !== -1) {
    return from
      .substring(openBracket + 1, closeBracket)
      .toLowerCase()
      .trim()
  }
  return from.toLowerCase().trim()
}

function extractDisplayName(from: string): string | null {
  const openBracket = from.indexOf('<')
  if (openBracket <= 0) return null
  const name = from.substring(0, openBracket).trim()
  if (!name) return null
  if (name.startsWith('"') && name.endsWith('"')) {
    return name.slice(1, -1) || null
  }
  return name
}
