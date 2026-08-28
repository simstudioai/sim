import { convert } from 'html-to-text'
import { sendResendEmail } from '@/lib/internal/resend/client'
import type { ResendSendInput } from '@/lib/internal/resend/schema'

interface ResendTag {
  name: string
  value: string
}

function tags(value: string): ResendTag[] {
  return value
    .split(',')
    .map((pair) => {
      const trimmed = pair.trim()
      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) return null
      const name = trimmed.substring(0, colonIndex).trim()
      const tagValue = trimmed.substring(colonIndex + 1).trim()
      return name ? { name, value: tagValue || '' } : null
    })
    .filter((tag): tag is ResendTag => tag !== null)
}

export async function executeResendSend(input: ResendSendInput, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const body: Record<string, unknown> = {
    from: input.fromAddress,
    to: input.to,
    subject: input.subject,
  }
  if ((input.contentType || 'text') === 'html') {
    body.html = input.body
    body.text = convert(input.body, { wordwrap: false })
  } else {
    body.text = input.body
  }
  if (input.cc) body.cc = input.cc
  if (input.bcc) body.bcc = input.bcc
  if (input.replyTo) body.reply_to = input.replyTo
  if (input.scheduledAt) body.scheduled_at = input.scheduledAt
  if (input.tags) body.tags = tags(input.tags)

  const data = await sendResendEmail(input.resendApiKey, body, signal)
  return {
    success: true,
    message: 'Email sent successfully via Resend',
    data,
  }
}
