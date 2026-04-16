import { createLogger } from '@sim/logger'
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
 * Extracts plain text from Atlassian Document Format (ADF) content.
 * Returns null if content is falsy.
 */
export function extractAdfText(content: any): string | null {
  if (!content) return null
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(extractAdfText).filter(Boolean).join(' ')
  }
  if (content.type === 'text') return content.text || ''
  if (content.content) return extractAdfText(content.content)
  return ''
}

/**
 * Transforms a raw Jira API user object into a typed user output.
 * Returns null if user data is falsy.
 */
export function transformUser(user: any): {
  accountId: string
  displayName: string
  active?: boolean
  emailAddress?: string
  avatarUrl?: string
  accountType?: string
  timeZone?: string
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

function normalizeDomain(domain: string): string {
  return `https://${domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')}`.toLowerCase()
}

export async function getJiraCloudId(domain: string, accessToken: string): Promise<string> {
  const response = await fetchWithRetry(
    'https://api.atlassian.com/oauth/token/accessible-resources',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch Jira accessible resources: ${response.status} - ${errorText}`)
  }

  const resources = await response.json()

  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('No Jira resources found')
  }

  const normalized = normalizeDomain(domain)
  const match = resources.find(
    (r: { url: string }) => r.url.toLowerCase().replace(/\/+$/, '') === normalized
  )

  if (match) {
    return match.id
  }

  if (resources.length === 1) {
    return resources[0].id
  }

  throw new Error(
    `Could not match Jira domain "${domain}" to any accessible resource. ` +
      `Available sites: ${resources.map((r: { url: string }) => r.url).join(', ')}`
  )
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
