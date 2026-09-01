import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  MicrosoftTeamsClient,
  type MicrosoftTeamsGraphObject,
} from '@/lib/internal/microsoft-teams/client'
import { MicrosoftTeamsOperationError } from '@/lib/internal/microsoft-teams/errors'
import type {
  MicrosoftTeamsWriteChannelInput,
  MicrosoftTeamsWriteChatInput,
} from '@/lib/internal/microsoft-teams/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'

const MAX_GRAPH_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_TEAMS_FILE_SIZE = 4 * 1024 * 1024
const MENTION_PATTERN = /<at>[^<]+<\/at>/i

const logger = createLogger('MicrosoftTeamsOperations')

interface GraphResponse {
  id?: string
  error?: { message?: string }
}

export interface MicrosoftTeamsOperationContext {
  requestId?: string
  signal?: AbortSignal
  userId?: string
}

interface TeamsFileOutput {
  name: string
  mimeType: string
  data: string
  size: number
}

interface TeamsAttachmentRef {
  id: string
  contentType: 'reference'
  contentUrl: string
  name: string
}

interface TeamMember {
  id: string
  displayName: string
  userIdentityType?: string
}

interface TeamsMention {
  id: number
  mentionText: string
  mentioned:
    | { user: { id: string; displayName: string; userIdentityType: string } }
    | { application: { displayName: string; id: string; applicationIdentityType: 'bot' } }
}

interface MentionResult {
  mentions: TeamsMention[]
  hasMentions: boolean
  updatedContent: string
}

function optionalString(data: MicrosoftTeamsGraphObject, key: string): string | undefined {
  return typeof data[key] === 'string' ? data[key] : undefined
}

function nestedObject(data: MicrosoftTeamsGraphObject, key: string): MicrosoftTeamsGraphObject {
  return isRecordLike(data[key]) ? data[key] : {}
}

function requiredId(value: string, label: string): string {
  const id = value.trim()
  if (!id) throw new MicrosoftTeamsOperationError(`${label} is required`, 400)
  return id
}

function fileSizeError(file: UserFile, observedBytes = file.size): MicrosoftTeamsOperationError {
  const sizeMB = (observedBytes / (1024 * 1024)).toFixed(2)
  return new MicrosoftTeamsOperationError(
    `File "${file.name}" (${sizeMB}MB) exceeds the 4MB limit for Teams attachments. Use smaller files or upload to SharePoint/OneDrive first.`,
    500
  )
}

