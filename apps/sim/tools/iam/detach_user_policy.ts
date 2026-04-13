import type { IAMDetachPolicyResponse, IAMDetachUserPolicyParams } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const detachUserPolicyTool: ToolConfig<IAMDetachUserPolicyParams, IAMDetachPolicyResponse> =
  {
    id: 'iam_detach_user_policy',
    name: 'IAM Detach User Policy',
    description: 'Remove a managed policy from an IAM user',
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
      policyArn: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ARN of the managed policy to detach',
      },
    },

    request: {
      url: '/api/tools/iam/detach-user-policy',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        region: params.region,
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        userName: params.userName,
        policyArn: params.policyArn,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to detach policy from user')
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
