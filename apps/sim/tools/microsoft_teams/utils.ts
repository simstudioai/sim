import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecord, toRecordOrNull } from '@sim/utils/object'
import {
  AttachmentDownloadBudget,
  readAttachmentJson,
  rethrowAttachmentDownloadError,
} from '@/lib/uploads/utils/attachment-download-budget'
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

interface TeamsIdentity {
  id: string | null
  displayName: string | null
}

interface TeamsMessageFrom {
  user: (TeamsIdentity & { userIdentityType: string | null }) | null
  application: (TeamsIdentity & { applicationIdentityType: string | null }) | null
  device: TeamsIdentity | null
}

interface TeamsMessageMentionOutput {
  id: number | null
  mentionText: string | null
  mentioned: Record<string, unknown> | null
}

interface TeamsMessageReactionOutput {
  reactionType: string | null
  displayName: string | null
  createdDateTime: string | null
  userId: string | null
  userDisplayName: string | null
}

/** Documented chatMessage fields beyond id/body/sender name/timestamp. */
export interface TeamsMessageDetails {
  from: TeamsMessageFrom | null
  senderId: string | null
  senderType: 'user' | 'application' | 'device' | null
  replyToId: string | null
  subject: string | null
  summary: string | null
  importance: string | null
  webUrl: string | null
  contentType: string | null
  lastModifiedDateTime: string | null
  lastEditedDateTime: string | null
  deletedDateTime: string | null
  mentions: TeamsMessageMentionOutput[]
  reactions: TeamsMessageReactionOutput[]
}

function toIdentity(value: unknown): TeamsIdentity | null {
  if (!isRecordLike(value)) return null
  return { id: toStringOrNull(value.id), displayName: toStringOrNull(value.displayName) }
}

function toMessageFrom(value: unknown): TeamsMessageFrom | null {
  if (!isRecordLike(value)) return null
  const user = toIdentity(value.user)
  const application = toIdentity(value.application)
  return {
    user: user
      ? { ...user, userIdentityType: toStringOrNull(toRecord(value.user).userIdentityType) }
      : null,
    application: application
      ? {
          ...application,
          applicationIdentityType: toStringOrNull(
            toRecord(value.application).applicationIdentityType
          ),
        }
      : null,
    device: toIdentity(value.device),
  }
}

function senderTypeOf(from: TeamsMessageFrom | null): TeamsMessageDetails['senderType'] {
  if (from?.user) return 'user'
  if (from?.application) return 'application'
  if (from?.device) return 'device'
  return null
}

/** Extract sender identity (user or bot), threading, mentions, reactions, and edit times. */
export function extractMessageDetails(message: unknown): TeamsMessageDetails {
  const data = toRecord(message)
  const from = toMessageFrom(data.from)
  const sender = from?.user ?? from?.application ?? from?.device ?? null
  const mentions = Array.isArray(data.mentions) ? data.mentions : []
  const reactions = Array.isArray(data.reactions) ? data.reactions : []
  return {
    from,
    senderId: sender?.id ?? null,
    senderType: senderTypeOf(from),
    replyToId: toStringOrNull(data.replyToId),
    subject: toStringOrNull(data.subject),
    summary: toStringOrNull(data.summary),
    importance: toStringOrNull(data.importance),
    webUrl: toStringOrNull(data.webUrl),
    contentType: toStringOrNull(toRecord(data.body).contentType),
    lastModifiedDateTime: toStringOrNull(data.lastModifiedDateTime),
    lastEditedDateTime: toStringOrNull(data.lastEditedDateTime),
    deletedDateTime: toStringOrNull(data.deletedDateTime),
    mentions: mentions.filter(isRecordLike).map((mention) => ({
      id: typeof mention.id === 'number' ? mention.id : null,
      mentionText: toStringOrNull(mention.mentionText),
      mentioned: toRecordOrNull(mention.mentioned),
    })),
    reactions: reactions.filter(isRecordLike).map((reaction) => {
      const user = toRecord(toRecord(reaction.user).user)
      return {
        reactionType: toStringOrNull(reaction.reactionType),
        displayName: toStringOrNull(reaction.displayName),
        createdDateTime: toStringOrNull(reaction.createdDateTime),
        userId: toStringOrNull(user.id),
        userDisplayName: toStringOrNull(user.displayName),
      }
    }),
  }
}

/** The `$skiptoken` carried by a Graph `@odata.nextLink`, or null on the last page. */
export function extractNextPageToken(nextLink: unknown): string | null {
  if (typeof nextLink !== 'string' || !nextLink) return null
  try {
    const url = new URL(nextLink)
    if (url.origin !== 'https://graph.microsoft.com') return null
    return url.searchParams.get('$skiptoken') ?? url.searchParams.get('$skipToken')
  } catch {
    return null
  }
}