async function uploadFilesForMessage(
  rawFiles: NonNullable<MicrosoftTeamsWriteChatInput['files']>,
  client: MicrosoftTeamsClient,
  context: MicrosoftTeamsOperationContext
): Promise<{ attachments: TeamsAttachmentRef[]; files: TeamsFileOutput[] }> {
  if (rawFiles.length === 0) return { attachments: [], files: [] }
  if (!context.userId) throw new MicrosoftTeamsOperationError('Authentication required', 401)
  const requestId = context.requestId || 'microsoft-teams-operation'
  const userFiles = processFilesToUserFiles(rawFiles, requestId, logger)
  const attachments: TeamsAttachmentRef[] = []
  const files: TeamsFileOutput[] = []
  let totalBytes = 0

  for (const file of userFiles) {
    context.signal?.throwIfAborted()
    if (file.size > MAX_TEAMS_FILE_SIZE) throw fileSizeError(file)
    const denied = await assertToolFileAccess(file.key, context.userId, requestId, logger)
    context.signal?.throwIfAborted()
    if (denied) throw new MicrosoftTeamsOperationError('File not found', denied.status)

    let buffer: Buffer
    let contentType: string
    try {
      const remainingBudget = MAX_BUFFERED_TRANSFER_BYTES - totalBytes
      const downloaded = await downloadServableFileFromStorage(file, requestId, logger, {
        maxBytes: Math.min(MAX_TEAMS_FILE_SIZE, remainingBudget),
        signal: context.signal,
      })
      buffer = downloaded.buffer
      contentType = downloaded.contentType || file.type || 'application/octet-stream'
    } catch (error) {
      context.signal?.throwIfAborted()
      if (isDocNotReadyError(error)) {
        throw new MicrosoftTeamsOperationError(docNotReadyMessage(), 409)
      }
      if (isPayloadSizeLimitError(error) && totalBytes >= MAX_BUFFERED_TRANSFER_BYTES) {
        throw new MicrosoftTeamsOperationError(
          'Teams attachments exceed the upload size limit',
          413
        )
      }
      if (isPayloadSizeLimitError(error)) {
        throw fileSizeError(file, error.observedBytes ?? file.size)
      }
      throw error
    }
    totalBytes += buffer.length
    files.push({
      name: file.name,
      mimeType: contentType,
      data: buffer.toString('base64'),
      size: buffer.length,
    })

    let uploaded: MicrosoftTeamsGraphObject
    try {
      uploaded = await client.json(
        `/me/drive/root:/TeamsAttachments/${encodeURIComponent(file.name)}:/content`,
        {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: new Uint8Array(buffer),
        },
        'Unknown error',
        context.signal
      )
    } catch (error) {
      context.signal?.throwIfAborted()
      const message =
        error instanceof MicrosoftTeamsOperationError ? error.message : 'Unknown error'
      throw new MicrosoftTeamsOperationError(`Failed to upload file to Teams: ${message}`, 500)
    }
    const uploadedId = optionalString(uploaded, 'id')
    if (!uploadedId) {
      throw new MicrosoftTeamsOperationError('Failed to upload file to Teams: Unknown error', 500)
    }

    let details: MicrosoftTeamsGraphObject
    try {
      details = await client.json(
        `/me/drive/items/${encodeURIComponent(uploadedId)}?select=id,name,webDavUrl,eTag,size`,
        { method: 'GET' },
        'Unknown error',
        context.signal
      )
    } catch (error) {
      context.signal?.throwIfAborted()
      const message =
        error instanceof MicrosoftTeamsOperationError ? error.message : 'Unknown error'
      throw new MicrosoftTeamsOperationError(`Failed to get file details: ${message}`, 500)
    }
    const webDavUrl = optionalString(details, 'webDavUrl')
    if (!webDavUrl) {
      throw new MicrosoftTeamsOperationError(
        `Failed to get file URL for attachment "${file.name}". The file was uploaded but Teams attachment reference could not be created.`,
        500
      )
    }
    const detailId = optionalString(details, 'id') || uploadedId
    const eTag = optionalString(details, 'eTag')
    attachments.push({
      id: eTag?.match(/\{([a-f0-9-]+)\}/i)?.[1] || detailId,
      contentType: 'reference',
      contentUrl: webDavUrl,
      name: file.name,
    })
  }
  return { attachments, files }
}

function parseMentionNames(content: string): Array<{ name: string; tag: string; id: number }> {
  const parsed: Array<{ name: string; tag: string; id: number }> = []
  const pattern = /<at>([^<]+)<\/at>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1].trim()
    if (name) parsed.push({ name, tag: match[0], id: parsed.length })
  }
  return parsed
}

