import type { STSGetCallerIdentityParams, STSGetCallerIdentityResponse } from '@/tools/sts/types'
import type { ToolConfig } from '@/tools/types'

export const getCallerIdentityTool: ToolConfig<
  STSGetCallerIdentityParams,
  STSGetCallerIdentityResponse
> = {
  id: 'sts_get_caller_identity',
  name: 'STS Get Caller Identity',
  description: 'Get details about the IAM user or role whose credentials are used to call the API',
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
  },

  request: {
    url: '/api/tools/sts/get-caller-identity',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get caller identity')
    }

    return {
      success: true,
      output: {
        account: data.account ?? '',
        arn: data.arn ?? '',
        userId: data.userId ?? '',
      },
    }
  },

  outputs: {
    account: { type: 'string', description: 'AWS account ID' },
    arn: { type: 'string', description: 'ARN of the calling entity' },
    userId: { type: 'string', description: 'Unique identifier of the calling entity' },
  },
}
