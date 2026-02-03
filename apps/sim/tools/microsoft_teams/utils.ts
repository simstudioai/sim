import type { Logger } from '@sim/logger'
import { createLogger } from '@sim/logger'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'
import type {
  GraphApiErrorResponse,
  GraphDriveItem,
  MicrosoftTeamsAttachment,
} from '@/tools/microsoft_teams/types'
import type { ToolFileData } from '@/tools/types'

const logger = createLogger('MicrosoftTeamsUtils')

/** Maximum file size for Teams direct upload (4MB) */
const MAX_TEAMS_FILE_SIZE = 4 * 1024 * 1024

/** Output format for uploaded files */
export interface TeamsFileOutput {
  name: string
  mimeType: string
  data: string
  size: number
}

/** Attachment reference for Teams message */
export interface TeamsAttachmentRef {
  id: string
  contentType: 'reference'
  contentUrl: string
  name: string
}

/** Result from processing and uploading files for Teams */
export interface TeamsFileUploadResult {
  attachments: TeamsAttachmentRef[]
  filesOutput: TeamsFileOutput[]
}

/**
 * Process and upload files to OneDrive for Teams message attachments.
 * Handles size validation, downloading from storage, uploading to OneDrive,
 * and creating attachment references.
 */
export async function uploadFilesForTeamsMessage(params: {
  rawFiles: RawFileInput[]
  accessToken: string
  requestId: string
  logger: Logger
}): Promise<TeamsFileUploadResult> {
  const { rawFiles, accessToken, requestId, logger: log } = params
  const attachments: TeamsAttachmentRef[] = []
  const filesOutput: TeamsFileOutput[] = []

  if (!rawFiles || rawFiles.length === 0) {
    return { attachments, filesOutput }
  }

  log.info(`[${requestId}] Processing ${rawFiles.length} file(s) for upload to OneDrive`)

  const userFiles = processFilesToUserFiles(rawFiles, requestId, log) as UserFile[]

  for (const file of userFiles) {
    // Check size limit
    if (file.size > MAX_TEAMS_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2)
      log.error(
        `[${requestId}] File ${file.name} is ${sizeMB}MB, exceeds 4MB limit for direct upload`
      )
      throw new Error(
        `File "${file.name}" (${sizeMB}MB) exceeds the 4MB limit for Teams attachments. Use smaller files or upload to SharePoint/OneDrive first.`
      )
    }

    log.info(`[${requestId}] Uploading file to Teams: ${file.name} (${file.size} bytes)`)

    // Download file from storage
    const buffer = await downloadFileFromStorage(file, requestId, log)
    filesOutput.push({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      data: buffer.toString('base64'),
      size: buffer.length,
    })

    // Upload to OneDrive
    const uploadUrl =
      'https://graph.microsoft.com/v1.0/me/drive/root:/TeamsAttachments/' +
      encodeURIComponent(file.name) +
      ':/content'

    log.info(`[${requestId}] Uploading to OneDrive: ${uploadUrl}`)

    const uploadResponse = await secureFetchWithValidation(
      uploadUrl,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: buffer,
      },
      'uploadUrl'
    )

    if (!uploadResponse.ok) {
      const errorData = (await uploadResponse.json().catch(() => ({}))) as GraphApiErrorResponse
      log.error(`[${requestId}] Teams upload failed:`, errorData)
      throw new Error(
        `Failed to upload file to Teams: ${errorData.error?.message || 'Unknown error'}`
      )
    }

    const uploadedFile = (await uploadResponse.json()) as GraphDriveItem
    log.info(`[${requestId}] File uploaded to OneDrive successfully`, {
      id: uploadedFile.id,
      webUrl: uploadedFile.webUrl,
    })

    // Get file details for attachment reference
    const fileDetailsUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${uploadedFile.id}?$select=id,name,webDavUrl,eTag,size`

    const fileDetailsResponse = await secureFetchWithValidation(
      fileDetailsUrl,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      'fileDetailsUrl'
    )

    if (!fileDetailsResponse.ok) {
      const errorData = (await fileDetailsResponse
        .json()
        .catch(() => ({}))) as GraphApiErrorResponse
      log.error(`[${requestId}] Failed to get file details:`, errorData)
      throw new Error(`Failed to get file details: ${errorData.error?.message || 'Unknown error'}`)
    }

    const fileDetails = (await fileDetailsResponse.json()) as GraphDriveItem
    log.info(`[${requestId}] Got file details`, {
      webDavUrl: fileDetails.webDavUrl,
      eTag: fileDetails.eTag,
    })

    // Create attachment reference
    const attachmentId = fileDetails.eTag?.match(/\{([a-f0-9-]+)\}/i)?.[1] || fileDetails.id

    attachments.push({
      id: attachmentId,
      contentType: 'reference',
      contentUrl: fileDetails.webDavUrl!,
      name: file.name,
    })

    log.info(`[${requestId}] Created attachment reference for ${file.name}`)
  }

  log.info(
    `[${requestId}] All ${attachments.length} file(s) uploaded and attachment references created`
  )

  return { attachments, filesOutput }
}

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

/**
 * Download a reference-type attachment (SharePoint/OneDrive file) from Teams.
 * These are files shared in Teams that are stored in SharePoint/OneDrive.
 *
 */
export async function downloadReferenceAttachment(params: {
  accessToken: string
  attachment: MicrosoftTeamsAttachment
}): Promise<ToolFileData | null> {
  const { accessToken, attachment } = params

  if (attachment.contentType !== 'reference') {
    return null
  }

  const contentUrl = attachment.contentUrl
  if (!contentUrl) {
    logger.warn('Reference attachment has no contentUrl', { attachmentId: attachment.id })
    return null
  }

  try {
    const encodedUrl = Buffer.from(contentUrl)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const shareId = `u!${encodedUrl}`

    const metadataUrl = `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`
    const metadataRes = await fetch(metadataUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!metadataRes.ok) {
      const errorData = await metadataRes.json().catch(() => ({}))
      logger.error('Failed to get driveItem metadata via shares API', {
        status: metadataRes.status,
        error: errorData,
        attachmentName: attachment.name,
      })
      return null
    }

    const driveItem = await metadataRes.json()
    const mimeType = driveItem.file?.mimeType || 'application/octet-stream'
    const fileName = attachment.name || driveItem.name || 'attachment'

    const downloadUrl = `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`
    const downloadRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!downloadRes.ok) {
      logger.error('Failed to download file content', {
        status: downloadRes.status,
        fileName,
      })
      return null
    }

    const arrayBuffer = await downloadRes.arrayBuffer()
    const base64Data = Buffer.from(arrayBuffer).toString('base64')

    logger.info('Successfully downloaded reference attachment', {
      fileName,
      size: arrayBuffer.byteLength,
    })

    return {
      name: fileName,
      mimeType,
      data: base64Data,
    }
  } catch (error) {
    logger.error('Error downloading reference attachment:', {
      error,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
    })
    return null
  }
}

export async function downloadAllReferenceAttachments(params: {
  accessToken: string
  attachments: MicrosoftTeamsAttachment[]
}): Promise<ToolFileData[]> {
  const { accessToken, attachments } = params
  const results: ToolFileData[] = []

  const referenceAttachments = attachments.filter((att) => att.contentType === 'reference')

  if (referenceAttachments.length === 0) {
    return results
  }

  logger.info(`Downloading ${referenceAttachments.length} reference attachment(s)`)

  for (const attachment of referenceAttachments) {
    const file = await downloadReferenceAttachment({ accessToken, attachment })
    if (file) {
      results.push(file)
    }
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
