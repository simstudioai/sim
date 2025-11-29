import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonListIssues')

export interface PylonListIssuesParams {
  apiToken: string
  startTime: string
  endTime: string
  cursor?: string
}

export interface PylonListIssuesResponse {
  success: boolean
  output: {
    issues: any[]
    pagination?: {
      cursor?: string
      has_next_page?: boolean
    }
    metadata: {
      operation: 'list_issues'
      totalReturned: number
    }
    success: boolean
  }
}

export const pylonListIssuesTool: ToolConfig<PylonListIssuesParams, PylonListIssuesResponse> = {
  id: 'pylon_list_issues',
  name: 'List Issues in Pylon',
  description: 'Retrieve a list of issues within a specified time range',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    startTime: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Start time in RFC3339 format (e.g., 2024-01-01T00:00:00Z)',
    },
    endTime: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'End time in RFC3339 format (e.g., 2024-01-31T23:59:59Z)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Pagination cursor for next page of results',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(buildPylonUrl('/issues'))
      url.searchParams.append('start_time', params.startTime)
      url.searchParams.append('end_time', params.endTime)
      if (params.cursor) {
        url.searchParams.append('cursor', params.cursor)
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'list_issues')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        issues: data.data || [],
        pagination: data.pagination,
        metadata: {
          operation: 'list_issues' as const,
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
      description: 'List of issues',
      properties: {
        issues: { type: 'array', description: 'Array of issue objects' },
        pagination: { type: 'object', description: 'Pagination metadata' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
