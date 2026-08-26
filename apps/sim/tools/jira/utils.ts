import { createLogger } from '@sim/logger'
import {
  type AtlassianDiscoveryRetryOptions,
  resolveAtlassianCloudId,
} from '@/lib/atlassian/discovery'
import { fetchWithRetry } from '@/lib/knowledge/documents/utils'

const logger = createLogger('JiraUtils')

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024

/**
 * Converts a value to ADF format. If the value is already an ADF document object,
 * it is returned as-is. If it is a plain string, it is wrapped in a single-paragraph ADF doc.
 */
export function toAdf(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value === 'object') {
    if (value.type === 'doc') {
      return value
    }
    if (value.type && Array.isArray(value.content)) {
      return { type: 'doc', version: 1, content: [value] }
    }
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && parsed.type === 'doc') {
        return parsed
      }
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        parsed.type &&
        Array.isArray(parsed.content)
      ) {
        return { type: 'doc', version: 1, content: [parsed] }
      }
    } catch {
      // Not JSON — treat as plain text below
    }
  }
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
        ],
      },
    ],
  }
}

/**
 * ADF inline node types, per the "Inline nodes" list in Atlassian's Atlassian
 * Document Format structure reference: "The inline nodes include: date, emoji,
 * hardBreak, inlineCard, mention, status, text, mediaInline".
 *
 * Every other node type is block-level (a top-level or child block node) and is
 * separated by a newline so paragraph, list, and table structure survives text
 * extraction. Treating unknown types as block-level is the safe default: it keeps
 * distinct blocks on distinct lines rather than running them together.
 */
const ADF_INLINE_NODE_TYPES = new Set([
  'date',
  'emoji',
  'hardBreak',
  'inlineCard',
  'mention',
  'status',
  'text',
  'mediaInline',
])

function isInlineAdfNode(node: unknown): boolean {
  if (typeof node === 'string') return true
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false
  const { type } = node as { type?: unknown }
  return typeof type === 'string' && ADF_INLINE_NODE_TYPES.has(type)
}

/**
 * Joins extracted sibling nodes: inline siblings are concatenated with no
 * separator (ADF `text` nodes carry their own surrounding whitespace), while any
 * boundary touching a block-level node gets a newline.
 */
function joinAdfNodes(nodes: readonly unknown[]): string {
  let out = ''
  let started = false
  let previousWasBlock = false

  for (const node of nodes) {
    const extracted = extractAdfText(node)
    if (!extracted) continue
    const isBlock = !isInlineAdfNode(node)
    if (started && (isBlock || previousWasBlock)) out += '\n'
    out += String(extracted)
    started = true
    previousWasBlock = isBlock
  }

  return out
}

/**
 * Extracts plain text from Atlassian Document Format (ADF) content.
 * Returns null if content is falsy. Tolerates malformed/partial nodes and never
 * throws — it is called from Jira tools, the Jira connector, and the JSM connector.
 */
export function extractAdfText(content: any): string | null {
  if (!content) return null
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return joinAdfNodes(content)
  if (typeof content !== 'object') return ''

  if (content.type === 'text') return content.text || ''
  if (content.type === 'hardBreak') return '\n'
  if (content.type === 'mention') return content.attrs?.text || ''
  if (content.type === 'emoji') return content.attrs?.shortName || content.attrs?.text || ''
  /** `status`: "attrs.text | Required ✔ | string". */
  if (content.type === 'status') return content.attrs?.text || ''
  /**
   * `date`: "attrs.timestamp | Required ✔ | string". The spec documents neither
   * the units nor the epoch, so the raw value is emitted rather than formatted.
   */
  if (content.type === 'date') {
    const timestamp = content.attrs?.timestamp
    return typeof timestamp === 'string' || typeof timestamp === 'number' ? String(timestamp) : ''
  }
  /**
   * `inlineCard`: "attrs.url | object | A URI". `attrs.data` is only specified as
   * a "JSONLD representation of the link" with no documented field names, so only
   * the URL form is extracted.
   */
  if (content.type === 'inlineCard') {
    return typeof content.attrs?.url === 'string' ? content.attrs.url : ''
  }

  if (content.content) {
    const text = extractAdfText(content.content)
    if (!text) return text ?? ''
    /**
     * `listItem` is a child block node of `bulletList`/`orderedList`; prefixing it
     * renders lists as lists, and indenting its continuation lines keeps nested
     * lists visually nested.
     */
    if (content.type === 'listItem') return `- ${text.replace(/\n/g, '\n  ')}`
    return text
  }

  return ''
}

