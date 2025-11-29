import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonUpdateIssue')

export interface PylonUpdateIssueParams {
  apiToken: string
  issueId: string
  state?: string
  assigneeId?: string
  teamId?: string
  tags?: string
  customFields?: string
  customerPortalVisible?: boolean
  requesterId?: string
  accountId?: string
}

export interface PylonUpdateIssueResponse {
  success: boolean
  output: {
    issue: any
    metadata: {
      operation: 'update_issue'
      issueId: string
    }
    success: boolean
  }
}

export const pylonUpdateIssueTool: ToolConfig<PylonUpdateIssueParams, PylonUpdateIssueResponse> = {
  id: 'pylon_update_issue',
  name: 'Update Issue in Pylon',
  description: 'Update an existing issue',
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
      description: 'The ID of the issue to update',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Issue state',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User ID to assign issue to',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Team ID to assign issue to',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated tag IDs',
    },
    customFields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom fields as JSON object',
    },
    customerPortalVisible: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether issue is visible in customer portal',
    },
    requesterId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Requester user ID',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID to associate with issue',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/issues/${params.issueId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {}

      if (params.state !== undefined) body.state = params.state
      if (params.assigneeId !== undefined) body.assignee_id = params.assigneeId
      if (params.teamId !== undefined) body.team_id = params.teamId
      if (params.requesterId !== undefined) body.requester_id = params.requesterId
      if (params.accountId !== undefined) body.account_id = params.accountId
      if (params.customerPortalVisible !== undefined)
        body.customer_portal_visible = params.customerPortalVisible

      if (params.tags) {
        body.tags = params.tags.split(',').map((t) => t.trim())
      }

      if (params.customFields) {
        try {
          body.custom_fields = JSON.parse(params.customFields)
        } catch (error) {
          logger.warn('Failed to parse custom fields', { error })
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'update_issue')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        issue: data.data,
        metadata: {
          operation: 'update_issue' as const,
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
      description: 'Updated issue data',
      properties: {
        issue: { type: 'object', description: 'Updated issue object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
