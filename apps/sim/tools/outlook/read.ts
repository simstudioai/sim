import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  AttachmentDownloadBudget,
  readAttachmentJson,
  rethrowAttachmentDownloadError,
} from '@/lib/uploads/utils/attachment-download-budget'
import type {
  CleanedOutlookMessage,
  OutlookAttachment,
  OutlookMessagesResponse,
  OutlookReadParams,
  OutlookReadResponse,
} from '@/tools/outlook/types'
import { OUTLOOK_MESSAGE_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import { cleanOutlookMessage } from '@/tools/outlook/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

interface OutlookDownloadAttachmentMetadata {
  '@odata.type'?: string
  id: string
  name?: string
  contentType?: string
  size?: number
}

/** Caller hooks for {@link downloadAttachments}; omitted options keep the tool's default behavior. */
export interface OutlookAttachmentDownloadOptions {
  /** Fetch implementation, e.g. a retrying fetch for background polling. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
  /** Skip attachments that exceed the byte budget and keep the rest, instead of throwing. */
  keepPartialOnLimit?: boolean
  /** Report Graph's declared attachment size, falling back to the downloaded byte length. */
  preferMetadataSize?: boolean
  /** Called when Graph answers a metadata or content request with a non-OK status. */
  onFailure?: (stage: 'metadata' | 'content', status: number) => void
  /** Called for each attachment skipped because it exceeds the byte budget (with keepPartialOnLimit). */
  onSkip?: (attachmentName: string, declaredSize: number | undefined) => void
}

/** Fetch metadata separately from raw file bytes, sharing the budget across messages. */
export async function downloadAttachments(
  messageId: string,
  accessToken: string,
  budget = new AttachmentDownloadBudget(),
  options: OutlookAttachmentDownloadOptions = {}
): Promise<OutlookAttachment[]> {
  const fetchImpl = options.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init))
  const attachments: OutlookAttachment[] = []
  const path = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments`
  const handleError = (error: unknown, attachment?: OutlookDownloadAttachmentMetadata) => {
    if (options.keepPartialOnLimit && isPayloadSizeLimitError(error)) {
      budget.signal?.throwIfAborted()
      options.onSkip?.(attachment?.name || 'attachment', attachment?.size)
      return
    }
    rethrowAttachmentDownloadError(error, budget.signal)
  }
  try {
    budget.signal?.throwIfAborted()
    const response = await fetchImpl(`${path}?$select=id,name,contentType,size`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: budget.signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      budget.signal?.throwIfAborted()
      options.onFailure?.('metadata', response.status)
      return attachments
    }
    const data = await readAttachmentJson<{ value?: OutlookDownloadAttachmentMetadata[] }>(
      response,
      'Outlook attachment metadata',
      budget.signal
    )
    for (const attachment of data.value ?? []) {
      if (attachment['@odata.type'] !== '#microsoft.graph.fileAttachment') continue
      try {
        if (attachment.size !== undefined) budget.assertSize(attachment.size, 'Outlook attachments')
        budget.signal?.throwIfAborted()
        const content = await fetchImpl(`${path}/${encodeURIComponent(attachment.id)}/$value`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: budget.signal,
        })
        if (!content.ok) {
          await content.body?.cancel()
          budget.signal?.throwIfAborted()
          options.onFailure?.('content', content.status)
          continue
        }
        const buffer = await budget.read(content, 'Outlook attachments')
        attachments.push({
          name: attachment.name || 'attachment',
          data: buffer,
          contentType:
            attachment.contentType ||
            content.headers.get('content-type') ||
            'application/octet-stream',
          size: options.preferMetadataSize
            ? (attachment.size ?? buffer.byteLength)
            : buffer.byteLength,
        })
      } catch (error) {
        handleError(error, attachment)
      }
    }
  } catch (error) {
    handleError(error)
  }
  return attachments
}

export const outlookReadTool: ToolConfig<OutlookReadParams, OutlookReadResponse> = {
  id: 'outlook_read',
  name: 'Outlook Read',
  description: 'Read emails from Outlook',
  version: '1.0.0',
  assistant: { effect: 'read', version: 1 },

  oauth: {
    required: true,
    provider: 'outlook',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Outlook',
    },
    folder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Folder ID to read emails from (e.g., "Inbox", "Drafts", or a folder ID)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of emails to retrieve (default: 1, max: 10)',
    },
    includeAttachments: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to download and include email attachments',
    },
  },

  request: {
    url: (params) => {
      // Set max results (default to 1 for simplicity, max 10) with no negative values
      const maxResults = params.maxResults
        ? Math.max(1, Math.min(Math.abs(Number(params.maxResults)), 10))
        : 1

      // If folder is provided, read from that specific folder
      if (params.folder) {
        return `https://graph.microsoft.com/v1.0/me/mailFolders/${safeUrlPathSegment(params.folder, 'folder', { allowSeparators: true })}/messages?$top=${maxResults}&$orderby=createdDateTime desc`
      }

      // Otherwise fetch from all messages (default behavior)
      return `https://graph.microsoft.com/v1.0/me/messages?$top=${maxResults}&$orderby=createdDateTime desc`
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
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
    params?: OutlookReadParams,
    context?: ToolResponseContext
  ) => {
    const budget = new AttachmentDownloadBudget(context)
    context?.signal?.throwIfAborted()
    const data: OutlookMessagesResponse = await response.json()

    // Microsoft Graph API returns messages in a 'value' array
    const messages = data.value || []

    if (messages.length === 0) {
      return {
        success: true,
        output: {
          message: 'No mail found.',
          results: [],
        },
      }
    }

    // Clean up the message data to only include essential fields
    const cleanedMessages: CleanedOutlookMessage[] = []
    for (const message of messages) {
      context?.signal?.throwIfAborted()
      // Download attachments if requested
      let attachments: OutlookAttachment[] | undefined
      if (params?.includeAttachments && message.hasAttachments && params?.accessToken) {
        try {
          attachments = await downloadAttachments(message.id, params.accessToken, budget)
        } catch (error) {
          rethrowAttachmentDownloadError(error, context?.signal)
          // Continue without attachments rather than failing the entire request
        }
      }

      cleanedMessages.push({ ...cleanOutlookMessage(message), attachments: attachments || [] })
    }

    // Flatten all attachments from all emails to top level for FileToolProcessor
    const allAttachments: OutlookAttachment[] = []
    for (const email of cleanedMessages) {
      if (email.attachments && email.attachments.length > 0) {
        allAttachments.push(...email.attachments)
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully read ${cleanedMessages.length} email(s).`,
        results: cleanedMessages,
        attachments: allAttachments,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'array',
      description: 'Array of email message objects',
      items: {
        type: 'object',
        properties: OUTLOOK_MESSAGE_OUTPUT_PROPERTIES,
      },
    },
    attachments: { type: 'file[]', description: 'All email attachments flattened from all emails' },
  },
}
