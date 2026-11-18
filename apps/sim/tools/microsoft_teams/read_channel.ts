import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import {
  AttachmentDownloadBudget,
  rethrowAttachmentDownloadError,
} from '@/lib/uploads/utils/attachment-download-budget'
import type {
  MicrosoftTeamsMessageSummary,
  MicrosoftTeamsReadResponse,
  MicrosoftTeamsToolParams,
} from '@/tools/microsoft_teams/types'
import {
  downloadAllReferenceAttachments,
  extractMessageAttachments,
  extractMessageDetails,
  extractNextPageToken,
  fetchHostedContentsForChannelMessage,
  resolvePageSize,
} from '@/tools/microsoft_teams/utils'
import type { ToolConfig, ToolFileData, ToolResponseContext } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('MicrosoftTeamsReadChannel')

function senderName(message: unknown): string {
  const data = toRecord(message)
  const displayName = toRecord(toRecord(data.from).user).displayName
  if (typeof displayName === 'string' && displayName) return displayName
  if (data.messageType === 'systemEventMessage') return 'System'
  return 'Unknown'
}

function summarizeReplies(message: unknown): MicrosoftTeamsMessageSummary[] {
  const replies = toRecord(message).replies
  if (!Array.isArray(replies)) return []
  return replies.map((reply) => {
    const data = toRecord(reply)
    return {
      ...extractMessageDetails(data),
      id: toStringOrNull(data.id) ?? '',
      content: toStringOrNull(toRecord(data.body).content) || 'No content',
      sender: senderName(data),
      timestamp: toStringOrNull(data.createdDateTime) ?? '',
      messageType: toStringOrNull(data.messageType) || 'message',
      attachments: extractMessageAttachments(data),
    }
  })
}

