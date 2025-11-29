import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonListIssueFollowers')

export interface PylonListIssueFollowersParams {
  apiToken: string
  issueId: string
}

export interface PylonListIssueFollowersResponse {
  success: boolean
  output: {
    followers: any[]
    metadata: {
      operation: 'list_issue_followers'
      issueId: string
      totalFollowers: number
    }
    success: boolean
  }
}

export const pylonListIssueFollowersTool: ToolConfig<
  PylonListIssueFollowersParams,
  PylonListIssueFollowersResponse
> = {
  id: 'pylon_list_issue_followers',
  name: 'List Issue Followers in Pylon',
  description: 'Get list of followers for a specific issue',
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
  },

  request: {
    url: (params) => buildPylonUrl(`/issues/${params?.issueId || ''}/followers`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: PylonListIssueFollowersParams) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'list_issue_followers')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        followers: data.data || [],
        metadata: {
          operation: 'list_issue_followers' as const,
          issueId: params?.issueId || '',
          totalFollowers: data.data?.length || 0,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Followers list',
      properties: {
        followers: { type: 'array', description: 'Array of follower objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
