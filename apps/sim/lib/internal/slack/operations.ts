import { createLogger } from '@sim/logger'
import type {
  SlackDeleteMessageBody,
  SlackDownloadBody,
  SlackReactionBody,
  SlackReadMessagesBody,
  SlackSendEphemeralBody,
  SlackSendMessageBody,
  SlackUpdateMessageBody,
} from '@/lib/api/contracts/tools/communication/slack'
import {
  secureFetchWithPinnedIP,
  secureFetchWithValidation,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  openSlackDm,
  requestSlackApi,
  type SlackJsonObject,
  slackArray,
  slackObject,
  slackOk,
  slackString,
} from '@/lib/internal/slack/client'
import { SlackOperationError } from '@/lib/internal/slack/errors'
import { forEachSlackAttachmentFile } from '@/lib/internal/slack/file-input'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import type { ToolFileData } from '@/tools/types'

const logger = createLogger('SlackOperations')

export interface SlackOperationContext {
  requestId: string
  signal?: AbortSignal
  userId?: string
}

function failure(status: number, error: string): never {
  throw new SlackOperationError(status, { success: false, error })
}

function providerError(data: SlackJsonObject, status: number, fallback: string): never {
  return failure(status, slackString(data, 'error') || fallback)
}

function record(value: unknown): SlackJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as SlackJsonObject)
    : {}
}

function mapReaction(value: unknown) {
  const reaction = record(value)
  return {
    name: reaction.name,
    count: reaction.count,
    users: Array.isArray(reaction.users) ? reaction.users : [],
  }
}

function mapFile(value: unknown) {
  const file = record(value)
  return {
    id: file.id,
    name: file.name,
    mimetype: file.mimetype,
    size: file.size,
    url_private: file.url_private,
    permalink: file.permalink,
    mode: file.mode,
  }
}

function mapReaderMessage(value: unknown) {
  const message = record(value)
  const edited = record(message.edited)
  return {
    type: message.type || 'message',
    ts: message.ts,
    text: message.text || '',
    user: message.user,
    bot_id: message.bot_id,
    username: message.username,
    channel: message.channel,
    team: message.team,
    thread_ts: message.thread_ts,
    parent_user_id: message.parent_user_id,
    reply_count: message.reply_count,
    reply_users_count: message.reply_users_count,
    latest_reply: message.latest_reply,
    subscribed: message.subscribed,
    last_read: message.last_read,
    unread_count: message.unread_count,
    subtype: message.subtype,
    reactions: Array.isArray(message.reactions) ? message.reactions.map(mapReaction) : undefined,
    is_starred: message.is_starred,
    pinned_to: message.pinned_to,
    files: Array.isArray(message.files) ? message.files.map(mapFile) : undefined,
    attachments: message.attachments,
    blocks: message.blocks,
    edited:
      message.edited && typeof message.edited === 'object'
        ? { user: edited.user, ts: edited.ts }
        : undefined,
    permalink: message.permalink,
  }
}

export async function executeSlackAddReaction(input: SlackReactionBody, signal?: AbortSignal) {
  const { data, status } = await requestSlackApi({
    accessToken: input.accessToken,
    method: 'reactions.add',
    body: { channel: input.channel, timestamp: input.timestamp, name: input.name },
    signal,
  })
  if (!slackOk(data)) providerError(data, status, 'Failed to add reaction')
  return {
    success: true as const,
    output: {
      content: `Successfully added :${input.name}: reaction`,
      metadata: { channel: input.channel, timestamp: input.timestamp, reaction: input.name },
    },
  }
}

export async function executeSlackRemoveReaction(input: SlackReactionBody, signal?: AbortSignal) {
  const { data, status } = await requestSlackApi({
    accessToken: input.accessToken,
    method: 'reactions.remove',
    body: { channel: input.channel, timestamp: input.timestamp, name: input.name },
    signal,
  })
  if (!slackOk(data)) providerError(data, status, 'Failed to remove reaction')
  return {
    success: true as const,
    output: {
      content: `Successfully removed :${input.name}: reaction`,
      metadata: { channel: input.channel, timestamp: input.timestamp, reaction: input.name },
    },
  }
}

export async function executeSlackDeleteMessage(
  input: SlackDeleteMessageBody,
  signal?: AbortSignal
) {
  const { data, status } = await requestSlackApi({
    accessToken: input.accessToken,
    method: 'chat.delete',
    body: { channel: input.channel, ts: input.timestamp },
    signal,
  })
  if (!slackOk(data)) providerError(data, status, 'Failed to delete message')
  return {
    success: true as const,
    output: {
      content: 'Message deleted successfully',
      metadata: { channel: data.channel, timestamp: data.ts },
    },
  }
}

