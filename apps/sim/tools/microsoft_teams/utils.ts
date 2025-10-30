import { createLogger } from '@/lib/logs/console/logger'
import type { MicrosoftTeamsAttachment } from '@/tools/microsoft_teams/types'
import type { ToolFileData } from '@/tools/types'

const logger = createLogger('MicrosoftTeamsUtils')

interface ParsedMention {
  name: string
  fullTag: string
  mentionId: number
}

interface TeamMember {
  id: string
  displayName: string
  userIdentityType?: string
}

export interface TeamsMention {
  id: number
  mentionText: string
  mentioned:
    | {
        user: {
          id: string
          displayName: string
          userIdentityType?: string
        }
      }
    | {
        application: {
          displayName: string
          id: string
          applicationIdentityType: 'bot'
        }
      }
}

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
      const contentType: string =
        typeof item.contentType === 'string' ? item.contentType : 'application/octet-stream'
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
      const contentType: string =
        typeof item.contentType === 'string' ? item.contentType : 'application/octet-stream'
      const name: string = item.id ? `teams-hosted-${item.id}` : 'teams-hosted-content'
      results.push({ name, mimeType: contentType, data: base64 })
    }
    return results
  } catch (error) {
    logger.error('Error fetching/uploading hostedContents for channel message:', error)
    return []
  }
}

function parseMentions(content: string): ParsedMention[] {
  const mentions: ParsedMention[] = []
  const mentionRegex = /<at>([^<]+)<\/at>/gi
  let match: RegExpExecArray | null
  let mentionId = 0

  while ((match = mentionRegex.exec(content)) !== null) {
    const name = match[1].trim()
    if (name) {
      mentions.push({
        name,
        fullTag: match[0],
        mentionId: mentionId++,
      })
    }
  }

  return mentions
}

async function fetchChatMembers(chatId: string, accessToken: string): Promise<TeamMember[]> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/members`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    return []
  }

  const data = await response.json()
  return (data.value || []).map((member: TeamMember) => ({
    id: member.id,
    displayName: member.displayName || '',
    userIdentityType: member.userIdentityType,
  }))
}

async function fetchChannelMembers(
  teamId: string,
  channelId: string,
  accessToken: string
): Promise<TeamMember[]> {
  // Channel members endpoint requires ChannelMember.Read.All which may not be available
  // Instead, fetch team members which works with the standard Teams permissions
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/members`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    logger.error('Failed to fetch team members:', {
      status: response.status,
      statusText: response.statusText,
    })
    return []
  }

  const data = await response.json()
  const members = (data.value || []).map((member: TeamMember) => ({
    id: member.id,
    displayName: member.displayName || '',
    userIdentityType: member.userIdentityType,
  }))

  logger.info('Fetched team members for channel:', {
    count: members.length,
    members: members.map((m: TeamMember) => ({
      displayName: m.displayName,
      userIdentityType: m.userIdentityType,
    })),
  })

  return members
}

function findMemberByName(members: TeamMember[], name: string): TeamMember | undefined {
  const normalizedName = name.trim().toLowerCase()
  return members.find((member) => member.displayName.toLowerCase() === normalizedName)
}

export async function resolveMentionsForChat(
  content: string,
  chatId: string,
  accessToken: string
): Promise<{ mentions: TeamsMention[]; hasMentions: boolean; updatedContent: string }> {
  const parsedMentions = parseMentions(content)

  if (parsedMentions.length === 0) {
    return { mentions: [], hasMentions: false, updatedContent: content }
  }

  const members = await fetchChatMembers(chatId, accessToken)
  const mentions: TeamsMention[] = []
  const resolvedTags = new Set<string>()
  let updatedContent = content

  for (const mention of parsedMentions) {
    if (resolvedTags.has(mention.fullTag)) {
      continue
    }

    const member = findMemberByName(members, mention.name)

    if (member) {
      const isBot = member.userIdentityType === 'bot'

      if (isBot) {
        mentions.push({
          id: mention.mentionId,
          mentionText: mention.name,
          mentioned: {
            application: {
              displayName: member.displayName,
              id: member.id,
              applicationIdentityType: 'bot',
            },
          },
        })
      } else {
        mentions.push({
          id: mention.mentionId,
          mentionText: mention.name,
          mentioned: {
            user: {
              id: member.id,
              displayName: member.displayName,
              userIdentityType: member.userIdentityType || 'aadUser',
            },
          },
        })
      }
      resolvedTags.add(mention.fullTag)
      updatedContent = updatedContent.replace(
        mention.fullTag,
        `<at id="${mention.mentionId}">${mention.name}</at>`
      )
    }
  }

  return {
    mentions,
    hasMentions: mentions.length > 0,
    updatedContent,
  }
}

export async function resolveMentionsForChannel(
  content: string,
  teamId: string,
  channelId: string,
  accessToken: string
): Promise<{ mentions: TeamsMention[]; hasMentions: boolean; updatedContent: string }> {
  const parsedMentions = parseMentions(content)

  logger.info('Resolving mentions for channel:', {
    parsedMentionsCount: parsedMentions.length,
    parsedMentions: parsedMentions.map((m: ParsedMention) => m.name),
  })

  if (parsedMentions.length === 0) {
    return { mentions: [], hasMentions: false, updatedContent: content }
  }

  const members = await fetchChannelMembers(teamId, channelId, accessToken)
  const mentions: TeamsMention[] = []
  const resolvedTags = new Set<string>()
  let updatedContent = content

  for (const mention of parsedMentions) {
    if (resolvedTags.has(mention.fullTag)) {
      continue
    }

    const member = findMemberByName(members, mention.name)

    logger.info('Attempting to resolve mention:', {
      mentionName: mention.name,
      foundMember: member
        ? { displayName: member.displayName, userIdentityType: member.userIdentityType }
        : null,
    })

    if (member) {
      const isBot = member.userIdentityType === 'bot'

      if (isBot) {
        mentions.push({
          id: mention.mentionId,
          mentionText: mention.name,
          mentioned: {
            application: {
              displayName: member.displayName,
              id: member.id,
              applicationIdentityType: 'bot',
            },
          },
        })
      } else {
        mentions.push({
          id: mention.mentionId,
          mentionText: mention.name,
          mentioned: {
            user: {
              id: member.id,
              displayName: member.displayName,
              userIdentityType: member.userIdentityType || 'aadUser',
            },
          },
        })
      }
      resolvedTags.add(mention.fullTag)
      updatedContent = updatedContent.replace(
        mention.fullTag,
        `<at id="${mention.mentionId}">${mention.name}</at>`
      )
    } else {
      logger.warn('Could not find member for mention:', {
        mentionName: mention.name,
        availableMembers: members.map((m: TeamMember) => m.displayName),
      })
    }
  }

  logger.info('Resolved mentions for channel:', {
    resolvedCount: mentions.length,
    updatedContent,
  })

  return {
    mentions,
    hasMentions: mentions.length > 0,
    updatedContent,
  }
}
