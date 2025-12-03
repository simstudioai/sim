import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonManageIssueFollowers')

export interface PylonManageIssueFollowersParams {
  apiToken: string
  issueId: string
  userIds?: string
  contactIds?: string
  operation?: string
}

export interface PylonManageIssueFollowersResponse {
  success: boolean
  output: {
    followers: any[]
    metadata: {
      operation: 'manage_issue_followers'
      issueId: string
      action: string
    }
    success: boolean
  }
}

export const pylonManageIssueFollowersTool: ToolConfig<
  PylonManageIssueFollowersParams,
  PylonManageIssueFollowersResponse
> = {
  id: 'pylon_manage_issue_followers',
  name: 'Manage Issue Followers in Pylon',
  description: 'Add or remove followers from an issue',
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
      description: 'The ID of the issue',
    },
    userIds: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated user IDs to add/remove',
    },
    contactIds: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated contact IDs to add/remove',
    },
    operation: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Operation to perform: "add" or "remove" (default: "add")',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/issues/${params?.issueId || ''}/followers`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {}

      if (params.userIds) {
        body.user_ids = params.userIds.split(',').map((id) => id.trim())
      }

      if (params.contactIds) {
        body.contact_ids = params.contactIds.split(',').map((id) => id.trim())
      }

      body.operation = params?.operation || 'add'

      return body
    },
  },

  transformResponse: async (response: Response, params?: PylonManageIssueFollowersParams) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'manage_issue_followers')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        followers: data.data || [],
        metadata: {
          operation: 'manage_issue_followers' as const,
          issueId: params?.issueId || '',
          action: params?.operation || 'add' || 'add',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated followers list',
      properties: {
        followers: { type: 'array', description: 'Array of follower objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