export async function executeSlackUpdateMessage(
  input: SlackUpdateMessageBody,
  signal?: AbortSignal
) {
  const { data, status } = await requestSlackApi({
    accessToken: input.accessToken,
    method: 'chat.update',
    body: {
      channel: input.channel,
      ts: input.timestamp,
      text: input.text,
      ...(input.blocks?.length ? { blocks: input.blocks } : {}),
    },
    signal,
  })
  if (!slackOk(data)) providerError(data, status, 'Failed to update message')
  const message = data.message ?? {
    type: 'message',
    ts: data.ts,
    text: data.text || input.text,
    channel: data.channel,
  }
  return {
    success: true as const,
    output: {
      message,
      content: 'Message updated successfully',
      metadata: {
        channel: data.channel,
        timestamp: data.ts,
        text: data.text || input.text,
      },
    },
  }
}

export async function executeSlackSendEphemeral(
  input: SlackSendEphemeralBody,
  signal?: AbortSignal
) {
  const { data } = await requestSlackApi({
    accessToken: input.accessToken,
    method: 'chat.postEphemeral',
    body: {
      channel: input.channel,
      user: input.user,
      text: input.text,
      ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
      ...(input.blocks?.length ? { blocks: input.blocks } : {}),
    },
    signal,
  })
  if (!slackOk(data)) providerError(data, 400, 'Failed to send ephemeral message')
  return {
    success: true as const,
    output: { messageTs: data.message_ts, channel: input.channel },
  }
}

export async function executeSlackReadMessages(input: SlackReadMessagesBody, signal?: AbortSignal) {
  let channel = input.channel ?? undefined
  if (!channel && input.userId) channel = await openSlackDm(input.accessToken, input.userId, signal)
  if (!channel) failure(400, 'Either channel or userId is required')
  const { data } = await requestSlackApi({
    accessToken: input.accessToken,
    method: 'conversations.history',
    httpMethod: 'GET',
    query: {
      channel,
      limit: typeof input.limit === 'number' ? input.limit : 10,
      oldest: input.oldest ?? undefined,
      latest: input.latest ?? undefined,
    },
    signal,
  })
  if (!slackOk(data)) {
    const error = slackString(data, 'error')
    if (error === 'not_in_channel') {
      failure(
        400,
        'Bot is not in the channel. Please invite the Sim bot to your Slack channel by typing: /invite @Sim Studio'
      )
    }
    if (error === 'channel_not_found') {
      failure(400, 'Channel not found. Please check the channel ID and try again.')
    }
    if (error === 'missing_scope') {
      failure(
        400,
        'Missing required permissions. Reconnect your Slack account to grant channel history access (channels:history, groups:history). Reading direct message history is not supported with the Sim bot.'
      )
    }
    failure(400, error || 'Failed to fetch messages')
  }
  return {
    success: true as const,
    output: { messages: (slackArray(data, 'messages') ?? []).map(mapReaderMessage) },
  }
}

function defaultMessage(ts: unknown, text: string, channel: unknown) {
  return { type: 'message', ts, text, channel }
}

function sentMessageOutput(data: SlackJsonObject, text: string) {
  return {
    message: data.message ?? defaultMessage(data.ts, text, data.channel),
    ts: data.ts,
    channel: data.channel,
  }
}

async function postSlackMessage(
  input: SlackSendMessageBody,
  channel: string,
  signal?: AbortSignal
) {
  return requestSlackApi({
    accessToken: input.accessToken,
    method: 'chat.postMessage',
    body: {
      channel,
      text: input.text,
      ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
      ...(input.blocks?.length ? { blocks: input.blocks } : {}),
    },
    signal,
  })
}

