import { getBaseUrl } from '@/lib/core/utils/urls'
import type { EmailOptions, EmailType, ProcessedEmailData } from '@/lib/messaging/email/types'
import { generateUnsubscribeToken, isUnsubscribed } from '@/lib/messaging/email/unsubscribe'
import { getFromEmailAddress, hasEmailHeaderControlChars } from '@/lib/messaging/email/utils'

function sanitizeEmailSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ').trim()
}

interface UnsubscribeInjection {
  headers: Record<string, string>
  html?: string
  text?: string
}

function buildUnsubscribeInjection(
  recipientEmail: string,
  emailType: EmailType,
  html?: string,
  text?: string
): UnsubscribeInjection {
  const token = generateUnsubscribeToken(recipientEmail, emailType)
  const baseUrl = getBaseUrl()
  const encodedEmail = encodeURIComponent(recipientEmail)
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${token}&email=${encodedEmail}`

  return {
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    html: html
      ?.replace(/\{\{UNSUBSCRIBE_TOKEN\}\}/g, token)
      .replace(/\{\{UNSUBSCRIBE_EMAIL\}\}/g, encodedEmail),
    text: text
      ?.replace(/\{\{UNSUBSCRIBE_TOKEN\}\}/g, token)
      .replace(/\{\{UNSUBSCRIBE_EMAIL\}\}/g, encodedEmail),
  }
}

function validateAndSanitize(options: EmailOptions): {
  senderEmail: string
  subject: string
  replyTo?: string
} {
  const senderEmail = options.from || getFromEmailAddress()
  const recipients = Array.isArray(options.to) ? options.to : [options.to]

  if (recipients.some(hasEmailHeaderControlChars)) {
    throw new Error('Invalid recipient email header')
  }
  if (hasEmailHeaderControlChars(senderEmail)) {
    throw new Error('Invalid from email header')
  }
  if (options.replyTo && hasEmailHeaderControlChars(options.replyTo)) {
    throw new Error('Invalid reply-to email header')
  }

  const subject = sanitizeEmailSubject(options.subject)
  if (subject.length === 0) {
    throw new Error('Email subject cannot be empty')
  }

  return { senderEmail, subject, replyTo: options.replyTo }
}

export function processEmailData(options: EmailOptions): ProcessedEmailData {
  const { senderEmail, subject, replyTo } = validateAndSanitize(options)
  const {
    to,
    html,
    text,
    emailType = 'transactional',
    includeUnsubscribe = true,
    attachments,
  } = options

  let finalHtml = html
  let finalText = text
  let headers: Record<string, string> = {}

  if (includeUnsubscribe && emailType !== 'transactional') {
    const primaryEmail = Array.isArray(to) ? to[0] : to
    const injection = buildUnsubscribeInjection(primaryEmail, emailType, html, text)
    headers = injection.headers
    finalHtml = injection.html
    finalText = injection.text
  }

  return {
    to,
    subject,
    html: finalHtml,
    text: finalText,
    senderEmail,
    headers,
    attachments,
    replyTo,
  }
}

export async function shouldSkipForUnsubscribe(options: EmailOptions): Promise<boolean> {
  const { emailType = 'transactional', to } = options
  if (emailType === 'transactional') return false
  const primaryEmail = Array.isArray(to) ? to[0] : to
  return isUnsubscribed(primaryEmail, emailType)
}
