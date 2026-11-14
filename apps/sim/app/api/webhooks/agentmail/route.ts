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
import { verifyStandardWebhook } from '@sim/security/standard-webhooks'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { tasks } from '@trigger.dev/sdk'
import { and, eq, gt, ne, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import addressparser from 'nodemailer/lib/addressparser'
import { getDomain } from 'tldts'
import {
  agentMailEnvelopeSchema,
  agentMailMessageSchema,
  agentMailRoutingSchema,
  webhookSvixHeadersSchema,
} from '@/lib/api/contracts/webhooks'
import { hasWorkspaceInboxAccess } from '@/lib/billing/core/subscription'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { emailDomain } from '@/lib/messaging/email/disposable'
import { executeInboxTask } from '@/lib/mothership/inbox/executor'
import type { AgentMailWebhookPayload, RejectionReason } from '@/lib/mothership/inbox/types'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'

const logger = createLogger('AgentMailWebhook')

const AUTOMATED_SENDERS = ['mailer-daemon@', 'noreply@', 'no-reply@', 'postmaster@']
const MAX_EMAILS_PER_HOUR = 20

const AGENTMAIL_BODY_LABEL = 'AgentMail webhook body'

/**
 * Bound the unauthenticated AgentMail webhook body before buffering it for
 * signature verification, so an oversized payload cannot exhaust pod memory.
 */
async function readAgentMailBody(req: Request): Promise<string> {
  assertContentLengthWithinLimit(req.headers, WEBHOOK_MAX_BODY_BYTES, AGENTMAIL_BODY_LABEL)
  const buffer = await readStreamToBufferWithLimit(req.body, {
    maxBytes: WEBHOOK_MAX_BODY_BYTES,
    label: AGENTMAIL_BODY_LABEL,
  })
  return new TextDecoder().decode(buffer)
}

export const POST = withRouteHandler(async (req: Request) => {
  const ticket = tryAdmit()
  if (!ticket) {
    return admissionRejectedResponse()
  }

  try {
    let rawBody: string
    try {
      rawBody = await readAgentMailBody(req)
    } catch (bodyError) {
      if (isPayloadSizeLimitError(bodyError)) {
        logger.warn('Rejected oversized AgentMail webhook body', {
          maxBytes: WEBHOOK_MAX_BODY_BYTES,
          observedBytes: bodyError.observedBytes,
        })
        return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
      }
      throw bodyError
    }
    const headersResult = webhookSvixHeadersSchema.safeParse({
      'svix-id': req.headers.get('svix-id'),
      'svix-timestamp': req.headers.get('svix-timestamp'),
      'svix-signature': req.headers.get('svix-signature'),
    })

    if (!headersResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let parsedBody: unknown
    try {
      parsedBody = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    /**
     * Route to one tenant before hashing: verification HMACs the whole body synchronously,
     * so checking every workspace secret would let one unauthenticated request cost
     * a hash per tenant. `inbox_id` is attacker-controlled but only selects which
     * secret to check — verification still binds the payload's inbox to the workspace.
     */
    const routingResult = agentMailRoutingSchema.safeParse(parsedBody)
    if (!routingResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const inboxId = routingResult.data.message.inbox_id

    const [result] = await db
      .select({
        id: workspace.id,
        inboxEnabled: workspace.inboxEnabled,
        inboxAddress: workspace.inboxAddress,
        webhookSecret: mothershipInboxWebhook.secret,
      })
      .from(workspace)
      .innerJoin(mothershipInboxWebhook, eq(mothershipInboxWebhook.workspaceId, workspace.id))
      .where(eq(workspace.inboxProviderId, inboxId))
      .limit(1)

    if (
      !result ||
      !verifyStandardWebhook({
        secret: result.webhookSecret,
        rawBody,
        headers: req.headers,
        headerPrefix: 'svix',
      }).valid
    ) {
      logger.warn('Webhook signature verification failed', { payloadInboxId: inboxId })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const envelopeResult = agentMailEnvelopeSchema.safeParse(parsedBody)
    if (!envelopeResult.success) {
      logger.warn('Invalid AgentMail webhook payload', {
        workspaceId: result.id,
        issues: envelopeResult.error.issues,
      })
      return NextResponse.json(
        { error: 'Invalid envelope payload', details: envelopeResult.error.issues },
        { status: 400 }
      )
    }

    if (envelopeResult.data.event_type !== 'message.received') {
      return NextResponse.json({ ok: true })
    }

    const messageResult = agentMailMessageSchema.safeParse(envelopeResult.data.message)
    if (!messageResult.success) {
      logger.warn('Invalid AgentMail message payload', {
        workspaceId: result.id,
        issues: messageResult.error.issues,
      })
      return NextResponse.json(
        { error: 'Invalid message payload', details: messageResult.error.issues },
        { status: 400 }
      )
    }

    const message: AgentMailWebhookPayload['message'] = messageResult.data

    if (!result.inboxEnabled) {
      logger.info('Inbox disabled, rejecting', { workspaceId: result.id })
      return NextResponse.json({ ok: true })
    }

    const sender = parseSender(message.from)
    const fromEmail = sender.email
    const senderAuthenticated = isSenderAuthenticated(sender, message)
    logger.info('Webhook received', {
      fromEmail,
      from_raw: message.from,
      senderAuthenticated,
      workspaceId: result.id,
    })

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

    // Message ids are sender-controlled and shared with every recipient of a mail,
    // so a task is only ever matched inside the workspace that owns this inbox.
    const [existingResult, isAllowed, recentCount, parentTaskResult, isEntitled] =
      await Promise.all([
        emailMessageId
          ? db
              .select({ id: mothershipInboxTask.id })
              .from(mothershipInboxTask)
              .where(
                and(
                  eq(mothershipInboxTask.workspaceId, result.id),
                  eq(mothershipInboxTask.emailMessageId, emailMessageId)
                )
              )
              .limit(1)
          : Promise.resolve([]),
        isSenderAllowed(fromEmail, senderAuthenticated, result.id),
        getRecentTaskCount(result.id),
        inReplyTo
          ? db
              .select({ chatId: mothershipInboxTask.chatId })
              .from(mothershipInboxTask)
              .where(
                and(
                  eq(mothershipInboxTask.workspaceId, result.id),
                  eq(mothershipInboxTask.responseMessageId, inReplyTo)
                )
              )
              .limit(1)
          : Promise.resolve([]),
        hasWorkspaceInboxAccess(result.id),
      ])

    if (existingResult[0]) {
      logger.info('Duplicate webhook, skipping', { emailMessageId })
      return NextResponse.json({ ok: true })
    }

    if (!isEntitled) {
      logger.info('Inbox no longer entitled, rejecting', { workspaceId: result.id })
      await createRejectedTask(result.id, message, 'not_entitled')
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

    const taskId = generateId()
    const bodyText = message.text?.substring(0, 50_000) || null
    const bodyHtml = message.html?.substring(0, 50_000) || null
    const bodyPreview = (bodyText || '')?.substring(0, 200) || null

    await db.insert(mothershipInboxTask).values({
      id: taskId,
      workspaceId: result.id,
      fromEmail,
      senderAuthenticated,
      fromName: sender.name,
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
            region: await resolveTriggerRegion(),
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
            error: getErrorMessage(err, 'Unknown error'),
          })
        })
      }
    } else {
      logger.info('Trigger.dev not available, executing inbox task locally', { taskId })
      executeInboxTask(taskId).catch((err) => {
        logger.error('Local inbox task execution failed', {
          taskId,
          error: getErrorMessage(err, 'Unknown error'),
        })
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('AgentMail webhook error', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  } finally {
    ticket.release()
  }
})

/**
 * Whether the receiving provider proved the sender controls `fromEmail`'s domain.
 * The From header is written by whoever sends the mail, so a workspace member's
 * address only identifies that member when this holds.
 *
 * AgentMail keeps `spf` only when the envelope domain aligns with the From domain,
 * and `dmarc` is the From domain's own verdict, so a pass on either is trusted as
 * given. `dkim` is kept whoever signed, so it counts only when the signing domain
 * aligns with the From domain the way DMARC's relaxed mode does: one registrable
 * domain. The delivery's own `unauthenticated` label is not enough: AgentMail
 * delivers mail without it when an unaligned envelope SPF passes, which any domain
 * can arrange.
 */
function isSenderAuthenticated(
  sender: ParsedSender,
  message: AgentMailWebhookPayload['message']
): boolean {
  const results = message.authentication_results
  if (!sender.email || !results) return false
  if (results.dmarc === 'pass' || results.spf === 'pass') return true
  if (results.dkim !== 'pass' || !results.dkim_domain) return false

  const fromOrganization = organizationalDomain(emailDomain(sender.email))
  return (
    fromOrganization !== null &&
    fromOrganization === organizationalDomain(emailDomain(results.dkim_domain))
  )
}

/** The registrable domain DMARC aligns on; null for a bare public suffix. */
function organizationalDomain(domain: string): string | null {
  return getDomain(domain, { allowPrivateDomains: true })
}

async function isSenderAllowed(
  email: string,
  senderAuthenticated: boolean,
  workspaceId: string
): Promise<boolean> {
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
    senderAuthenticated
      ? db
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
          .limit(1)
      : [],
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
  const sender = parseSender(message.from)
  await db.insert(mothershipInboxTask).values({
    id: generateId(),
    workspaceId,
    fromEmail: sender.email || 'unknown',
    fromName: sender.name,
    subject: message.subject || '(no subject)',
    bodyPreview: (message.text || '').substring(0, 200) || null,
    emailMessageId: message.message_id,
    agentmailMessageId: message.message_id,
    status: 'rejected',
    rejectionReason: reason,
    hasAttachments: (message.attachments?.length ?? 0) > 0,
  })
}

interface ParsedSender {
  email: string
  name: string | null
}

/**
 * Parse AgentMail's From field (`addr@domain` or `Display Name <addr@domain>`) per
 * RFC 5322, so a display name that itself looks like an address — `"<admin@victim>"
 * <x@attacker>` — is never mistaken for the mailbox. A header naming no mailbox or
 * several yields no address, so no one of them speaks for the message.
 */
function parseSender(from: string): ParsedSender {
  const mailboxes = addressparser(from, { flatten: true })
  if (mailboxes.length !== 1) return { email: '', name: null }
  const [{ address, name }] = mailboxes
  return { email: address.trim().toLowerCase(), name: name || null }
}
