import type {
  GmailAttachment,
  GmailMessage,
  GmailReadParams,
  GmailToolResponse,
} from '@/tools/gmail/types'

export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

/**
 * Fetch original message headers for threading
 * @param messageId Gmail message ID to fetch headers from
 * @param accessToken Gmail access token
 * @returns Object containing threading headers (messageId, references, subject)
 */
export async function fetchThreadingHeaders(
  messageId: string,
  accessToken: string
): Promise<{
  messageId?: string
  references?: string
  subject?: string
}> {
  try {
    const messageResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${messageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (messageResponse.ok) {
      const messageData = await messageResponse.json()
      const headers = messageData.payload?.headers || []

      return {
        messageId: headers.find((h: any) => h.name.toLowerCase() === 'message-id')?.value,
        references: headers.find((h: any) => h.name.toLowerCase() === 'references')?.value,
        subject: headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value,
      }
    }
  } catch (error) {
    // Continue without threading headers rather than failing
  }

  return {}
}

// Helper function to process a Gmail message
export async function processMessage(
  message: GmailMessage,
  params?: GmailReadParams
): Promise<GmailToolResponse> {
  // Check if message and payload exist
  if (!message || !message.payload) {
    return {
      success: true,
      output: {
        content: 'Unable to process email: Invalid message format',
        metadata: {
          id: message?.id || '',
          threadId: message?.threadId || '',
          labelIds: message?.labelIds || [],
        },
      },
    }
  }

  const headers = message.payload.headers || []
  const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || ''
  const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value || ''
  const to = headers.find((h) => h.name.toLowerCase() === 'to')?.value || ''
  const date = headers.find((h) => h.name.toLowerCase() === 'date')?.value || ''

  // Extract the message body
  const body = extractMessageBody(message.payload)

  // Check for attachments
  const attachmentInfo = extractAttachmentInfo(message.payload)
  const hasAttachments = attachmentInfo.length > 0

  // Download attachments if requested
  let attachments: GmailAttachment[] | undefined
  if (params?.includeAttachments && hasAttachments && params.accessToken) {
    try {
      attachments = await downloadAttachments(message.id, attachmentInfo, params.accessToken)
    } catch (error) {
      // Continue without attachments rather than failing the entire request
    }
  }

  const result: GmailToolResponse = {
    success: true,
    output: {
      content: body || 'No content found in email',
      metadata: {
        id: message.id || '',
        threadId: message.threadId || '',
        labelIds: message.labelIds || [],
        from,
        to,
        subject,
        date,
        hasAttachments,
        attachmentCount: attachmentInfo.length,
      },
      // Always include attachments array (empty if none downloaded)
      attachments: attachments || [],
    },
  }

  return result
}

// Helper function to process a message for summary (without full content)
export function processMessageForSummary(message: GmailMessage): any {
  if (!message || !message.payload) {
    return {
      id: message?.id || '',
      threadId: message?.threadId || '',
      subject: 'Unknown Subject',
      from: 'Unknown Sender',
      to: '',
      date: '',
      snippet: message?.snippet || '',
    }
  }

  const headers = message.payload.headers || []
  const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || 'No Subject'
  const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender'
  const to = headers.find((h) => h.name.toLowerCase() === 'to')?.value || ''
  const date = headers.find((h) => h.name.toLowerCase() === 'date')?.value || ''

  return {
    id: message.id,
    threadId: message.threadId,
    subject,
    from,
    to,
    date,
    snippet: message.snippet || '',
  }
}

// Helper function to recursively extract message body from MIME parts
export function extractMessageBody(payload: any): string {
  // If the payload has a body with data, decode it
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString()
  }

  // If there are no parts, return empty string
  if (!payload.parts || !Array.isArray(payload.parts) || payload.parts.length === 0) {
    return ''
  }

  // First try to find a text/plain part
  const textPart = payload.parts.find((part: any) => part.mimeType === 'text/plain')
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, 'base64').toString()
  }

  // If no text/plain, try to find text/html
  const htmlPart = payload.parts.find((part: any) => part.mimeType === 'text/html')
  if (htmlPart?.body?.data) {
    return Buffer.from(htmlPart.body.data, 'base64').toString()
  }

  // If we have multipart/alternative or other complex types, recursively check parts
  for (const part of payload.parts) {
    if (part.parts) {
      const nestedBody = extractMessageBody(part)
      if (nestedBody) {
        return nestedBody
      }
    }
  }

  // If we couldn't find any text content, return empty string
  return ''
}