async function resolveMentions(
  content: string,
  membersPath: string,
  client: MicrosoftTeamsClient,
  signal?: AbortSignal
): Promise<MentionResult> {
  const parsed = parseMentionNames(content)
  if (parsed.length === 0) return { mentions: [], hasMentions: false, updatedContent: content }
  const data = await client.json(membersPath, { method: 'GET' }, 'Failed to list members', signal)
  const rawMembers = Array.isArray(data.value) ? data.value : []
  const members: TeamMember[] = rawMembers.flatMap((value) => {
    if (!isRecordLike(value)) return []
    const id = optionalString(value, 'id')
    if (!id) return []
    return [
      {
        id,
        displayName: optionalString(value, 'displayName') || '',
        userIdentityType: optionalString(value, 'userIdentityType'),
      },
    ]
  })
  const mentions: TeamsMention[] = []
  const resolvedTags = new Set<string>()
  let updatedContent = content
  for (const mention of parsed) {
    if (resolvedTags.has(mention.tag)) continue
    const normalizedName = mention.name.toLowerCase()
    const member = members.find(
      (candidate) => candidate.displayName.toLowerCase() === normalizedName
    )
    if (!member) continue
    mentions.push(
      member.userIdentityType === 'bot'
        ? {
            id: mention.id,
            mentionText: mention.name,
            mentioned: {
              application: {
                displayName: member.displayName,
                id: member.id,
                applicationIdentityType: 'bot',
              },
            },
          }
        : {
            id: mention.id,
            mentionText: mention.name,
            mentioned: {
              user: {
                id: member.id,
                displayName: member.displayName,
                userIdentityType: member.userIdentityType || 'aadUser',
              },
            },
          }
    )
    resolvedTags.add(mention.tag)
    updatedContent = updatedContent.replaceAll(
      mention.tag,
      `<at id="${mention.id}">${mention.name}</at>`
    )
  }
  return { mentions, hasMentions: mentions.length > 0, updatedContent }
}

async function sendMessage(args: {
  accessToken: string
  content: string
  files: MicrosoftTeamsWriteChatInput['files']
  messagePath: string
  membersPath: string
  context: MicrosoftTeamsOperationContext
  plainMetadata: (data: MicrosoftTeamsGraphObject) => Record<string, unknown>
  enhancedMetadata: (data: MicrosoftTeamsGraphObject) => Record<string, unknown>
}) {
  const enhanced = Boolean(args.files?.length || MENTION_PATTERN.test(args.content))
  const client = new MicrosoftTeamsClient(args.accessToken)
  if (!enhanced) {
    const data = await client.json(
      args.messagePath,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: { contentType: 'text', content: args.content } }),
      },
      'Failed to send Teams message',
      args.context.signal
    )
    return {
      success: true as const,
      output: { updatedContent: true, metadata: args.plainMetadata(data) },
    }
  }

  const uploaded = await uploadFilesForMessage(args.files || [], client, args.context)
  let messageContent = args.content
  let contentType: 'text' | 'html' = 'text'
  let mentionResult: MentionResult = {
    mentions: [],
    hasMentions: false,
    updatedContent: args.content,
  }
  try {
    mentionResult = await resolveMentions(
      args.content,
      args.membersPath,
      client,
      args.context.signal
    )
  } catch (error) {
    args.context.signal?.throwIfAborted()
    logger.warn('Failed to resolve Teams mentions; continuing without them', {
      error: getErrorMessage(error),
      requestId: args.context.requestId,
    })
  }
  if (mentionResult.hasMentions) {
    contentType = 'html'
    messageContent = mentionResult.updatedContent
  }
  if (uploaded.attachments.length > 0) {
    contentType = 'html'
    const tags = uploaded.attachments
      .map((attachment) => `<attachment id="${attachment.id}"></attachment>`)
      .join(' ')
    messageContent = `${messageContent}<br/>${tags}`
  }
  const body: Record<string, unknown> = { body: { contentType, content: messageContent } }
  if (uploaded.attachments.length > 0) body.attachments = uploaded.attachments
  if (mentionResult.mentions.length > 0) body.mentions = mentionResult.mentions
  const data = await client.json(
    args.messagePath,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    'Failed to send Teams message',
    args.context.signal
  )
  return {
    success: true as const,
    output: {
      updatedContent: true,
      metadata: {
        ...args.enhancedMetadata(data),
        attachmentCount: uploaded.attachments.length,
      },
      files: uploaded.files,
    },
  }
}

