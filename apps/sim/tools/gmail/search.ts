import { createLogger } from '@sim/logger'
import type { GmailSearchParams, GmailToolResponse } from '@/tools/gmail/types'
import {
  createMessagesSummary,
  GMAIL_API_BASE,
  processMessageForSummary,
} from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GmailSearchTool')

export const gmailSearchTool: ToolConfig<GmailSearchParams, GmailToolResponse> = {
  id: 'gmail_search',
  name: 'Gmail Search',
  description: 'Search emails in Gmail',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Gmail API',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query for emails',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (e.g., 10, 25, 50)',
    },
  },

  request: {
    url: (params: GmailSearchParams) => {
      const searchParams = new URLSearchParams()
      searchParams.append('q', params.query)
      if (params.maxResults) {
        searchParams.append('maxResults', Number(params.maxResults).toString())
      }
      return `${GMAIL_API_BASE}/messages?${searchParams.toString()}`
    },
    method: 'GET',
    headers: (params: GmailSearchParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    const data = await response.json()

    if (!data.messages || data.messages.length === 0) {
      return {
        success: true,
        output: {
          content: 'No messages found matching your search query.',
          metadata: {
            results: [],
          },
        },
      }
    }

    try {
      // Fetch full message details for each result
      const messagePromises = data.messages.map(async (msg: any) => {
        const messageResponse = await fetch(`${GMAIL_API_BASE}/messages/${msg.id}?format=full`, {
          headers: {
            Authorization: `Bearer ${params?.accessToken || ''}`,
            'Content-Type': 'application/json',
          },
        })

        if (!messageResponse.ok) {
          throw new Error(`Failed to fetch details for message ${msg.id}`)
        }

        return await messageResponse.json()
      })

      const messages = await Promise.all(messagePromises)

      // Process all messages and create a summary
      const processedMessages = messages.map(processMessageForSummary)

      return {
        success: true,
        output: {
          content: createMessagesSummary(processedMessages),
          metadata: {
            results: processedMessages.map((msg) => ({
              id: msg.id,
              threadId: msg.threadId,
              subject: msg.subject,
              from: msg.from,
              date: msg.date,
              snippet: msg.snippet,
            })),
          },
        },
      }
    } catch (error: any) {
      logger.error('Error fetching message details:', error)
      return {
        success: true,
        output: {
          content: `Found ${data.messages.length} messages but couldn't retrieve all details: ${error.message || 'Unknown error'}`,
          metadata: {
            results: data.messages.map((msg: any) => ({
              id: msg.id,
              threadId: msg.threadId,
            })),
          },
        },
      }
    }
  },

  outputs: {
    content: { type: 'string', description: 'Search results summary' },
    metadata: {
      type: 'object',
      description: 'Search metadata',
      properties: {
        results: {
          type: 'array',
          description: 'Array of search results',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Gmail message ID' },
              threadId: { type: 'string', description: 'Gmail thread ID' },
              subject: { type: 'string', description: 'Email subject' },
              from: { type: 'string', description: 'Sender email address' },
              date: { type: 'string', description: 'Email date' },
              snippet: { type: 'string', description: 'Email snippet/preview' },
            },
          },
        },
      },
    },
  },
}

interface GmailSearchV2Response {
  success: boolean
  output: {
    results: Array<Record<string, any>>
  }
}

export const gmailSearchV2Tool: ToolConfig<GmailSearchParams, GmailSearchV2Response> = {
  id: 'gmail_search_v2',
  name: 'Gmail Search',
  description: 'Search emails in Gmail. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: gmailSearchTool.oauth,
  params: gmailSearchTool.params,
  request: gmailSearchTool.request,
  transformResponse: async (response: Response, params?: GmailSearchParams) => {
    const legacy = await gmailSearchTool.transformResponse!(response, params)
    if (!legacy.success) {
      return {
        success: false,
        output: { results: [] },
        error: legacy.error,
      }
    }

    const metadata = (legacy.output.metadata || {}) as any
    return {
      success: true,
      output: {
        results: metadata.results || [],
      },
    }
  },
  outputs: {
    results: { type: 'json', description: 'Array of search results' },
  },
}
