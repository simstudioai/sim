import type { IAMDetachPolicyResponse, IAMDetachRolePolicyParams } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const detachRolePolicyTool: ToolConfig<IAMDetachRolePolicyParams, IAMDetachPolicyResponse> =
  {
    id: 'iam_detach_role_policy',
    name: 'IAM Detach Role Policy',
    description: 'Remove a managed policy from an IAM role',
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
        description: 'The name of the IAM role',
      },
      policyArn: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ARN of the managed policy to detach',
      },
    },

    request: {
      url: '/api/tools/iam/detach-role-policy',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        region: params.region,
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        roleName: params.roleName,
        policyArn: params.policyArn,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to detach policy from role')
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
