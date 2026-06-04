import type { IAMAttachPolicyResponse, IAMAttachUserPolicyParams } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const attachUserPolicyTool: ToolConfig<IAMAttachUserPolicyParams, IAMAttachPolicyResponse> =
  {
    id: 'iam_attach_user_policy',
    name: 'IAM Attach User Policy',
    description: 'Attach a managed policy to an IAM user',
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
        description: 'The ARN of the managed policy to attach',
      },
    },

    request: {
      url: '/api/tools/iam/attach-user-policy',
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
        throw new Error(data.error || 'Failed to attach policy to user')
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
