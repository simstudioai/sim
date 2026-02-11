import { createLogger } from '@sim/logger'

const logger = createLogger('JiraUtils')

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024

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
      const response = await fetch(att.content, {
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

export async function getJiraCloudId(domain: string, accessToken: string): Promise<string> {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const resources = await response.json()

  if (Array.isArray(resources) && resources.length > 0) {
    const normalizedInput = `https://${domain}`.toLowerCase()
    const matchedResource = resources.find((r) => r.url.toLowerCase() === normalizedInput)

    if (matchedResource) {
      return matchedResource.id
    }
  }

  if (Array.isArray(resources) && resources.length > 0) {
    return resources[0].id
  }

  throw new Error('No Jira resources found')
}
