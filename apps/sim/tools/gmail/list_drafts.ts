import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

interface GmailListDraftsParams {
  accessToken: string
  maxResults?: number
  pageToken?: string
  query?: string
}

interface GmailListDraftsResponse {
  success: boolean
  output: {
    drafts: Array<{
      id: string
      messageId: string
      threadId: string
    }>
    resultSizeEstimate: number
    nextPageToken?: string
  }
}

export const gmailListDraftsV2Tool: ToolConfig<GmailListDraftsParams, GmailListDraftsResponse> = {
  id: 'gmail_list_drafts_v2',
  name: 'Gmail List Drafts',
  description: 'List all drafts in a Gmail account',
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
      description: 'Maximum number of drafts to return (default: 100, max: 500)',
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
      description: 'Search query to filter drafts (same syntax as Gmail search)',
    },
  },

  request: {
    url: (params: GmailListDraftsParams) => {
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
      const qs = searchParams.toString()
      return `${GMAIL_API_BASE}/drafts${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: GmailListDraftsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: { drafts: [], resultSizeEstimate: 0 },
        error: data.error?.message || 'Failed to list drafts',
      }
    }

    const drafts = (data.drafts || []).map((draft: Record<string, unknown>) => ({
      id: draft.id,
      messageId: (draft.message as Record<string, unknown>)?.id ?? null,
      threadId: (draft.message as Record<string, unknown>)?.threadId ?? null,
    }))

    return {
      success: true,
      output: {
        drafts,
        resultSizeEstimate: data.resultSizeEstimate ?? 0,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    drafts: {
      type: 'json',
      description: 'Array of draft objects with id, messageId, and threadId',
    },
    resultSizeEstimate: {
      type: 'number',
      description: 'Estimated total number of drafts',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