async function uploadSlackFiles(
  input: SlackSendMessageBody,
  channel: string,
  context: SlackOperationContext
): Promise<{ fileIds: string[]; files: ToolFileData[]; message?: unknown }> {
  const fileIds: string[] = []
  const files: ToolFileData[] = []

  await forEachSlackAttachmentFile(
    input.files ?? [],
    {
      logger,
      requestId: context.requestId,
      signal: context.signal,
      userId: context.userId,
    },
    async (file) => {
      context.signal?.throwIfAborted()
      const { data } = await requestSlackApi({
        accessToken: input.accessToken,
        method: 'files.getUploadURLExternal',
        body: new URLSearchParams({ filename: file.name, length: String(file.buffer.length) }),
        signal: context.signal,
      })
      const uploadUrl = slackString(data, 'upload_url')
      const fileId = slackString(data, 'file_id')
      if (!slackOk(data) || !uploadUrl || !fileId) {
        logger.error(`[${context.requestId}] Failed to get Slack upload URL`, {
          error: slackString(data, 'error'),
        })
        return
      }
      const uploaded = await secureFetchWithValidation(
        uploadUrl,
        {
          profile: 'contentFetch',
          method: 'POST',
          body: file.buffer,
          maxResponseBytes: 64 * 1024,
          signal: context.signal,
        },
        'uploadUrl'
      )
      context.signal?.throwIfAborted()
      if (!uploaded.ok) {
        logger.error(`[${context.requestId}] Failed to upload Slack file data`, {
          status: uploaded.status,
        })
        return
      }
      fileIds.push(fileId)
      files.push({
        name: file.name,
        mimeType: file.contentType || file.type || 'application/octet-stream',
        data: file.buffer.toString('base64'),
        size: file.buffer.length,
      })
    }
  )

  if (fileIds.length === 0) return { fileIds, files }
  const { data } = await requestSlackApi({
    accessToken: input.accessToken,
    method: 'files.completeUploadExternal',
    body: {
      files: fileIds.map((id) => ({ id })),
      channel_id: channel,
      ...(input.blocks?.length ? { blocks: input.blocks } : { initial_comment: input.text }),
      ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
    },
    signal: context.signal,
  })
  if (!slackOk(data)) providerError(data, 400, 'Failed to complete file upload')
  const slackFiles = slackArray(data, 'files') ?? []
  const first = record(slackFiles[0])
  const message = {
    type: 'message',
    ts:
      first.created !== undefined && first.created !== null
        ? String(first.created)
        : String(Date.now() / 1000),
    text: input.text,
    channel,
    files: slackFiles.map((value) => {
      const slackFile = record(value)
      return {
        id: slackFile.id,
        name: slackFile.name,
        mimetype: slackFile.mimetype,
        size: slackFile.size,
        url_private: slackFile.url_private,
        permalink: slackFile.permalink,
      }
    }),
  }
  return { fileIds, files, message }
}

export async function executeSlackSendMessage(
  input: SlackSendMessageBody,
  context: SlackOperationContext
) {
  context.signal?.throwIfAborted()
  if (!context.userId) failure(401, 'Authentication required')
  let channel = input.channel ?? undefined
  if (!channel && input.userId) {
    channel = await openSlackDm(input.accessToken, input.userId, context.signal)
  }
  if (!channel) failure(400, 'Either channel or userId is required')

  if (!input.files?.length) {
    const { data } = await postSlackMessage(input, channel, context.signal)
    if (!slackOk(data)) providerError(data, 400, 'Failed to send message')
    return { success: true as const, output: sentMessageOutput(data, input.text) }
  }

  const uploaded = await uploadSlackFiles(input, channel, context)
  if (uploaded.fileIds.length === 0) {
    const { data } = await postSlackMessage(input, channel, context.signal)
    if (!slackOk(data)) providerError(data, 400, 'Failed to send message')
    return { success: true as const, output: sentMessageOutput(data, input.text) }
  }

  return {
    success: true as const,
    output: {
      message: uploaded.message,
      ts: record(uploaded.message).ts,
      channel,
      fileCount: uploaded.fileIds.length,
      files: uploaded.files,
    },
  }
}

export async function executeSlackDownload(input: SlackDownloadBody, signal?: AbortSignal) {
  const { data, status, statusText } = await requestSlackApi({
    accessToken: input.accessToken,
    method: 'files.info',
    httpMethod: 'GET',
    query: { file: input.fileId },
    signal,
    tolerateInvalidErrorJson: true,
  })
  if (status < 200 || status >= 300) {
    logger.error('Failed to get Slack file info', { status, statusText })
    failure(400, slackString(data, 'error') || 'Failed to get file info')
  }
  if (!slackOk(data)) providerError(data, 400, 'Slack API error')
  const file = slackObject(data, 'file') ?? {}
  const name = input.fileName || slackString(file, 'name') || 'download'
  const mimeType = slackString(file, 'mimetype') || 'application/octet-stream'
  const urlPrivate = slackString(file, 'url_private')
  if (!urlPrivate) failure(400, 'File does not have a download URL')
  const downloadUrl = urlPrivate
  const validation = await validateUrlWithDNS(downloadUrl, 'urlPrivate', 'contentFetch')
  signal?.throwIfAborted()
  if (!validation.isValid) failure(400, validation.error || 'Invalid Slack file URL')
  const response = await secureFetchWithPinnedIP(downloadUrl, validation.resolvedIP, {
    profile: 'contentFetch',
    headers: { Authorization: `Bearer ${input.accessToken}` },
    maxResponseBytes: MAX_FILE_SIZE,
    signal,
  })
  signal?.throwIfAborted()
  if (!response.ok) failure(400, 'Failed to download file content')
  const buffer = Buffer.from(await response.arrayBuffer())
  signal?.throwIfAborted()
  return {
    success: true as const,
    output: {
      file: { name, mimeType, data: buffer.toString('base64'), size: buffer.length },
    },
  }
}
