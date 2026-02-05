import {
  CONTENT_BODY_OUTPUT_PROPERTIES,
  PAGE_ITEM_PROPERTIES,
  TIMESTAMP_OUTPUT,
} from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListPagesInSpaceParams {
  accessToken: string
  domain: string
  spaceId: string
  limit?: number
  status?: string
  bodyFormat?: string
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListPagesInSpaceResponse {
  success: boolean
  output: {
    ts: string
    pages: Array<{
      id: string
      title: string
      status: string | null
      spaceId: string | null
      parentId: string | null
      authorId: string | null
      createdAt: string | null
      version: {
        number: number
        message?: string
        createdAt?: string
      } | null
      body: {
        storage?: { value: string }
      } | null
      webUrl: string | null
    }>
    nextCursor: string | null
  }
}

export const confluenceListPagesInSpaceTool: ToolConfig<
  ConfluenceListPagesInSpaceParams,
  ConfluenceListPagesInSpaceResponse
> = {
  id: 'confluence_list_pages_in_space',
  name: 'Confluence List Pages in Space',
  description:
    'List all pages within a specific Confluence space. Supports pagination and filtering by status.',
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
    spaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the Confluence space to list pages from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of pages to return (default: 50, max: 250)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter pages by status: current, archived, trashed, or draft',
    },
    bodyFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Format for page body content: storage, atlas_doc_format, or view. If not specified, body is not included.',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response to get the next page of results',
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
    url: () => '/api/tools/confluence/space-pages',
    method: 'POST',
    headers: (params: ConfluenceListPagesInSpaceParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceListPagesInSpaceParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      spaceId: params.spaceId?.trim(),
      limit: params.limit ? Number(params.limit) : 50,
      status: params.status,
      bodyFormat: params.bodyFormat,
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
        pages: data.pages ?? [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pages: {
      type: 'array',
      description: 'Array of pages in the space',
      items: {
        type: 'object',
        properties: {
          ...PAGE_ITEM_PROPERTIES,
          body: {
            type: 'object',
            description: 'Page body content (if bodyFormat was specified)',
            properties: CONTENT_BODY_OUTPUT_PROPERTIES,
            optional: true,
          },
          webUrl: {
            type: 'string',
            description: 'URL to view the page in Confluence',
            optional: true,
          },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