export async function writeMicrosoftTeamsChatMessage(
  input: MicrosoftTeamsWriteChatInput,
  context: MicrosoftTeamsOperationContext
) {
  context.signal?.throwIfAborted()
  const chatId = requiredId(input.chatId, 'Chat ID')
  return sendMessage({
    accessToken: input.accessToken,
    content: input.content,
    files: input.files,
    messagePath: `/chats/${encodeURIComponent(chatId)}/messages`,
    membersPath: `/chats/${encodeURIComponent(chatId)}/members`,
    context,
    plainMetadata: (data) => ({
      messageId: optionalString(data, 'id') || '',
      chatId: optionalString(data, 'chatId') || '',
      content: optionalString(nestedObject(data, 'body'), 'content') || input.content,
      createdTime: optionalString(data, 'createdDateTime') || new Date().toISOString(),
      url: optionalString(data, 'webUrl') || '',
    }),
    enhancedMetadata: (data) => ({
      messageId: optionalString(data, 'id'),
      chatId: optionalString(data, 'chatId') || input.chatId,
      content: optionalString(nestedObject(data, 'body'), 'content') || input.content,
      createdTime: optionalString(data, 'createdDateTime') || new Date().toISOString(),
      url: optionalString(data, 'webUrl') || '',
    }),
  })
}

export async function writeMicrosoftTeamsChannelMessage(
  input: MicrosoftTeamsWriteChannelInput,
  context: MicrosoftTeamsOperationContext
) {
  context.signal?.throwIfAborted()
  const teamId = requiredId(input.teamId, 'Team ID')
  const channelId = requiredId(input.channelId, 'Channel ID')
  return sendMessage({
    accessToken: input.accessToken,
    content: input.content,
    files: input.files,
    messagePath: `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
    membersPath: `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/members`,
    context,
    plainMetadata: (data) => {
      const identity = nestedObject(data, 'channelIdentity')
      return {
        messageId: optionalString(data, 'id') || '',
        teamId: optionalString(identity, 'teamId') || '',
        channelId: optionalString(identity, 'channelId') || '',
        content: optionalString(nestedObject(data, 'body'), 'content') || input.content,
        createdTime: optionalString(data, 'createdDateTime') || new Date().toISOString(),
        url: optionalString(data, 'webUrl') || '',
      }
    },
    enhancedMetadata: (data) => {
      const identity = nestedObject(data, 'channelIdentity')
      return {
        messageId: optionalString(data, 'id'),
        teamId: optionalString(identity, 'teamId') || input.teamId,
        channelId: optionalString(identity, 'channelId') || input.channelId,
        content: optionalString(nestedObject(data, 'body'), 'content') || input.content,
        createdTime: optionalString(data, 'createdDateTime') || new Date().toISOString(),
        url: optionalString(data, 'webUrl') || '',
      }
    },
  })
}

export interface MicrosoftTeamsDeleteChatMessageInput {
  accessToken: string
  chatId: string
  messageId: string
}

async function readGraphResponse(response: Response, signal?: AbortSignal): Promise<GraphResponse> {
  if (response.status === 204) return {}
  return readResponseJsonWithLimit<GraphResponse>(response, {
    maxBytes: MAX_GRAPH_RESPONSE_BYTES,
    label: 'Microsoft Graph response',
    signal,
  }).catch(() => ({}))
}

export async function deleteMicrosoftTeamsChatMessage(
  input: MicrosoftTeamsDeleteChatMessageInput,
  context: MicrosoftTeamsOperationContext
) {
  context.signal?.throwIfAborted()
  const chatId = input.chatId.trim()
  const messageId = input.messageId.trim()
  if (!chatId || !messageId) {
    throw new MicrosoftTeamsOperationError('Chat ID and Message ID are required', 400)
  }

  const meResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: context.signal,
  })
  const me = await readGraphResponse(meResponse, context.signal)
  if (!meResponse.ok || !me.id) {
    throw new MicrosoftTeamsOperationError(
      me.error?.message || 'Failed to get user information',
      meResponse.status
    )
  }

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(me.id)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/softDelete`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: context.signal,
    }
  )
  if (!response.ok) {
    const error = await readGraphResponse(response, context.signal)
    throw new MicrosoftTeamsOperationError(
      error.error?.message || 'Failed to delete Teams message',
      response.status
    )
  }
  return {
    success: true,
    output: {
      deleted: true,
      messageId,
      metadata: { messageId, chatId },
    },
  }
}
