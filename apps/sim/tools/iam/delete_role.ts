import type { IAMDeleteRoleParams, IAMDeleteRoleResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const deleteRoleTool: ToolConfig<IAMDeleteRoleParams, IAMDeleteRoleResponse> = {
  id: 'iam_delete_role',
  name: 'IAM Delete Role',
  description: 'Delete an IAM role',
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
    roleName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the IAM role to delete',
    },
  },

  request: {
    url: '/api/tools/iam/delete-role',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      roleName: params.roleName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete IAM role')
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
