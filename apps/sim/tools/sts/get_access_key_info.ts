import type { STSGetAccessKeyInfoParams, STSGetAccessKeyInfoResponse } from '@/tools/sts/types'
import type { ToolConfig } from '@/tools/types'

export const getAccessKeyInfoTool: ToolConfig<
  STSGetAccessKeyInfoParams,
  STSGetAccessKeyInfoResponse
> = {
  id: 'sts_get_access_key_info',
  name: 'STS Get Access Key Info',
  description: 'Get the AWS account ID associated with an access key',
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
    targetAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The access key ID to look up',
    },
  },

  request: {
    url: '/api/tools/sts/get-access-key-info',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      targetAccessKeyId: params.targetAccessKeyId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get access key info')
    }

    return {
      success: true,
      output: {
        account: data.account ?? '',
      },
    }
  },

  outputs: {
    account: { type: 'string', description: 'AWS account ID that owns the access key' },
  },
}
