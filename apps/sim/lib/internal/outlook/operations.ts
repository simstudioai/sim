import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  OutlookCopyBody,
  OutlookDeleteBody,
  OutlookDraftBody,
  OutlookMarkReadBody,
  OutlookMarkUnreadBody,
  OutlookMoveBody,
  OutlookSendBody,
} from '@/lib/api/contracts/tools/microsoft'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { OutlookClient, type OutlookJsonObject } from '@/lib/internal/outlook/client'
import { OutlookOperationError } from '@/lib/internal/outlook/errors'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFilesWithinBudget } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('OutlookOperations')
const OUTLOOK_SEND_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024
const OUTLOOK_DRAFT_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024

interface OutlookMailOperationContext {
  requestId: string
  signal?: AbortSignal
  userId?: string
}

interface OutlookRecipient {
  emailAddress: { address: string }
}

interface OutlookFileAttachment {
  '@odata.type': '#microsoft.graph.fileAttachment'
  name: string
  contentType: string
  contentBytes: string
}

interface OutlookMessagePayload {
  subject: string
  body: { contentType: 'text' | 'html'; content: string }
  toRecipients: OutlookRecipient[]
  ccRecipients?: OutlookRecipient[]
  bccRecipients?: OutlookRecipient[]
  attachments?: OutlookFileAttachment[]
}

function optionalString(data: OutlookJsonObject, key: string): string | undefined {
  return typeof data[key] === 'string' ? data[key] : undefined
}

function optionalBoolean(data: OutlookJsonObject, key: string): boolean | undefined {
  return typeof data[key] === 'boolean' ? data[key] : undefined
}

function recipients(value: string): OutlookRecipient[] {
  return value.split(',').map((email) => ({ emailAddress: { address: email.trim() } }))
}

function requireUser(context: OutlookMailOperationContext): string {
  context.signal?.throwIfAborted()
  if (!context.userId) throw new OutlookOperationError('Authentication required', 401)
  return context.userId
}

function attachmentSizeError(observedBytes: number, kind: 'send' | 'draft'): OutlookOperationError {
  const sizeMB = (observedBytes / (1024 * 1024)).toFixed(2)
  const message =
    kind === 'send'
      ? `Total attachment size (${sizeMB}MB) exceeds Microsoft Graph API limit of 3MB per request`
      : `Total attachment size (${sizeMB}MB) exceeds Outlook's limit of 4MB per request`
  return new OutlookOperationError(message, 400)
}