export const readChannelTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsReadResponse> = {
  id: 'microsoft_teams_read_channel',
  name: 'Read Microsoft Teams Channel',
  description: 'Read content from a Microsoft Teams channel',
  version: '1.0',
  errorExtractor: 'nested-error-object',

  oauth: {
    required: true,
    provider: 'microsoft-teams',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Teams API',
    },
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the team to read from (e.g., "12345678-abcd-1234-efgh-123456789012" - a GUID from team listings)',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the channel to read from (e.g., "19:abc123def456@thread.tacv2" - from channel listings)',
    },
    includeAttachments: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Download and include message attachments (hosted contents) into storage',
    },
    includeReplies: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include thread replies for each root message (Graph caps the replies returned per message; hasMoreReplies is true when more exist)',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of root messages to return per page (1-50, default 50)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous read (nextPageToken) to fetch the next page',
    },
  },

  request: {
    url: (params) => {
      const encodedTeamId = safeUrlPathSegment(params.teamId ?? '', 'Team ID')
      const encodedChannelId = safeUrlPathSegment(params.channelId ?? '', 'Channel ID')
      const pageToken = params.pageToken?.trim()
      const query = [
        `$top=${resolvePageSize(params.top)}`,
        params.includeReplies ? '$expand=replies' : '',
        pageToken ? `$skiptoken=${encodeURIComponent(pageToken)}` : '',
      ]
        .filter(Boolean)
        .join('&')

      // Graph defaults to 20 channel messages per page; 50 is the documented maximum.
      return `https://graph.microsoft.com/v1.0/teams/${encodedTeamId}/channels/${encodedChannelId}/messages?${query}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (
    response: Response,
    params?: MicrosoftTeamsToolParams,
    context?: ToolResponseContext
  ) => {
    const budget = new AttachmentDownloadBudget(context)
    context?.signal?.throwIfAborted()
    const data = await response.json()

    const messages = data.value || []
    const nextPageToken = extractNextPageToken(data['@odata.nextLink'])
    const hasMore = Boolean(data['@odata.nextLink'])

    if (messages.length === 0) {
      return {
        success: true,
        output: {
          content: 'No messages found in this channel.',
          metadata: {
            teamId: '',
            channelId: '',
            messageCount: 0,
            messages: [],
            totalAttachments: 0,
            attachmentTypes: [],
            hasMore,
            nextPageToken,
          },
          messages: [],
          messageCount: 0,
          teamId: params?.teamId ?? '',
          channelId: params?.channelId ?? '',
          attachmentCount: 0,
          attachmentTypes: [],
          hasMore,
          nextPageToken,
        },
      }
    }

    const processedMessages: NonNullable<
      MicrosoftTeamsReadResponse['output']['metadata']['messages']
    > = []
    for (const [index, message] of messages.entries()) {
      context?.signal?.throwIfAborted()
      try {
        const content = message.body?.content || 'No content'
        const messageId = message.id

        const attachments = extractMessageAttachments(message)

        const sender = senderName(message)

        let uploaded: ToolFileData[] = []
        if (
          params?.includeAttachments &&
          params.accessToken &&
          params.teamId &&
          params.channelId &&
          messageId
        ) {
          try {
            const hostedContents = await fetchHostedContentsForChannelMessage({
              accessToken: params.accessToken,
              teamId: params.teamId,
              channelId: params.channelId,
              messageId,
              budget,
            })
            uploaded.push(...hostedContents)

            const referenceFiles = await downloadAllReferenceAttachments({
              accessToken: params.accessToken,
              attachments,
              budget,
            })
            uploaded.push(...referenceFiles)
          } catch (_e) {
            rethrowAttachmentDownloadError(_e, context?.signal)
            uploaded = []
          }
        }

        processedMessages.push({
          ...extractMessageDetails(message),
          id: messageId,
          content: content,
          sender,
          timestamp: message.createdDateTime,
          messageType: message.messageType || 'message',
          attachments,
          uploadedFiles: uploaded,
          ...(params?.includeReplies
            ? {
                replies: summarizeReplies(message),
                hasMoreReplies: Boolean(message['replies@odata.nextLink']),
              }
            : {}),
        })
      } catch (error) {
        rethrowAttachmentDownloadError(error, context?.signal)
        logger.error(`Error processing message at index ${index}:`, error)
        processedMessages.push({
          id: message.id || `unknown-${index}`,
          content: 'Error processing message',
          sender: 'Unknown',
          timestamp: message.createdDateTime || new Date().toISOString(),
          messageType: 'error',
          attachments: [],
        })
      }
    }

    const formattedMessages = processedMessages
      .map((message: any) => {
        const sender = message.sender
        const timestamp = message.timestamp
          ? new Date(message.timestamp).toLocaleString()
          : 'Unknown time'

        const line = `[${timestamp}] ${sender}: ${message.content}`
        const replies: MicrosoftTeamsMessageSummary[] = message.replies ?? []
        const replyLines = replies.map((reply) => {
          const replyTime = reply.timestamp
            ? new Date(reply.timestamp).toLocaleString()
            : 'Unknown time'
          return `  ↳ [${replyTime}] ${reply.sender}: ${reply.content}`
        })
        return [line, ...replyLines].join('\n')
      })
      .join('\n\n')

    const allAttachments = processedMessages.flatMap((msg: any) => msg.attachments || [])
    const attachmentTypes: string[] = []
    const seenTypes = new Set<string>()

    allAttachments.forEach((att: any) => {
      if (
        att.contentType &&
        typeof att.contentType === 'string' &&
        !seenTypes.has(att.contentType)
      ) {
        attachmentTypes.push(att.contentType)
        seenTypes.add(att.contentType)
      }
    })

    const metadata = {
      teamId: messages[0]?.channelIdentity?.teamId || params?.teamId || '',
      channelId: messages[0]?.channelIdentity?.channelId || params?.channelId || '',
      messageCount: messages.length,
      totalAttachments: allAttachments.length,
      attachmentTypes,
      messages: processedMessages,
      hasMore,
      nextPageToken,
    }

    const flattenedUploads = processedMessages.flatMap((m: any) => m.uploadedFiles || [])

    return {
      success: true,
      output: {
        content: formattedMessages,
        metadata,
        attachments: flattenedUploads,
        messages: metadata.messages,
        messageCount: metadata.messageCount,
        teamId: metadata.teamId,
        channelId: metadata.channelId,
        attachmentCount: metadata.totalAttachments,
        attachmentTypes,
        hasMore,
        nextPageToken,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Teams channel read operation success status' },
    messageCount: { type: 'number', description: 'Number of messages retrieved from channel' },
    teamId: { type: 'string', description: 'ID of the team that was read from' },
    channelId: { type: 'string', description: 'ID of the channel that was read from' },
    messages: {
      type: 'array',
      description:
        'Array of channel message objects (also available at metadata.messages). Each has id, content, sender, timestamp, messageType, attachments, from (user/application/device), senderId, senderType, replyToId, subject, summary, importance, webUrl, contentType, lastModifiedDateTime, lastEditedDateTime, deletedDateTime, mentions, reactions, and (with includeReplies) replies and hasMoreReplies',
    },
    attachmentCount: { type: 'number', description: 'Total number of attachments found' },
    attachmentTypes: { type: 'array', description: 'Types of attachments found' },
    content: { type: 'string', description: 'Formatted content of channel messages' },
    hasMore: {
      type: 'boolean',
      description: 'Whether Graph indicated more messages beyond this page',
      optional: true,
    },
    nextPageToken: {
      type: 'string',
      description: 'Token to pass as pageToken to fetch the next page, or null on the last page',
      optional: true,
    },
    attachments: {
      type: 'file[]',
      description: 'Uploaded attachments for convenience (flattened)',
    },
  },
}
