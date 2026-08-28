import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  GmailDraftBody,
  GmailEditDraftBody,
  GmailSendBody,
} from '@/lib/api/contracts/tools/google'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { asObject, GmailClient } from '@/lib/internal/gmail/client'
import { GmailOperationError } from '@/lib/internal/gmail/errors'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFilesWithinBudget } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { base64UrlEncode, buildMimeMessage, buildSimpleEmailMessage } from '@/tools/gmail/utils'

const logger = createLogger('GmailMailOperations')
const GMAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

export interface GmailMailOperationContext {
  requestId: string
  signal?: AbortSignal
  userId?: string
}

type MailInput = GmailDraftBody | GmailEditDraftBody | GmailSendBody

function attachmentSizeError(observedBytes: number): GmailOperationError {
  const sizeMB = (observedBytes / (1024 * 1024)).toFixed(2)
  return new GmailOperationError(
    `Total attachment size (${sizeMB}MB) exceeds Gmail's limit of 25MB`,
    400,
    {
      success: false,
      error: `Total attachment size (${sizeMB}MB) exceeds Gmail's limit of 25MB`,
    }
  )
}

async function buildRawMessage(
  input: MailInput,
  context: GmailMailOperationContext,
  client: GmailClient
): Promise<string> {
  const { requestId, signal, userId } = context
  const threading = input.replyToMessageId
    ? await client.threadingHeaders(input.replyToMessageId, signal)
    : {}
  signal?.throwIfAborted()
  let rawMessage: string | undefined

  if (input.attachments?.length) {
    const attachments = processFilesToUserFiles(input.attachments, requestId, logger)
    if (attachments.length > 0) {
      const declaredSize = attachments.reduce((total, file) => total + file.size, 0)
      if (declaredSize > GMAIL_ATTACHMENT_MAX_BYTES) throw attachmentSizeError(declaredSize)
      if (!userId) {
        throw new GmailOperationError('Authentication required', 401, {
          success: false,
          error: 'Authentication required',
        })
      }
      for (const file of attachments) {
        signal?.throwIfAborted()
        const denied = await assertToolFileAccess(file.key, userId, requestId, logger)
        if (denied) {
          throw new GmailOperationError('File not found', denied.status, {
            success: false,
            error: 'File not found',
          })
        }
      }

      let resolved: Awaited<ReturnType<typeof downloadServableFilesWithinBudget>>
      try {
        resolved = await downloadServableFilesWithinBudget(attachments, requestId, logger, {
          totalMaxBytes: GMAIL_ATTACHMENT_MAX_BYTES,
          label: 'Total attachment size',
          signal,
        })
      } catch (error) {
        signal?.throwIfAborted()
        if (isDocNotReadyError(error)) {
          throw new GmailOperationError(docNotReadyMessage(), 409, {
            success: false,
            error: docNotReadyMessage(),
          })
        }
        if (isPayloadSizeLimitError(error)) {
          throw attachmentSizeError(error.observedBytes ?? declaredSize)
        }
        const message = `Failed to download attachment: ${getErrorMessage(error, 'Unknown error')}`
        throw new GmailOperationError(message, 500, { success: false, error: message })
      }

      const attachmentBuffers = attachments.map((file, index) => {
        const resolvedFile = resolved[index]
        if (!resolvedFile) {
          throw new GmailOperationError('Failed to download attachment: Missing file data', 500, {
            success: false,
            error: 'Failed to download attachment: Missing file data',
          })
        }
        return {
          filename: file.name,
          mimeType: resolvedFile.contentType || file.type || 'application/octet-stream',
          content: resolvedFile.buffer,
        }
      })
      const mimeMessage = buildMimeMessage({
        to: input.to,
        cc: input.cc ?? undefined,
        bcc: input.bcc ?? undefined,
        subject: input.subject || threading.subject || '',
        body: input.body,
        contentType: input.contentType || 'text',
        inReplyTo: threading.messageId,
        references: threading.references,
        attachments: attachmentBuffers,
      })
      rawMessage = base64UrlEncode(mimeMessage)
    }
  }

  return (
    rawMessage ||
    buildSimpleEmailMessage({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject || threading.subject,
      body: input.body,
      contentType: input.contentType || 'text',
      inReplyTo: threading.messageId,
      references: threading.references,
    })
  )
}

function requireUser(context: GmailMailOperationContext): void {
  context.signal?.throwIfAborted()
  if (!context.userId) {
    throw new GmailOperationError('Authentication required', 401, {
      success: false,
      error: 'Authentication required',
    })
  }
}

export async function executeGmailSend(input: GmailSendBody, context: GmailMailOperationContext) {
  requireUser(context)
  const client = new GmailClient(input.accessToken)
  const raw = await buildRawMessage(input, context, client)
  const requestBody: { raw: string; threadId?: string } = { raw }
  if (input.threadId) requestBody.threadId = input.threadId
  const data = await client.json(
    client.api('/messages/send'),
    { method: 'POST', body: JSON.stringify(requestBody) },
    context.signal
  )
  return {
    success: true,
    output: {
      content: 'Email sent successfully',
      metadata: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
    },
  }
}

export async function executeGmailDraft(input: GmailDraftBody, context: GmailMailOperationContext) {
  requireUser(context)
  const client = new GmailClient(input.accessToken)
  const raw = await buildRawMessage(input, context, client)
  const message: { raw: string; threadId?: string } = { raw }
  if (input.threadId) message.threadId = input.threadId
  const data = await client.json(
    client.api('/drafts'),
    { method: 'POST', body: JSON.stringify({ message }) },
    context.signal
  )
  const draftMessage = asObject(data.message)
  return {
    success: true,
    output: {
      content: 'Email drafted successfully',
      metadata: {
        id: data.id,
        message: {
          id: draftMessage.id,
          threadId: draftMessage.threadId,
          labelIds: draftMessage.labelIds,
        },
      },
    },
  }
}

export async function executeGmailEditDraft(
  input: GmailEditDraftBody,
  context: GmailMailOperationContext
) {
  requireUser(context)
  const client = new GmailClient(input.accessToken)
  const raw = await buildRawMessage(input, context, client)
  const message: { raw: string; threadId?: string } = { raw }
  if (input.threadId) message.threadId = input.threadId
  const data = await client.json(
    client.api(`/drafts/${encodeURIComponent(input.draftId)}`),
    { method: 'PUT', body: JSON.stringify({ id: input.draftId, message }) },
    context.signal
  )
  const draftMessage = asObject(data.message)
  return {
    success: true,
    output: {
      draftId: data.id ?? null,
      messageId: draftMessage.id ?? null,
      threadId: draftMessage.threadId ?? null,
      labelIds: draftMessage.labelIds ?? null,
    },
  }
}
