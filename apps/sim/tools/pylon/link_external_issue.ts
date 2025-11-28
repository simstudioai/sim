import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonLinkExternalIssue')

export interface PylonLinkExternalIssueParams {
  apiToken: string
  issueId: string
  externalIssueId: string
  source: string
}

export interface PylonLinkExternalIssueResponse {
  success: boolean
  output: {
    externalIssue: any
    metadata: {
      operation: 'link_external_issue'
      issueId: string
      externalIssueId: string
      source: string
    }
    success: boolean
  }
}

export const pylonLinkExternalIssueTool: ToolConfig<
  PylonLinkExternalIssueParams,
  PylonLinkExternalIssueResponse
> = {
  id: 'pylon_link_external_issue',
  name: 'Link External Issue in Pylon',
  description: 'Link an issue to an external system issue',
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
      description: 'The ID of the Pylon issue',
    },
    externalIssueId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the external issue',
    },
    source: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The source system (e.g., "jira", "linear", "github")',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/issues/${params?.issueId || ''}/external-issues`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      external_issue_id: params?.externalIssueId || '',
      source: params?.source || '',
    }),
  },

  transformResponse: async (response: Response, params?: PylonLinkExternalIssueParams) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'link_external_issue')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        externalIssue: data.data,
        metadata: {
          operation: 'link_external_issue' as const,
          issueId: params?.issueId || '',
          externalIssueId: params?.externalIssueId || '',
          source: params?.source || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Linked external issue data',
      properties: {
        externalIssue: { type: 'object', description: 'External issue link object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