/**
 * Transforms a raw Jira API user object into a typed user output.
 * Returns null if user data is falsy.
 */
export function transformUser(user: any): {
  accountId: string
  displayName: string
  active: boolean | null
  emailAddress: string | null
  avatarUrl: string | null
  accountType: string | null
  timeZone: string | null
} | null {
  if (!user) return null
  return {
    accountId: user.accountId ?? '',
    displayName: user.displayName ?? '',
    active: user.active ?? null,
    emailAddress: user.emailAddress ?? null,
    avatarUrl: user.avatarUrls?.['48x48'] ?? null,
    accountType: user.accountType ?? null,
    timeZone: user.timeZone ?? null,
  }
}

/**
 * Downloads Jira attachment file content given attachment metadata and an access token.
 * Returns an array of downloaded files with base64-encoded data.
 */
export async function downloadJiraAttachments(
  attachments: Array<{
    content: string
    filename: string
    mimeType: string
    size: number
    id: string
  }>,
  accessToken: string
): Promise<Array<{ name: string; mimeType: string; data: string; size: number }>> {
  const downloaded: Array<{ name: string; mimeType: string; data: string; size: number }> = []

  for (const att of attachments) {
    if (!att.content) continue
    if (att.size > MAX_ATTACHMENT_SIZE) {
      logger.warn(`Skipping attachment ${att.filename} (${att.size} bytes): exceeds size limit`)
      continue
    }
    try {
      const response = await fetchWithRetry(att.content, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: '*/*',
        },
      })

      if (!response.ok) {
        logger.warn(`Failed to download attachment ${att.filename}: HTTP ${response.status}`)
        continue
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      downloaded.push({
        name: att.filename || `attachment-${att.id}`,
        mimeType: att.mimeType || 'application/octet-stream',
        data: buffer.toString('base64'),
        size: buffer.length,
      })
    } catch (error) {
      logger.warn(`Failed to download attachment ${att.filename}:`, error)
    }
  }

  return downloaded
}

/**
 * Normalizes an ISO timestamp into the format Jira's worklog API requires:
 * `YYYY-MM-DDTHH:mm:ss.sss±HHMM` (offset without colon). Accepts trailing `Z`
 * and `±HH:MM` offsets and rewrites them to `±HHMM`. If milliseconds are
 * missing, `.000` is inserted before the offset.
 */
export function normalizeJiraWorklogTimestamp(value: string): string {
  let s = value.trim()
  s = s.replace(/Z$/i, '+0000')
  s = s.replace(/([+-]\d{2}):(\d{2})$/, '$1$2')
  s = s.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{4})$/, '$1.000$2')
  return s
}

/**
 * Resolves the `cloudId` for a Jira site. Memoized per domain by the shared
 * Atlassian resolver, which Confluence and JSM read through as well.
 */
export function getJiraCloudId(
  domain: string,
  accessToken: string,
  retryOptions?: AtlassianDiscoveryRetryOptions
): Promise<string> {
  return resolveAtlassianCloudId({ domain, accessToken, product: 'Jira', retryOptions })
}

/**
 * Parse error messages from Atlassian API responses (Jira, JSM, Confluence).
 * Handles all known error formats: errorMessage, errorMessages[], errors[].title/detail,
 * field-level errors object, and generic message fallback.
 */
export function parseAtlassianErrorMessage(
  status: number,
  statusText: string,
  errorText: string
): string {
  try {
    const errorData = JSON.parse(errorText)
    if (errorData.errorMessage) {
      return errorData.errorMessage
    }
    if (Array.isArray(errorData.errorMessages) && errorData.errorMessages.length > 0) {
      return errorData.errorMessages.join(', ')
    }
    if (Array.isArray(errorData.errors) && errorData.errors.length > 0) {
      const err = errorData.errors[0]
      if (err?.title) {
        return err.detail ? `${err.title}: ${err.detail}` : err.title
      }
    }
    if (errorData.errors && !Array.isArray(errorData.errors)) {
      const fieldErrors = Object.entries(errorData.errors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join(', ')
      if (fieldErrors) return fieldErrors
    }
    if (errorData.message) {
      return errorData.message
    }
  } catch {
    if (errorText) {
      return errorText
    }
  }
  return `${status} ${statusText}`
}