/** Clamp an optional page size to Graph's documented 1-50 range for message and chat lists. */
export function resolvePageSize(top: unknown): number {
  const parsed = typeof top === 'string' && top.trim() ? Number(top.trim()) : top
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return 50
  return Math.min(50, Math.max(1, Math.floor(parsed)))
}

/** A Graph itemBody, plain text unless HTML is requested. */
export function buildMessageBody(
  content: string,
  contentType?: string
): { contentType: 'text' | 'html'; content: string } {
  return { contentType: contentType === 'html' ? 'html' : 'text', content }
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

/** List hosted-content IDs, then fetch each item's raw bytes; Graph JSON omits contentBytes. */
async function fetchHostedContents(
  path: string,
  accessToken: string,
  budget: AttachmentDownloadBudget
): Promise<ToolFileData[]> {
  const results: ToolFileData[] = []
  try {
    budget.signal?.throwIfAborted()
    const response = await fetch(path, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: budget.signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      budget.signal?.throwIfAborted()
      return results
    }
    const data = await readAttachmentJson<{ value?: Array<{ id?: string }> }>(
      response,
      'Teams hosted-content metadata',
      budget.signal
    )
    for (const item of data.value ?? []) {
      if (!item.id) continue
      budget.signal?.throwIfAborted()
      const content = await fetch(`${path}/${encodeURIComponent(item.id)}/$value`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: budget.signal,
      })
      if (!content.ok) {
        await content.body?.cancel()
        budget.signal?.throwIfAborted()
        continue
      }
      const buffer = await budget.read(content, 'Teams attachments')
      results.push({
        name: `teams-hosted-${item.id}`,
        mimeType: content.headers.get('content-type') || 'application/octet-stream',
        data: buffer,
      })
    }
  } catch (error) {
    rethrowAttachmentDownloadError(error, budget.signal)
    logger.error('Error downloading Teams hosted content:', error)
  }
  return results
}

export async function fetchHostedContentsForChatMessage(params: {
  accessToken: string
  chatId: string
  messageId: string
  budget?: AttachmentDownloadBudget
}): Promise<ToolFileData[]> {
  return fetchHostedContents(
    `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(params.chatId)}/messages/${encodeURIComponent(params.messageId)}/hostedContents`,
    params.accessToken,
    params.budget ?? new AttachmentDownloadBudget()
  )
}

export async function fetchHostedContentsForChannelMessage(params: {
  accessToken: string
  teamId: string
  channelId: string
  messageId: string
  budget?: AttachmentDownloadBudget
}): Promise<ToolFileData[]> {
  return fetchHostedContents(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(params.teamId)}/channels/${encodeURIComponent(params.channelId)}/messages/${encodeURIComponent(params.messageId)}/hostedContents`,
    params.accessToken,
    params.budget ?? new AttachmentDownloadBudget()
  )
}

/** Download a shared SharePoint/OneDrive attachment with the same budget as hosted content. */
async function downloadReferenceAttachment(
  accessToken: string,
  attachment: MicrosoftTeamsAttachment,
  budget: AttachmentDownloadBudget
): Promise<ToolFileData | null> {
  if (attachment.contentType !== 'reference' || !attachment.contentUrl) return null
  try {
    budget.signal?.throwIfAborted()
    const shareId = `u!${Buffer.from(attachment.contentUrl).toString('base64url')}`
    const path = `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`
    const metadataResponse = await fetch(`${path}?$select=name,size,file`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: budget.signal,
    })
    if (!metadataResponse.ok) {
      await metadataResponse.body?.cancel()
      budget.signal?.throwIfAborted()
      return null
    }
    const item = await readAttachmentJson<{
      name?: string
      size?: number
      file?: { mimeType?: string }
    }>(metadataResponse, 'Teams attachment metadata', budget.signal)
    if (item.size !== undefined) budget.assertSize(item.size, 'Teams attachments')
    const content = await fetch(`${path}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: budget.signal,
    })
    if (!content.ok) {
      await content.body?.cancel()
      budget.signal?.throwIfAborted()
      return null
    }
    const buffer = await budget.read(content, 'Teams attachments')
    return {
      name: attachment.name || item.name || 'attachment',
      mimeType:
        item.file?.mimeType || content.headers.get('content-type') || 'application/octet-stream',
      data: buffer,
    }
  } catch (error) {
    rethrowAttachmentDownloadError(error, budget.signal)
    logger.error('Error downloading Teams reference attachment:', error)
    return null
  }
}

export async function downloadAllReferenceAttachments(params: {
  accessToken: string
  attachments: MicrosoftTeamsAttachment[]
  budget?: AttachmentDownloadBudget
}): Promise<ToolFileData[]> {
  const budget = params.budget ?? new AttachmentDownloadBudget()
  const results: ToolFileData[] = []
  for (const attachment of params.attachments) {
    const file = await downloadReferenceAttachment(params.accessToken, attachment, budget)
    if (file) results.push(file)
  }
  return results
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
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/members`,
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
      updatedContent = updatedContent.replaceAll(
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
      updatedContent = updatedContent.replaceAll(
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