// Helper function to extract attachment information from message payload
export function extractAttachmentInfo(
  payload: any
): Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> {
  const attachments: Array<{
    attachmentId: string
    filename: string
    mimeType: string
    size: number
  }> = []

  function processPayloadPart(part: any) {
    // Check if this part has an attachment
    if (part.body?.attachmentId && part.filename) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
      })
    }

    // Recursively process nested parts
    if (part.parts && Array.isArray(part.parts)) {
      part.parts.forEach(processPayloadPart)
    }
  }

  // Process the main payload
  processPayloadPart(payload)

  return attachments
}

// Helper function to download attachments from Gmail API
export async function downloadAttachments(
  messageId: string,
  attachmentInfo: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }>,
  accessToken: string
): Promise<GmailAttachment[]> {
  const downloadedAttachments: GmailAttachment[] = []

  for (const attachment of attachmentInfo) {
    try {
      // Download attachment from Gmail API
      const attachmentResponse = await fetch(
        `${GMAIL_API_BASE}/messages/${messageId}/attachments/${attachment.attachmentId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!attachmentResponse.ok) {
        await attachmentResponse.body?.cancel().catch(() => {})
        continue
      }

      const attachmentData = (await attachmentResponse.json()) as { data: string; size: number }

      // Decode base64url data to buffer
      // Gmail API returns data in base64url format (URL-safe base64)
      const base64Data = attachmentData.data.replace(/-/g, '+').replace(/_/g, '/')
      const buffer = Buffer.from(base64Data, 'base64')

      downloadedAttachments.push({
        name: attachment.filename,
        data: buffer.toString('base64'),
        mimeType: attachment.mimeType,
        size: attachment.size,
      })
    } catch (error) {
      // Continue with other attachments
    }
  }

  return downloadedAttachments
}

// Helper function to create a summary of multiple messages
export function createMessagesSummary(messages: any[]): string {
  if (messages.length === 0) {
    return 'No messages found.'
  }

  let summary = `Found ${messages.length} messages:\n\n`

  messages.forEach((msg, index) => {
    summary += `${index + 1}. Subject: ${msg.subject}\n`
    summary += `   From: ${msg.from}\n`
    summary += `   To: ${msg.to}\n`
    summary += `   Date: ${msg.date}\n`
    summary += `   ID: ${msg.id}\n`
    summary += `   Thread ID: ${msg.threadId}\n`
    summary += `   Preview: ${msg.snippet}\n\n`
  })

  summary += `To read full content of a specific message, use the gmail_read tool with messageId: ${messages.map((m) => m.id).join(', ')}`

  return summary
}

/**
 * Generate a unique MIME boundary string
 */
function generateBoundary(): string {
  return `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
}

/**
 * Encode a header value using RFC 2047 Base64 encoding if it contains non-ASCII characters.
 * This matches Google's own Gmail API sample: `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`
 * @see https://github.com/googleapis/google-api-nodejs-client/blob/main/samples/gmail/send.js
 */
export function encodeRfc2047(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value
  }
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

/**
 * Encode string or buffer to base64url format (URL-safe base64)
 * Gmail API requires base64url encoding for the raw message field
 */
export function base64UrlEncode(data: string | Buffer): string {
  const base64 = Buffer.from(data).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Escape HTML special characters so user-supplied text renders safely inside an HTML body.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Convert a plain-text body to an HTML body that flows naturally in Gmail.
 * Blank lines become paragraph breaks; single newlines become `<br>`.
 * This avoids the narrow hard-wrapped rendering Gmail uses for `text/plain`.
 */
export function plainTextToHtml(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const paragraphs = normalized.split(/\n{2,}/)
  const htmlParagraphs = paragraphs.map((paragraph) => {
    const escaped = escapeHtml(paragraph).replace(/\n/g, '<br>')
    return `<p>${escaped}</p>`
  })
  return `<!DOCTYPE html><html><body>${htmlParagraphs.join('')}</body></html>`
}

/**
 * Best-effort conversion of an HTML body to a plain-text fallback. Strips tags
 * and decodes the common entities. Used so we always include a plain-text part
 * alongside HTML for clients that don't render HTML.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Produce the plain-text and HTML representations of a body so we can emit a
 * `multipart/alternative` section. Gmail renders the HTML version full-width
 * (matching how a manually-composed email looks); the plain-text part is the
 * fallback for clients that don't render HTML.
 */
export function buildBodyAlternatives(
  body: string,
  contentType: 'text' | 'html' | undefined
): { plain: string; html: string } {
  if (contentType === 'html') {
    return { plain: htmlToPlainText(body) || body, html: body }
  }
  return { plain: body, html: plainTextToHtml(body) }
}

/**
 * Encode a text body as base64 with RFC 2045 line wrapping (max 76 chars).
 * Using base64 lets us safely transport arbitrary UTF-8 (emoji, accented
 * characters, etc.) — `7bit` is only valid for strict 7-bit ASCII.
 */
function encodeBodyBase64(content: string): string[] {
  const base64 = Buffer.from(content, 'utf-8').toString('base64')
  return base64.match(/.{1,76}/g) || ['']
}

/**
 * Render the inner part of a `multipart/alternative` section (text/plain
 * followed by text/html, per RFC 2046 — clients pick the last format they
 * understand).
 */
function renderAlternativeParts(plain: string, html: string, boundary: string): string[] {
  return [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    ...encodeBodyBase64(plain),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    ...encodeBodyBase64(html),
    '',
    `--${boundary}--`,
  ]
}

/**
 * Build a `multipart/alternative` email (without attachments). Always emits
 * both text/plain and text/html parts so Gmail renders messages full-width
 * like a hand-composed email.
 * @returns Base64url encoded raw message
 */
export function buildSimpleEmailMessage(params: {
  to: string
  cc?: string | null
  bcc?: string | null
  subject?: string | null
  body: string
  contentType?: 'text' | 'html'
  inReplyTo?: string
  references?: string
}): string {
  const { to, cc, bcc, subject, body, contentType, inReplyTo, references } = params
  const boundary = generateBoundary()
  const { plain, html } = buildBodyAlternatives(body, contentType)

  const emailHeaders = ['MIME-Version: 1.0', `To: ${to}`]

  if (cc) {
    emailHeaders.push(`Cc: ${cc}`)
  }
  if (bcc) {
    emailHeaders.push(`Bcc: ${bcc}`)
  }

  emailHeaders.push(`Subject: ${encodeRfc2047(subject || '')}`)

  if (inReplyTo) {
    emailHeaders.push(`In-Reply-To: ${inReplyTo}`)
    const referencesChain = references ? `${references} ${inReplyTo}` : inReplyTo
    emailHeaders.push(`References: ${referencesChain}`)
  }

  emailHeaders.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
  emailHeaders.push('')
  emailHeaders.push(...renderAlternativeParts(plain, html, boundary))

  const email = emailHeaders.join('\n')
  return Buffer.from(email).toString('base64url')
}

/**
 * Build a MIME multipart message with optional attachments
 * @param params Message parameters including recipients, subject, body, and attachments
 * @returns Complete MIME message string ready to be base64url encoded
 */
export interface BuildMimeMessageParams {
  to: string
  cc?: string
  bcc?: string
  subject?: string
  body: string
  contentType?: 'text' | 'html'
  inReplyTo?: string
  references?: string
  attachments?: Array<{
    filename: string
    mimeType: string
    content: Buffer
  }>
}

export function buildMimeMessage(params: BuildMimeMessageParams): string {
  const { to, cc, bcc, subject, body, contentType, inReplyTo, references, attachments } = params
  const messageParts: string[] = []
  const { plain, html } = buildBodyAlternatives(body, contentType)

  messageParts.push(`To: ${to}`)
  if (cc) {
    messageParts.push(`Cc: ${cc}`)
  }
  if (bcc) {
    messageParts.push(`Bcc: ${bcc}`)
  }
  messageParts.push(`Subject: ${encodeRfc2047(subject || '')}`)

  if (inReplyTo) {
    messageParts.push(`In-Reply-To: ${inReplyTo}`)
  }
  if (references) {
    const referencesChain = inReplyTo ? `${references} ${inReplyTo}` : references
    messageParts.push(`References: ${referencesChain}`)
  } else if (inReplyTo) {
    messageParts.push(`References: ${inReplyTo}`)
  }

  messageParts.push('MIME-Version: 1.0')

  if (attachments && attachments.length > 0) {
    const mixedBoundary = generateBoundary()
    const altBoundary = generateBoundary()

    messageParts.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`)
    messageParts.push('')
    messageParts.push(`--${mixedBoundary}`)
    messageParts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`)
    messageParts.push('')
    messageParts.push(...renderAlternativeParts(plain, html, altBoundary))
    messageParts.push('')

    for (const attachment of attachments) {
      messageParts.push(`--${mixedBoundary}`)
      messageParts.push(`Content-Type: ${attachment.mimeType}`)
      messageParts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`)
      messageParts.push('Content-Transfer-Encoding: base64')
      messageParts.push('')

      const base64Content = attachment.content.toString('base64')
      const lines = base64Content.match(/.{1,76}/g) || []
      messageParts.push(...lines)
      messageParts.push('')
    }

    messageParts.push(`--${mixedBoundary}--`)
  } else {
    const altBoundary = generateBoundary()
    messageParts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`)
    messageParts.push('')
    messageParts.push(...renderAlternativeParts(plain, html, altBoundary))
  }

  return messageParts.join('\n')
}
