import type {
  CirclebackCompanyListResponse,
  CirclebackListCompaniesParams,
} from '@/tools/circleback/types'
import {
  appendListParams,
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  parseNextCursor,
  throwCirclebackError,
  toIdList,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'

export const listCompaniesTool: ToolConfig<
  CirclebackListCompaniesParams,
  CirclebackCompanyListResponse
> = {
  id: 'circleback_list_companies',
  name: 'Circleback List Companies',
  description:
    'Lists the companies whose people attend the authenticated user meetings, with optional tag filters.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    tagIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag IDs. Filters companies to those with meetings so tagged',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${CIRCLEBACK_API_BASE}/companies`)
      appendListParams(url, 'tagIds', toIdList(params.tagIds))
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()
    const nextCursor = parseNextCursor(response)

    return {
      success: true,
      output: {
        companies: (Array.isArray(data) ? data : []).map(
          (company: {
            id?: number
            name?: string | null
            avatarUrl?: string | null
            domain?: string
          }) => ({
            id: company.id ?? 0,
            name: company.name ?? null,
            avatarUrl: company.avatarUrl ?? null,
            domain: company.domain ?? '',
          })
        ),
        nextCursor,
        hasMore: nextCursor !== null,
      },
    }
  },

  outputs: {
    companies: {
      type: 'array',
      description: 'The companies on this page',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The unique identifier of the company' },
          name: { type: 'string', nullable: true, description: 'The company name' },
          avatarUrl: {
            type: 'string',
            nullable: true,
            description: 'The URL of the company logo image',
          },
          domain: { type: 'string', description: 'The company website domain' },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page of companies is available',
    },
  },
}
