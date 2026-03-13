import { timingSafeEqual } from 'crypto'
import {
  db,
  mothershipInboxAllowedSender,
  mothershipInboxTask,
  permissions,
  user,
  workspace,
} from '@sim/db'
import { createLogger } from '@sim/logger'
import { tasks } from '@trigger.dev/sdk'
import { and, eq, gt, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { env } from '@/lib/core/config/env'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'
import { executeInboxTask } from '@/lib/mothership/inbox/executor'
import type { AgentMailWebhookPayload, RejectionReason } from '@/lib/mothership/inbox/types'

const logger = createLogger('AgentMailWebhook')

const AUTOMATED_SENDERS = ['mailer-daemon@', 'noreply@', 'no-reply@', 'postmaster@']
const MAX_EMAILS_PER_HOUR = 20

export async function POST(req: Request) {
  try {
    const webhookSecret = env.AGENTMAIL_WEBHOOK_SECRET
    if (webhookSecret) {
      const authHeader = req.headers.get('authorization') ?? ''
      const expected = `Bearer ${webhookSecret}`
      const authBuf = Buffer.from(authHeader)
      const expectedBuf = Buffer.from(expected)
      if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
        logger.warn('Invalid webhook authorization')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const payload = (await req.json()) as AgentMailWebhookPayload

    if (payload.event_type !== 'message.received') {
      return NextResponse.json({ ok: true })
    }

    const { message } = payload
    const inboxId = message?.inbox_id
    if (!message || !inboxId) {
      return NextResponse.json({ ok: true })
    }

    const [ws] = await db
      .select()
      .from(workspace)
      .where(eq(workspace.inboxProviderId, inboxId))
      .limit(1)

    if (!ws) {
      logger.warn('No workspace found for inbox', { inboxId })
      return NextResponse.json({ ok: true })
    }

    if (!ws.inboxEnabled) {
      logger.info('Inbox disabled, rejecting', { workspaceId: ws.id })
      return NextResponse.json({ ok: true })
    }

    const fromEmail = extractSenderEmail(message.from_) || ''
    logger.info('Webhook received', { fromEmail, from_raw: message.from_, workspaceId: ws.id })

    if (ws.inboxAddress && fromEmail === ws.inboxAddress.toLowerCase()) {
      logger.info('Skipping email from inbox itself', { workspaceId: ws.id })
      return NextResponse.json({ ok: true })
    }

    if (AUTOMATED_SENDERS.some((prefix) => fromEmail.startsWith(prefix))) {
      await createRejectedTask(ws.id, message, 'automated_sender')
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
      isSenderAllowed(fromEmail, ws.id),
      getRecentTaskCount(ws.id),
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
      await createRejectedTask(ws.id, message, 'sender_not_allowed')
      return NextResponse.json({ ok: true })
    }

    if (recentCount >= MAX_EMAILS_PER_HOUR) {
      await createRejectedTask(ws.id, message, 'rate_limit_exceeded')
      return NextResponse.json({ ok: true })
    }

    const chatId = parentTaskResult[0]?.chatId ?? null

    const fromName = extractDisplayName(message.from_)

    const taskId = uuidv4()
    const bodyText = message.text?.substring(0, 50_000) || null
    const bodyHtml = message.html?.substring(0, 50_000) || null
    const bodyPreview = (bodyText || '')?.substring(0, 200) || null

    await db.insert(mothershipInboxTask).values({
      id: taskId,
      workspaceId: ws.id,
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
        const handle = await tasks.trigger('mothership-inbox-execution', { taskId })
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
    return NextResponse.json({ ok: true })
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
          eq(user.email, email)
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
        gt(mothershipInboxTask.createdAt, oneHourAgo)
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
    id: uuidv4(),
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
  const match = from.match(/<([^>]+)>/)
  return (match?.[1] || from).toLowerCase().trim()
}

function extractDisplayName(from: string): string | null {
  const match = from.match(/^(.+?)\s*</)
  return match?.[1]?.trim().replace(/^"|"$/g, '') || null
}
