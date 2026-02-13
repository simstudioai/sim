import { createLogger } from '@sim/logger'

const logger = createLogger('JsmUtils')

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024

/**
 * Shared utilities for Jira Service Management tools
 * Reuses the getJiraCloudId from the Jira integration since JSM uses the same Atlassian Cloud ID
 */
export { getJiraCloudId } from '@/tools/jira/utils'

/**
 * Build the base URL for JSM Service Desk API
 * @param cloudId - The Jira Cloud ID
 * @returns The base URL for the Service Desk API
 */
export function getJsmApiBaseUrl(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/servicedeskapi`
}

/**
 * Build common headers for JSM API requests
 * @param accessToken - The OAuth access token
 * @returns Headers object for API requests
 */
export function getJsmHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-ExperimentalApi': 'opt-in',
  }
}

/**
 * Downloads JSM attachment file content given attachment metadata and an access token.
 * JSM attachments expose download URLs via _links.content in the API response.
 * Returns an array of downloaded files with base64-encoded data.
 */
export async function downloadJsmAttachments(
  attachments: Array<{
    contentUrl: string
    filename: string
    mimeType: string
    size: number
  }>,
  accessToken: string
): Promise<Array<{ name: string; mimeType: string; data: string; size: number }>> {
  const downloaded: Array<{ name: string; mimeType: string; data: string; size: number }> = []

  for (const att of attachments) {
    if (!att.contentUrl) continue
    if (att.size > MAX_ATTACHMENT_SIZE) {
      logger.warn(`Skipping attachment ${att.filename} (${att.size} bytes): exceeds size limit`)
      continue
    }
    try {
      const response = await fetch(att.contentUrl, {
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
        name: att.filename || 'attachment',
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
