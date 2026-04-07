import type { AgentMailAttachment, InboxTask } from '@/lib/mothership/inbox/types'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'

const FORWARDED_PATTERNS = [
  /^fwd?:/i,
  /^fw:/i,
  /^forwarded:/i,
  /---------- forwarded message/i,
  /begin forwarded message/i,
]

/**
 * Formats an inbound email into a mothership chat message content string.
 * Handles forwarded emails, CC'd conversations, and attachment metadata.
 */
export function formatEmailAsMessage(
  task: InboxTask,
  attachments: AgentMailAttachment[] = []
): string {
  const parts: string[] = []
  const isForwarded = isForwardedEmail(task.subject, task.bodyText)

  if (isForwarded) {
    parts.push(`**Forwarded email from:** ${task.fromName || task.fromEmail}`)
  }

  if (task.subject && task.subject !== 'Re:' && task.subject !== '(no subject)') {
    const cleanSubject = task.subject.replace(/^(fwd?|fw|re):\s*/gi, '').trim()
    parts.push(`**Subject:** ${cleanSubject}`)
  }

  if (task.ccRecipients) {
    try {
      const cc = JSON.parse(task.ccRecipients) as string[]
      if (cc.length > 0) {
        parts.push(`**CC'd:** ${cc.join(', ')}`)
      }
    } catch {}
  }

  const rawBody = task.bodyText || extractTextFromHtml(task.bodyHtml) || '(empty email body)'
  const hasExistingChat = !!task.chatId
  const body = hasExistingChat ? stripQuotedReply(rawBody) : rawBody
  parts.push(body)

  if (attachments.length > 0) {
    const attachmentList = attachments
      .map((a) => `- ${a.filename} (${a.content_type}, ${formatFileSize(a.size)})`)
      .join('\n')
    parts.push(`**Attachments:**\n${attachmentList}`)
  } else if (task.hasAttachments) {
    parts.push('**Attachments:** (attached files are available for processing)')
  }

  return parts.join('\n\n')
}

/**
 * Strips quoted reply content from email body.
 * Email clients append the prior thread below a marker line like:
 * - "On [date] [person] wrote:"
 * - Lines starting with ">"
 * - Gmail's "---------- Forwarded message ----------"
 *
 * We keep only the new content above the first quote marker.
 */
function stripQuotedReply(text: string): string {
  const lines = text.split('\n')
  const cutIndex = lines.findIndex((line, i) => {
    const trimmed = line.trim()

    if (/^On .+ wrote:\s*$/i.test(trimmed)) return true

    if (trimmed.startsWith('>') && i > 0) {
      const prevTrimmed = lines[i - 1].trim()
      if (prevTrimmed === '' || /^On .+ wrote:\s*$/i.test(prevTrimmed)) return true
    }

    return false
  })

  if (cutIndex < 0) return text
  if (cutIndex === 0) return '(reply with no new content above the quote)'

  return lines.slice(0, cutIndex).join('\n').trim()
}

/**
 * Detects whether an email is a forwarded message based on subject/body patterns.
 */
function isForwardedEmail(subject: string | null, body: string | null): boolean {
  if (subject && FORWARDED_PATTERNS.some((p) => p.test(subject))) return true
  if (body && FORWARDED_PATTERNS.some((p) => p.test(body.substring(0, 500)))) return true
  return false
}

/**
 * Repeatedly applies a regex replacement until the string stabilises.
 * Prevents incomplete sanitization from nested/overlapping patterns
 * like `<scr<script>ipt>`.
 */
export function replaceUntilStable(
  input: string,
  pattern: RegExp,
  replacement: string,
  maxIterations = 100
): string {
  let prev = input
  let next = prev.replace(pattern, replacement)
  let iterations = 0
  while (next !== prev && iterations++ < maxIterations) {
    prev = next
    next = prev.replace(pattern, replacement)
  }
  return next
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

/**
 * Decodes known HTML entities in a single pass to avoid double-unescaping.
 * A two-step decode (e.g. `&amp;` -> `&` then `&lt;` -> `<`) would turn
 * `&amp;lt;` into `<`, which is incorrect.
 */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (match) => HTML_ENTITY_MAP[match] ?? match)
}

/**
 * Basic HTML to text extraction.
 */
function extractTextFromHtml(html: string | null): string | null {
  if (!html) return null

  let text = html

  text = decodeHtmlEntities(text)

  text = replaceUntilStable(text, /<style[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  text = replaceUntilStable(text, /<script[^>]*>[\s\S]*?<\/script\s*>/gi, '')

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')

  text = replaceUntilStable(text, /<[^>]+>/g, '')

  text = text.replace(/\n{3,}/g, '\n\n').trim()

  return text
}
