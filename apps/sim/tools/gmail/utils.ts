import type {
  GmailAttachment,
  GmailMessage,
  GmailReadParams,
  GmailToolResponse,
} from '@/tools/gmail/types'

export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

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
      date: '',
      snippet: message?.snippet || '',
    }
  }

  const headers = message.payload.headers || []
  const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || 'No Subject'
  const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender'
  const date = headers.find((h) => h.name.toLowerCase() === 'date')?.value || ''

  return {
    id: message.id,
    threadId: message.threadId,
    subject,
    from,
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
        continue
      }

      const attachmentData = (await attachmentResponse.json()) as { data: string; size: number }

      // Decode base64url data to buffer
      // Gmail API returns data in base64url format (URL-safe base64)
      const base64Data = attachmentData.data.replace(/-/g, '+').replace(/_/g, '/')
      const buffer = Buffer.from(base64Data, 'base64')

      downloadedAttachments.push({
        name: attachment.filename,
        data: buffer,
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
    summary += `   Date: ${msg.date}\n`
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
 * Encode string or buffer to base64url format (URL-safe base64)
 * Gmail API requires base64url encoding for the raw message field
 */
export function base64UrlEncode(data: string | Buffer): string {
  const base64 = Buffer.from(data).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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
  subject: string
  body: string
  attachments?: Array<{
    filename: string
    mimeType: string
    content: Buffer
  }>
}

export function buildMimeMessage(params: BuildMimeMessageParams): string {
  const { to, cc, bcc, subject, body, attachments } = params
  const boundary = generateBoundary()
  const messageParts: string[] = []

  // Add headers
  messageParts.push(`To: ${to}`)
  if (cc) {
    messageParts.push(`Cc: ${cc}`)
  }
  if (bcc) {
    messageParts.push(`Bcc: ${bcc}`)
  }
  messageParts.push(`Subject: ${subject}`)
  messageParts.push('MIME-Version: 1.0')

  if (attachments && attachments.length > 0) {
    // Multipart message with attachments
    messageParts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    messageParts.push('')
    messageParts.push(`--${boundary}`)
    messageParts.push('Content-Type: text/plain; charset="UTF-8"')
    messageParts.push('Content-Transfer-Encoding: 7bit')
    messageParts.push('')
    messageParts.push(body)
    messageParts.push('')

    // Add each attachment
    for (const attachment of attachments) {
      messageParts.push(`--${boundary}`)
      messageParts.push(`Content-Type: ${attachment.mimeType}`)
      messageParts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`)
      messageParts.push('Content-Transfer-Encoding: base64')
      messageParts.push('')

      // Split base64 content into 76-character lines (MIME standard)
      const base64Content = attachment.content.toString('base64')
      const lines = base64Content.match(/.{1,76}/g) || []
      messageParts.push(...lines)
      messageParts.push('')
    }

    messageParts.push(`--${boundary}--`)
  } else {
    // Simple text message without attachments
    messageParts.push('Content-Type: text/plain; charset="UTF-8"')
    messageParts.push('MIME-Version: 1.0')
    messageParts.push('')
    messageParts.push(body)
  }

  return messageParts.join('\n')
}
