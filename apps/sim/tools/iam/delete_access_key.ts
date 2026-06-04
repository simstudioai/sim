import type { IAMDeleteAccessKeyParams, IAMDeleteAccessKeyResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const deleteAccessKeyTool: ToolConfig<IAMDeleteAccessKeyParams, IAMDeleteAccessKeyResponse> =
  {
    id: 'iam_delete_access_key',
    name: 'IAM Delete Access Key',
    description: 'Delete an access key pair for an IAM user',
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
      accessKeyIdToDelete: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The access key ID to delete',
      },
      userName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The IAM user whose key to delete (defaults to current user)',
      },
    },

    request: {
      url: '/api/tools/iam/delete-access-key',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        region: params.region,
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        accessKeyIdToDelete: params.accessKeyIdToDelete,
        userName: params.userName,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete access key')
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
