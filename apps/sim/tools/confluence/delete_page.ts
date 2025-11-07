import type { ToolConfig } from '@/tools/types'

export interface ConfluenceDeletePageParams {
  accessToken: string
  domain: string
  pageId: string
  cloudId?: string
}

export interface ConfluenceDeletePageResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    deleted: boolean
  }
}

export const confluenceDeletePageTool: ToolConfig<
  ConfluenceDeletePageParams,
  ConfluenceDeletePageResponse
> = {
  id: 'confluence_delete_page',
  name: 'Confluence Delete Page',
  description: 'Delete a Confluence page (moves it to trash where it can be restored).',
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
      description: 'Confluence page ID to delete',
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
    url: (params: ConfluenceDeletePageParams) => '/api/tools/confluence/page',
    method: 'DELETE',
    headers: (params: ConfluenceDeletePageParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceDeletePageParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
        cloudId: params.cloudId,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pageId: data.pageId || '',
        deleted: true,
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of deletion' },
    pageId: { type: 'string', description: 'Deleted page ID' },
    deleted: { type: 'boolean', description: 'Deletion status' },
  },
}
