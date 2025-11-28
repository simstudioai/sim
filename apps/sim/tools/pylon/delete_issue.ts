import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonDeleteIssue')

export interface PylonDeleteIssueParams {
  apiToken: string
  issueId: string
}

export interface PylonDeleteIssueResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_issue'
      issueId: string
    }
    success: boolean
  }
}

export const pylonDeleteIssueTool: ToolConfig<PylonDeleteIssueParams, PylonDeleteIssueResponse> = {
  id: 'pylon_delete_issue',
  name: 'Delete Issue from Pylon',
  description: 'Remove an issue by ID',
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
      description: 'The ID of the issue to delete',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/issues/${params.issueId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: PylonDeleteIssueParams) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'delete_issue')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'delete_issue' as const,
          issueId: params?.issueId || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deletion result',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
