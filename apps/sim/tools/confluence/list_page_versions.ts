import { TIMESTAMP_OUTPUT, VERSION_OUTPUT_PROPERTIES } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListPageVersionsParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListPageVersionsResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    versions: Array<{
      number: number
      message: string | null
      minorEdit: boolean
      authorId: string | null
      createdAt: string | null
    }>
    nextCursor: string | null
  }
}

export const confluenceListPageVersionsTool: ToolConfig<
  ConfluenceListPageVersionsParams,
  ConfluenceListPageVersionsResponse
> = {
  id: 'confluence_list_page_versions',
  name: 'Confluence List Page Versions',
  description: 'List all versions (revision history) of a Confluence page.',
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
      description: 'The ID of the page to get versions for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of versions to return (default: 50, max: 250)',
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
    url: () => '/api/tools/confluence/page-versions',
    method: 'POST',
    headers: (params: ConfluenceListPageVersionsParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceListPageVersionsParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      pageId: params.pageId?.trim(),
      limit: params.limit ? Number(params.limit) : 50,
      cursor: params.cursor,
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
        versions: data.versions ?? [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pageId: { type: 'string', description: 'ID of the page' },
    versions: {
      type: 'array',
      description: 'Array of page versions',
      items: {
        type: 'object',
        properties: VERSION_OUTPUT_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
