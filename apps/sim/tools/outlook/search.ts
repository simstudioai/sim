import type {
  CleanedOutlookMessage,
  OutlookMessage,
  OutlookMessagesResponse,
  OutlookSearchParams,
  OutlookSearchResponse,
} from '@/tools/outlook/types'
import { OUTLOOK_MESSAGE_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookSearchTool: ToolConfig<OutlookSearchParams, OutlookSearchResponse> = {
  id: 'outlook_search',
  name: 'Outlook Search',
  description: 'Search Outlook messages using a free-text query (Microsoft Graph $search)',
  version: '1.0.0',

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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search text matched against the subject, body, sender, and recipients of messages',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to retrieve (default: 10, max: 25)',
    },
  },

  request: {
    url: (params) => {
      const query = params.query?.trim()
      if (!query) {
        throw new Error('A search query is required')
      }
      const maxResults = params.maxResults
        ? Math.max(1, Math.min(Math.abs(Number(params.maxResults)), 25))
        : 10
      const searchParams = new URLSearchParams({
        $search: `"${query}"`,
        $top: String(maxResults),
      })
      return `https://graph.microsoft.com/v1.0/me/messages?${searchParams.toString()}`
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

  transformResponse: async (response: Response) => {
    const data: OutlookMessagesResponse = await response.json()
    const messages = data.value || []

    if (messages.length === 0) {
      return {
        success: true,
        output: {
          message: 'No matching messages found.',
          results: [],
        },
      }
    }

    const cleanedMessages: CleanedOutlookMessage[] = messages.map((message: OutlookMessage) => ({
      id: message.id,
      subject: message.subject,
      bodyPreview: message.bodyPreview,
      body: {
        contentType: message.body?.contentType,
        content: message.body?.content,
      },
      sender: {
        name: message.sender?.emailAddress?.name,
        address: message.sender?.emailAddress?.address,
      },
      from: {
        name: message.from?.emailAddress?.name,
        address: message.from?.emailAddress?.address,
      },
      toRecipients:
        message.toRecipients?.map((recipient) => ({
          name: recipient.emailAddress?.name,
          address: recipient.emailAddress?.address,
        })) || [],
      ccRecipients:
        message.ccRecipients?.map((recipient) => ({
          name: recipient.emailAddress?.name,
          address: recipient.emailAddress?.address,
        })) || [],
      receivedDateTime: message.receivedDateTime,
      sentDateTime: message.sentDateTime,
      hasAttachments: message.hasAttachments,
      isRead: message.isRead,
      importance: message.importance,
    }))

    return {
      success: true,
      output: {
        message: `Found ${cleanedMessages.length} matching message(s).`,
        results: cleanedMessages,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'array',
      description: 'Array of matching email message objects',
      items: {
        type: 'object',
        properties: OUTLOOK_MESSAGE_OUTPUT_PROPERTIES,
      },
    },
  },
}
