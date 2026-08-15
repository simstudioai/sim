import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

interface GmailListThreadsParams {
  accessToken: string
  maxResults?: number
  pageToken?: string
  query?: string
  labelIds?: string
}

interface GmailListThreadsResponse {
  success: boolean
  output: {
    threads: Array<{
      id: string
      snippet: string
      historyId: string
    }>
    resultSizeEstimate: number
    nextPageToken?: string
  }
}

export const gmailListThreadsV2Tool: ToolConfig<GmailListThreadsParams, GmailListThreadsResponse> =
  {
    id: 'gmail_list_threads_v2',
    name: 'Gmail List Threads',
    description: 'List email threads in a Gmail account',
    version: '2.0.0',

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
      maxResults: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of threads to return (default: 100, max: 500)',
      },
      pageToken: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page token for paginated results',
      },
      query: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Search query to filter threads (same syntax as Gmail search)',
      },
      labelIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated label IDs to filter threads by',
      },
    },

    request: {
      url: (params: GmailListThreadsParams) => {
        const searchParams = new URLSearchParams()
        if (params.maxResults) {
          searchParams.append('maxResults', Number(params.maxResults).toString())
        }
        if (params.pageToken) {
          searchParams.append('pageToken', params.pageToken)
        }
        if (params.query) {
          searchParams.append('q', params.query)
        }
        if (params.labelIds) {
          const labels = params.labelIds.split(',').map((l) => l.trim())
          for (const label of labels) {
            searchParams.append('labelIds', label)
          }
        }
        const qs = searchParams.toString()
        return `${GMAIL_API_BASE}/threads${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params: GmailListThreadsParams) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: { threads: [], resultSizeEstimate: 0 },
          error: data.error?.message || 'Failed to list threads',
        }
      }

      const threads = (data.threads || []).map((thread: Record<string, unknown>) => ({
        id: thread.id,
        snippet: thread.snippet ?? '',
        historyId: thread.historyId ?? '',
      }))

      return {
        success: true,
        output: {
          threads,
          resultSizeEstimate: data.resultSizeEstimate ?? 0,
          nextPageToken: data.nextPageToken ?? null,
        },
      }
    },

    outputs: {
      threads: {
        type: 'json',
        description: 'Array of thread objects with id, snippet, and historyId',
      },
      resultSizeEstimate: {
        type: 'number',
        description: 'Estimated total number of threads',
      },
      nextPageToken: {
        type: 'string',
        description: 'Token for fetching the next page of results',
        optional: true,
      },
    },
  }