async function resolveAttachments(
  rawAttachments: OutlookSendBody['attachments'] | OutlookDraftBody['attachments'],
  context: OutlookMailOperationContext,
  kind: 'send' | 'draft'
): Promise<OutlookFileAttachment[]> {
  if (!rawAttachments?.length) return []
  const userId = requireUser(context)
  const attachments = processFilesToUserFiles(rawAttachments, context.requestId, logger)
  if (attachments.length === 0) return []
  const maxBytes =
    kind === 'send' ? OUTLOOK_SEND_ATTACHMENT_MAX_BYTES : OUTLOOK_DRAFT_ATTACHMENT_MAX_BYTES
  const declaredSize = attachments.reduce((total, file) => total + file.size, 0)
  if (declaredSize > maxBytes) throw attachmentSizeError(declaredSize, kind)

  for (const file of attachments) {
    context.signal?.throwIfAborted()
    const denied = await assertToolFileAccess(file.key, userId, context.requestId, logger)
    context.signal?.throwIfAborted()
    if (denied) throw new OutlookOperationError('File not found', denied.status)
  }

  let resolved: Awaited<ReturnType<typeof downloadServableFilesWithinBudget>>
  try {
    resolved = await downloadServableFilesWithinBudget(attachments, context.requestId, logger, {
      totalMaxBytes: maxBytes,
      label: 'Total attachment size',
      signal: context.signal,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (isDocNotReadyError(error)) {
      throw new OutlookOperationError(docNotReadyMessage(), 409)
    }
    if (isPayloadSizeLimitError(error)) {
      throw attachmentSizeError(error.observedBytes ?? declaredSize, kind)
    }
    throw new OutlookOperationError(
      `Failed to download attachment: ${getErrorMessage(error, 'Unknown error')}`,
      500
    )
  }
  context.signal?.throwIfAborted()

  return attachments.map((file, index) => {
    const resolvedFile = resolved[index]
    if (!resolvedFile) {
      throw new OutlookOperationError('Failed to download attachment: Missing file data', 500)
    }
    return {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: file.name,
      contentType: resolvedFile.contentType || file.type || 'application/octet-stream',
      contentBytes: resolvedFile.buffer.toString('base64'),
    }
  })
}

async function buildMessage(
  input: OutlookSendBody | OutlookDraftBody,
  context: OutlookMailOperationContext,
  kind: 'send' | 'draft'
): Promise<OutlookMessagePayload> {
  const message: OutlookMessagePayload = {
    subject: input.subject,
    body: { contentType: input.contentType || 'text', content: input.body },
    toRecipients: recipients(input.to),
  }
  if (input.cc) message.ccRecipients = recipients(input.cc)
  if (input.bcc) message.bccRecipients = recipients(input.bcc)
  const attachments = await resolveAttachments(input.attachments, context, kind)
  if (attachments.length > 0) message.attachments = attachments
  return message
}

export async function executeOutlookCopy(input: OutlookCopyBody, signal?: AbortSignal) {
  const client = new OutlookClient(input.accessToken)
  const data = await client.json(
    `/me/messages/${encodeURIComponent(input.messageId)}/copy`,
    { method: 'POST', body: JSON.stringify({ destinationId: input.destinationId }) },
    'Failed to copy email',
    signal
  )
  return {
    success: true as const,
    output: {
      message: 'Email copied successfully',
      originalMessageId: input.messageId,
      copiedMessageId: optionalString(data, 'id'),
      destinationFolderId: optionalString(data, 'parentFolderId'),
    },
  }
}

export async function executeOutlookDelete(input: OutlookDeleteBody, signal?: AbortSignal) {
  const client = new OutlookClient(input.accessToken)
  await client.empty(
    `/me/messages/${encodeURIComponent(input.messageId)}`,
    { method: 'DELETE' },
    'Failed to delete email',
    signal
  )
  return {
    success: true as const,
    output: {
      message: 'Email moved to Deleted Items successfully',
      messageId: input.messageId,
      status: 'deleted',
    },
  }
}

export async function executeOutlookDraft(
  input: OutlookDraftBody,
  context: OutlookMailOperationContext
) {
  requireUser(context)
  const message = await buildMessage(input, context, 'draft')
  const client = new OutlookClient(input.accessToken)
  const data = await client.json(
    '/me/messages',
    { method: 'POST', body: JSON.stringify(message) },
    'Failed to create draft',
    context.signal
  )
  return {
    success: true as const,
    output: {
      message: 'Draft created successfully',
      messageId: optionalString(data, 'id'),
      subject: optionalString(data, 'subject'),
      attachmentCount: message.attachments?.length || 0,
    },
  }
}

async function executeOutlookReadState(
  input: OutlookMarkReadBody | OutlookMarkUnreadBody,
  isRead: boolean,
  signal?: AbortSignal
) {
  const client = new OutlookClient(input.accessToken)
  const fallback = isRead ? 'Failed to mark email as read' : 'Failed to mark email as unread'
  const data = await client.json(
    `/me/messages/${encodeURIComponent(input.messageId)}`,
    { method: 'PATCH', body: JSON.stringify({ isRead }) },
    fallback,
    signal
  )
  return {
    success: true as const,
    output: {
      message: isRead ? 'Email marked as read successfully' : 'Email marked as unread successfully',
      messageId: optionalString(data, 'id'),
      isRead: optionalBoolean(data, 'isRead'),
    },
  }
}

export function executeOutlookMarkRead(input: OutlookMarkReadBody, signal?: AbortSignal) {
  return executeOutlookReadState(input, true, signal)
}

export function executeOutlookMarkUnread(input: OutlookMarkUnreadBody, signal?: AbortSignal) {
  return executeOutlookReadState(input, false, signal)
}

export async function executeOutlookMove(input: OutlookMoveBody, signal?: AbortSignal) {
  const client = new OutlookClient(input.accessToken)
  const data = await client.json(
    `/me/messages/${encodeURIComponent(input.messageId)}/move`,
    { method: 'POST', body: JSON.stringify({ destinationId: input.destinationId }) },
    'Failed to move email',
    signal
  )
  return {
    success: true as const,
    output: {
      message: 'Email moved successfully',
      messageId: optionalString(data, 'id'),
      newFolderId: optionalString(data, 'parentFolderId'),
    },
  }
}

export async function executeOutlookSend(
  input: OutlookSendBody,
  context: OutlookMailOperationContext
) {
  requireUser(context)
  const message = await buildMessage(input, context, 'send')
  const client = new OutlookClient(input.accessToken)
  const replyToMessageId = input.replyToMessageId
  await client.empty(
    replyToMessageId
      ? `/me/messages/${encodeURIComponent(replyToMessageId)}/reply`
      : '/me/sendMail',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        replyToMessageId ? { comment: input.body, message } : { message, saveToSentItems: true }
      ),
    },
    'Failed to send email',
    context.signal
  )
  return {
    success: true as const,
    output: {
      message: 'Email sent successfully',
      status: 'sent',
      timestamp: new Date().toISOString(),
      attachmentCount: message.attachments?.length || 0,
    },
  }
}

export type { OutlookMailOperationContext }
