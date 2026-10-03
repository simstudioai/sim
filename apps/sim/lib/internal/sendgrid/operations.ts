import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import {
  MailAttachmentMaterializationError,
  materializeAuthorizedMailAttachments,
} from '@/lib/internal/mail/attachment-materialization'
import { sendSendGridMail } from '@/lib/internal/sendgrid/client'
import { SendGridOperationError } from '@/lib/internal/sendgrid/errors'
import type { SendGridSendInput } from '@/lib/internal/sendgrid/schema'

const MAX_ATTACHMENT_TOTAL_BYTES = 30 * 1024 * 1024

export interface SendGridOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId: string
}

function sizeError(observedBytes: number): SendGridOperationError {
  const sizeMB = (observedBytes / (1024 * 1024)).toFixed(2)
  return new SendGridOperationError(
    `Total attachment size (${sizeMB}MB) exceeds SendGrid's limit of 30MB`,
    400
  )
}

function attachmentError(error: MailAttachmentMaterializationError): SendGridOperationError {
  if (error.kind === 'size') {
    return sizeError(error.observedBytes ?? MAX_ATTACHMENT_TOTAL_BYTES)
  }
  return new SendGridOperationError(error.message, error.status, error.body)
}

export async function executeSendGridSend(
  input: SendGridSendInput,
  context: SendGridOperationContext
) {
  context.signal?.throwIfAborted()
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) {
    throw new SendGridOperationError(provenance.error, provenance.status)
  }

  const personalization: Record<string, unknown> = {
    to: [{ email: input.to, ...(input.toName && { name: input.toName }) }],
  }
  if (input.cc) personalization.cc = [{ email: input.cc }]
  if (input.bcc) personalization.bcc = [{ email: input.bcc }]
  if (input.templateId && input.dynamicTemplateData) {
    personalization.dynamic_template_data =
      typeof input.dynamicTemplateData === 'string'
        ? JSON.parse(input.dynamicTemplateData)
        : input.dynamicTemplateData
  }

  const body: Record<string, unknown> = {
    personalizations: [personalization],
    from: { email: input.from, ...(input.fromName && { name: input.fromName }) },
    subject: input.subject,
  }
  if (input.templateId) {
    body.template_id = input.templateId
  } else {
    body.content = [{ type: input.contentType || 'text/plain', value: input.content }]
  }
  if (input.replyTo) {
    body.reply_to = {
      email: input.replyTo,
      ...(input.replyToName && { name: input.replyToName }),
    }
  }

  if (input.attachments?.length) {
    try {
      const attachments = await materializeAuthorizedMailAttachments(input.attachments, context, {
        label: 'Total attachment size',
        maxTotalBytes: MAX_ATTACHMENT_TOTAL_BYTES,
      })
      if (attachments.length > 0) {
        body.attachments = attachments.map((file) => ({
          content: file.buffer.toString('base64'),
          filename: file.name,
          type: file.contentType,
          disposition: 'attachment',
        }))
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      if (error instanceof MailAttachmentMaterializationError) throw attachmentError(error)
      throw error
    }
  }

  const messageId = await sendSendGridMail(input.apiKey, body, context.signal)
  return {
    success: true,
    output: {
      success: true,
      messageId,
      to: input.to,
      subject: input.subject || '',
    },
  }
}
