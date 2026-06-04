import type { IAMAddUserToGroupParams, IAMGroupMembershipResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const addUserToGroupTool: ToolConfig<IAMAddUserToGroupParams, IAMGroupMembershipResponse> = {
  id: 'iam_add_user_to_group',
  name: 'IAM Add User to Group',
  description: 'Add an IAM user to a group',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    userName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the IAM user',
    },
    groupName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the IAM group',
    },
  },

  request: {
    url: '/api/tools/iam/add-user-to-group',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      userName: params.userName,
      groupName: params.groupName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to add user to group')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
