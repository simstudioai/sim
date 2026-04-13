import type { IAMCreateAccessKeyParams, IAMCreateAccessKeyResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const createAccessKeyTool: ToolConfig<IAMCreateAccessKeyParams, IAMCreateAccessKeyResponse> =
  {
    id: 'iam_create_access_key',
    name: 'IAM Create Access Key',
    description: 'Create a new access key pair for an IAM user',
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
        required: false,
        visibility: 'user-or-llm',
        description: 'The IAM user to create the key for (defaults to current user)',
      },
    },

    request: {
      url: '/api/tools/iam/create-access-key',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        region: params.region,
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        userName: params.userName,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create access key')
      }

      return {
        success: true,
        output: {
          message: data.message ?? '',
          accessKeyId: data.accessKeyId ?? '',
          secretAccessKey: data.secretAccessKey ?? '',
          userName: data.userName ?? '',
          status: data.status ?? '',
          createDate: data.createDate ?? null,
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Operation status message' },
      accessKeyId: { type: 'string', description: 'The new access key ID' },
      secretAccessKey: {
        type: 'string',
        description: 'The new secret access key (only shown once)',
      },
      userName: { type: 'string', description: 'The user the key was created for' },
      status: { type: 'string', description: 'Status of the access key (Active)' },
      createDate: { type: 'string', description: 'Date the key was created', optional: true },
    },
  }
