import { toError } from '@sim/utils/errors'
import type nodemailer from 'nodemailer'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import {
  MailAttachmentMaterializationError,
  materializeAuthorizedMailAttachments,
} from '@/lib/internal/mail/attachment-materialization'
import { sendSmtpMessage } from '@/lib/internal/smtp/client'
import { SmtpOperationError } from '@/lib/internal/smtp/errors'
import type { SmtpSendInput } from '@/lib/internal/smtp/schema'
import { getSmtpEhloName } from '@/lib/messaging/email/ehlo'

const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024

export interface SmtpOperationContext {
  requestId: string
  signal?: AbortSignal
  userId: string
}

function sizeError(observedBytes: number): SmtpOperationError {
  const sizeMB = (observedBytes / (1024 * 1024)).toFixed(2)
  return new SmtpOperationError(
    `Total attachment size (${sizeMB}MB) exceeds SMTP limit of 25MB`,
    400
  )
}

function attachmentError(error: MailAttachmentMaterializationError): SmtpOperationError {
  if (error.kind === 'size') {
    return sizeError(error.observedBytes ?? MAX_ATTACHMENT_TOTAL_BYTES)
  }
  return new SmtpOperationError(error.message, error.status, error.body)
}

function hasResponseCode(error: unknown): error is { responseCode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'responseCode' in error &&
    typeof error.responseCode === 'number'
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function smtpError(error: unknown): SmtpOperationError {
  let message = 'Failed to send email via SMTP'
  if (isNodeError(error)) {
    if (error.code === 'EAUTH') {
      message = 'SMTP authentication failed - check username and password'
    } else if (
      error.code === 'ECONNECTION' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT'
    ) {
      message = 'Could not connect to SMTP server - check host and port'
    }
  }
  if (hasResponseCode(error)) {
    if (error.responseCode >= 500) {
      message = 'SMTP server error - please try again later'
    } else if (error.responseCode >= 400) {
      message = 'Email rejected by SMTP server - check recipient addresses'
    }
  }
  return new SmtpOperationError(message, 500)
}

export async function executeSmtpSend(input: SmtpSendInput, context: SmtpOperationContext) {
  context.signal?.throwIfAborted()
  const hostValidation = await validateDatabaseHost(input.smtpHost, 'smtpHost')
  context.signal?.throwIfAborted()
  if (!hostValidation.isValid) {
    throw new SmtpOperationError(hostValidation.error || 'Invalid SMTP host', 400)
  }

  const from = input.fromName ? `"${input.fromName}" <${input.from}>` : input.from
  const contentType = input.contentType || 'text'
  const message: nodemailer.SendMailOptions = {
    from,
    to: input.to,
    subject: input.subject,
    [contentType === 'html' ? 'html' : 'text']: input.body,
  }
  if (input.cc) message.cc = input.cc
  if (input.bcc) message.bcc = input.bcc
  if (input.replyTo) message.replyTo = input.replyTo

  if (input.attachments?.length) {
    try {
      const attachments = await materializeAuthorizedMailAttachments(input.attachments, context, {
        label: 'Total attachment size',
        maxTotalBytes: MAX_ATTACHMENT_TOTAL_BYTES,
        preflightDeclaredSize: true,
      })
      if (attachments.length > 0) {
        message.attachments = attachments.map((file) => ({
          filename: file.name,
          content: file.buffer,
          contentType: file.contentType,
        }))
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      if (error instanceof MailAttachmentMaterializationError) throw attachmentError(error)
      throw error
    }
  }

  try {
    const result = await sendSmtpMessage(
      {
        host: hostValidation.resolvedIP ?? input.smtpHost,
        port: input.smtpPort,
        secure: input.smtpSecure === 'SSL',
        auth: { user: input.smtpUsername, pass: input.smtpPassword },
        name: getSmtpEhloName(),
        tls:
          input.smtpSecure === 'None'
            ? { rejectUnauthorized: false, servername: input.smtpHost }
            : { rejectUnauthorized: true, servername: input.smtpHost },
      },
      message,
      context.signal
    )
    return {
      success: true,
      messageId: result.messageId,
      to: input.to,
      subject: input.subject,
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof SmtpOperationError) throw error
    const normalized = toError(error)
    throw smtpError(normalized)
  }
}
