import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonCreateIssue')

export interface PylonCreateIssueParams {
  apiToken: string
  title: string
  bodyHtml: string
  accountId?: string
  assigneeId?: string
  teamId?: string
  requesterId?: string
  requesterEmail?: string
  priority?: string
  tags?: string
  customFields?: string
  attachmentUrls?: string
}

export interface PylonCreateIssueResponse {
  success: boolean
  output: {
    issue: any
    metadata: {
      operation: 'create_issue'
      issueId: string
    }
    success: boolean
  }
}

export const pylonCreateIssueTool: ToolConfig<PylonCreateIssueParams, PylonCreateIssueResponse> = {
  id: 'pylon_create_issue',
  name: 'Create Issue in Pylon',
  description: 'Create a new issue with specified properties',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Issue title',
    },
    bodyHtml: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Issue body in HTML format',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID to associate with issue',
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
    requesterId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Requester user ID (alternative to requester_email)',
    },
    requesterEmail: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Requester email address (alternative to requester_id)',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Issue priority',
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
    attachmentUrls: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated attachment URLs',
    },
  },

  request: {
    url: () => buildPylonUrl('/issues'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {
        title: params.title,
        body_html: params.bodyHtml,
      }

      if (params.accountId) body.account_id = params.accountId
      if (params.assigneeId) body.assignee_id = params.assigneeId
      if (params.teamId) body.team_id = params.teamId
      if (params.requesterId) body.requester_id = params.requesterId
      if (params.requesterEmail) body.requester_email = params.requesterEmail
      if (params.priority) body.priority = params.priority

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

      if (params.attachmentUrls) {
        body.attachment_urls = params.attachmentUrls.split(',').map((url) => url.trim())
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'create_issue')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        issue: data.data,
        metadata: {
          operation: 'create_issue' as const,
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
      description: 'Created issue data',
      properties: {
        issue: { type: 'object', description: 'Created issue object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
