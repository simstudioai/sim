import { createLogger } from '@/lib/logs/console/logger'
import type { MicrosoftTeamsAttachment } from '@/tools/microsoft_teams/types'
import type { ToolFileData } from '@/tools/types'

const logger = createLogger('MicrosoftTeamsUtils')

/**
 * Transform raw attachment data from Microsoft Graph API
 */
function transformAttachment(rawAttachment: any): MicrosoftTeamsAttachment {
  return {
    id: rawAttachment.id,
    contentType: rawAttachment.contentType,
    contentUrl: rawAttachment.contentUrl,
    content: rawAttachment.content,
    name: rawAttachment.name,
    thumbnailUrl: rawAttachment.thumbnailUrl,
    size: rawAttachment.size,
    sourceUrl: rawAttachment.sourceUrl,
    providerType: rawAttachment.providerType,
    item: rawAttachment.item,
  }
}

/**
 * Extract attachments from message data
 * Returns all attachments without any content processing
 */
export function extractMessageAttachments(message: any): MicrosoftTeamsAttachment[] {
  const attachments = (message.attachments || []).map(transformAttachment)

  return attachments
}

/**
 * Fetch hostedContents for a chat message, upload each item to storage, and return uploaded file infos.
 * Hosted contents expose base64 contentBytes via Microsoft Graph.
 */
export async function fetchHostedContentsForChatMessage(params: {
  accessToken: string
  chatId: string
  messageId: string
}): Promise<ToolFileData[]> {
  const { accessToken, chatId, messageId } = params
  try {
    const url = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/hostedContents`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      return []
    }
    const data = await res.json()
    const items = Array.isArray(data.value) ? data.value : []
    const results: ToolFileData[] = []
    for (const item of items) {
      const base64: string | undefined = item.contentBytes
      if (!base64) continue
      const contentType: string = typeof item.contentType === 'string' ? item.contentType : 'application/octet-stream'
      const name: string = item.id ? `teams-hosted-${item.id}` : 'teams-hosted-content'
      results.push({ name, mimeType: contentType, data: base64 })
    }
    return results
  } catch (error) {
    logger.error('Error fetching/uploading hostedContents for chat message:', error)
    return []
  }
}

/**
 * Fetch hostedContents for a channel message, upload each item to storage, and return uploaded file infos.
 */
export async function fetchHostedContentsForChannelMessage(params: {
  accessToken: string
  teamId: string
  channelId: string
  messageId: string
}): Promise<ToolFileData[]> {
  const { accessToken, teamId, channelId, messageId } = params
  try {
    const url = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/hostedContents`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      return []
    }
    const data = await res.json()
    const items = Array.isArray(data.value) ? data.value : []
    const results: ToolFileData[] = []
    for (const item of items) {
      const base64: string | undefined = item.contentBytes
      if (!base64) continue
      const contentType: string = typeof item.contentType === 'string' ? item.contentType : 'application/octet-stream'
      const name: string = item.id ? `teams-hosted-${item.id}` : 'teams-hosted-content'
      results.push({ name, mimeType: contentType, data: base64 })
    }
    return results
  } catch (error) {
    logger.error('Error fetching/uploading hostedContents for channel message:', error)
    return []
  }
}
