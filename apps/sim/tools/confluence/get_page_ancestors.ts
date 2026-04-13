import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetPageAncestorsParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  cloudId?: string
}

export interface ConfluenceGetPageAncestorsResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    ancestors: Array<{
      id: string
      title: string
      status: string | null
      spaceId: string | null
      webUrl: string | null
    }>
  }
}

export const confluenceGetPageAncestorsTool: ToolConfig<
  ConfluenceGetPageAncestorsParams,
  ConfluenceGetPageAncestorsResponse
> = {
  id: 'confluence_get_page_ancestors',
  name: 'Confluence Get Page Ancestors',
  description:
    'Get the ancestor (parent) pages of a specific Confluence page. Returns the full hierarchy from the page up to the root.',
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
      description: 'The ID of the page to get ancestors for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of ancestors to return (default: 25, max: 250)',
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
    url: () => '/api/tools/confluence/page-ancestors',
    method: 'POST',
    headers: (params: ConfluenceGetPageAncestorsParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceGetPageAncestorsParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      pageId: params.pageId?.trim(),
      limit: params.limit ? Number(params.limit) : 25,
      cloudId: params.cloudId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pageId: data.pageId ?? '',
        ancestors: data.ancestors ?? [],
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pageId: {
      type: 'string',
      description: 'ID of the page whose ancestors were retrieved',
    },
    ancestors: {
      type: 'array',
      description: 'Array of ancestor pages, ordered from direct parent to root',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Ancestor page ID' },
          title: { type: 'string', description: 'Ancestor page title' },
          status: { type: 'string', description: 'Page status', optional: true },
          spaceId: { type: 'string', description: 'Space ID', optional: true },
          webUrl: { type: 'string', description: 'URL to view the page', optional: true },
        },
      },
    },
  },
}
