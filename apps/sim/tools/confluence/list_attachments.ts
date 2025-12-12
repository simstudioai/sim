import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListAttachmentsParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
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
      description: 'Maximum number of attachments to return (default: 25)',
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
        limit: String(params.limit || 25),
      })
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
    body: (params: ConfluenceListAttachmentsParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        pageId: params.pageId,
        limit: params.limit ? Number(params.limit) : 25,
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
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of retrieval' },
    attachments: { type: 'array', description: 'List of attachments' },
  },
}
