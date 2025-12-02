import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonSearchIssues')

export interface PylonSearchIssuesParams {
  apiToken: string
  filter: string
  cursor?: string
  limit?: number
}

export interface PylonSearchIssuesResponse {
  success: boolean
  output: {
    issues: any[]
    pagination?: {
      cursor?: string
      has_next_page?: boolean
    }
    metadata: {
      operation: 'search_issues'
      totalReturned: number
    }
    success: boolean
  }
}

export const pylonSearchIssuesTool: ToolConfig<PylonSearchIssuesParams, PylonSearchIssuesResponse> =
  {
    id: 'pylon_search_issues',
    name: 'Search Issues in Pylon',
    description: 'Query issues using filters',
    version: '1.0.0',

    params: {
      apiToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Pylon API token',
      },
      filter: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Filter criteria as JSON string',
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Pagination cursor for next page of results',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-only',
        description: 'Maximum number of results to return',
      },
    },

    request: {
      url: () => buildPylonUrl('/issues/search'),
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: any = {}

        if (params.filter) {
          try {
            body.filter = JSON.parse(params.filter)
          } catch (error) {
            logger.warn('Failed to parse filter', { error })
          }
        }

        if (params.cursor) body.cursor = params.cursor
        if (params.limit !== undefined) body.limit = params.limit

        return body
      },
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const data = await response.json()
        handlePylonError(data, response.status, 'search_issues')
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          issues: data.data || [],
          pagination: data.pagination,
          metadata: {
            operation: 'search_issues' as const,
            totalReturned: data.data?.length || 0,
          },
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      output: {
        type: 'object',
        description: 'Search results',
        properties: {
          issues: { type: 'array', description: 'Array of issue objects' },
          pagination: { type: 'object', description: 'Pagination metadata' },
          metadata: { type: 'object', description: 'Operation metadata' },
          success: { type: 'boolean', description: 'Operation success' },
        },
      },
    },
  }
