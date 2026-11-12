import { createLogger } from '@sim/logger'
import type { GmailMessage, GmailSearchParams, GmailToolResponse } from '@/tools/gmail/types'
import {
  createMessagesSummary,
  GMAIL_API_BASE,
  processMessageForSummary,
} from '@/tools/gmail/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('GmailSearchTool')

/** Caps parallel messages.get calls so a 500-result page never fans out all at once. */
const MESSAGE_FETCH_CONCURRENCY = 10

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
      description:
        'Maximum number of results to return (e.g., 10, 25, 50; Gmail default: 100, max: 500)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous search (nextPageToken) to fetch the next page',
    },
  },

  request: {
    url: (params: GmailSearchParams) => {
      const searchParams = new URLSearchParams()
      searchParams.append('q', params.query)
      if (params.maxResults) {
        searchParams.append('maxResults', Number(params.maxResults).toString())
      }
      if (params.pageToken) {
        searchParams.append('pageToken', params.pageToken)
      }
      return `${GMAIL_API_BASE}/messages?${searchParams.toString()}`
    },
    method: 'GET',
    headers: (params: GmailSearchParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params, context?: ToolResponseContext) => {
    const data = await response.json()
    const nextPageToken: string | null = data.nextPageToken ?? null
    const resultSizeEstimate: number | null = data.resultSizeEstimate ?? null

    if (!data.messages || data.messages.length === 0) {
      return {
        success: true,
        output: {
          content: 'No messages found matching your search query.',
          metadata: {
            results: [],
            nextPageToken,
            resultSizeEstimate,
          },
        },
      }
    }

    try {
      const listed: Array<{ id: string; threadId: string }> = data.messages
      const messages: GmailMessage[] = []
      for (let i = 0; i < listed.length; i += MESSAGE_FETCH_CONCURRENCY) {
        context?.signal?.throwIfAborted()
        const batch = await Promise.all(
          listed.slice(i, i + MESSAGE_FETCH_CONCURRENCY).map(async (msg) => {
            const messageResponse = await fetch(
              `${GMAIL_API_BASE}/messages/${safeUrlPathSegment(msg.id, 'messageId')}?format=full`,
              {
                headers: {
                  Authorization: `Bearer ${params?.accessToken || ''}`,
                  'Content-Type': 'application/json',
                },
                signal: context?.signal,
              }
            )

            if (!messageResponse.ok) {
              await messageResponse.body?.cancel()
              throw new Error(`Failed to fetch details for message ${msg.id}`)
            }

            return (await messageResponse.json()) as GmailMessage
          })
        )
        messages.push(...batch)
      }

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
              to: msg.to,
              cc: msg.cc ?? null,
              bcc: msg.bcc ?? null,
              replyTo: msg.replyTo ?? null,
              rfcMessageId: msg.rfcMessageId ?? null,
              inReplyTo: msg.inReplyTo ?? null,
              references: msg.references ?? null,
              internalDate: msg.internalDate ?? null,
            })),
            nextPageToken,
            resultSizeEstimate,
          },
        },
      }
    } catch (error: any) {
      if (context?.signal?.aborted) throw error
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
            nextPageToken,
            resultSizeEstimate,
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
              to: { type: 'string', description: 'Recipient email address', optional: true },
              cc: { type: 'string', description: 'Cc recipients', optional: true },
              bcc: {
                type: 'string',
                description: 'Bcc recipients (only on messages you sent or drafted)',
                optional: true,
              },
              replyTo: { type: 'string', description: 'Reply-To header', optional: true },
              rfcMessageId: {
                type: 'string',
                description: 'RFC Message-ID header (not the Gmail message id)',
                optional: true,
              },
              inReplyTo: { type: 'string', description: 'In-Reply-To header', optional: true },
              references: { type: 'string', description: 'References header', optional: true },
              internalDate: {
                type: 'string',
                description: 'Gmail internal creation timestamp in epoch milliseconds',
                optional: true,
              },
            },
          },
        },
        nextPageToken: {
          type: 'string',
          description: 'Token for fetching the next page of results',
          optional: true,
        },
        resultSizeEstimate: {
          type: 'number',
          description: 'Estimated total number of results',
          optional: true,
        },
      },
    },
  },
}

interface GmailSearchV2Response {
  success: boolean
  output: {
    results: Array<Record<string, any>>
    nextPageToken?: string | null
    resultSizeEstimate?: number | null
  }
}

export const gmailSearchV2Tool: ToolConfig<GmailSearchParams, GmailSearchV2Response> = {
  id: 'gmail_search_v2',
  name: 'Gmail Search',
  description: 'Search emails in Gmail.',
  version: '2.0.0',
  oauth: gmailSearchTool.oauth,
  params: gmailSearchTool.params,
  request: gmailSearchTool.request,
  transformResponse: async (
    response: Response,
    params?: GmailSearchParams,
    context?: ToolResponseContext
  ) => {
    const legacy = await gmailSearchTool.transformResponse!(response, params, context)
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
        nextPageToken: metadata.nextPageToken ?? null,
        resultSizeEstimate: metadata.resultSizeEstimate ?? null,
      },
    }
  },
  outputs: {
    results: {
      type: 'json',
      description:
        'Array of search results (id, threadId, subject, from, to, cc, bcc, replyTo, date, snippet, rfcMessageId, inReplyTo, references, internalDate)',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
    resultSizeEstimate: {
      type: 'number',
      description: 'Estimated total number of results',
      optional: true,
    },
  },
}
