import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonGetIssue')

export interface PylonGetIssueParams {
  apiToken: string
  issueId: string
}

export interface PylonGetIssueResponse {
  success: boolean
  output: {
    issue: any
    metadata: {
      operation: 'get_issue'
      issueId: string
    }
    success: boolean
  }
}

export const pylonGetIssueTool: ToolConfig<PylonGetIssueParams, PylonGetIssueResponse> = {
  id: 'pylon_get_issue',
  name: 'Get Issue from Pylon',
  description: 'Fetch a specific issue by ID',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    issueId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the issue to retrieve',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/issues/${params.issueId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'get_issue')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        issue: data.data,
        metadata: {
          operation: 'get_issue' as const,
          issueId: data.data?.id || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Issue data',
      properties: {
        issue: { type: 'object', description: 'Issue object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
