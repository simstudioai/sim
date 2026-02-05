import { ATTACHMENTS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListAttachmentsParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListAttachmentsResponse {
  success: boolean
  output: {
    ts: string
    attachments: Array<{
      id: string
      title: string
      fileSize: number
      mediaType: string
      downloadUrl: string
    }>
    nextCursor: string | null
  }
}

export const confluenceListAttachmentsTool: ToolConfig<
  ConfluenceListAttachmentsParams,
  ConfluenceListAttachmentsResponse
> = {
  id: 'confluence_list_attachments',
  name: 'Confluence List Attachments',
  description: 'List all attachments on a Confluence page.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Confluence',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Confluence page ID to list attachments from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of attachments to return (default: 50, max: 250)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: ConfluenceListAttachmentsParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
        limit: String(params.limit || 50),
      })
      if (params.cursor) {
        query.set('cursor', params.cursor)
      }
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return `/api/tools/confluence/attachments?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceListAttachmentsParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        attachments: data.attachments || [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    attachments: ATTACHMENTS_OUTPUT,
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
