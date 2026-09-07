import type { IAMUpdateAccessKeyParams, IAMUpdateAccessKeyResponse } from '@/tools/iam/types'
import type { InternalToolConfig } from '@/tools/types'

export const updateAccessKeyTool: InternalToolConfig<
  IAMUpdateAccessKeyParams,
  IAMUpdateAccessKeyResponse
> = {
  id: 'iam_update_access_key',
  name: 'IAM Update Access Key',
  description:
    'Activate or deactivate an IAM access key — deactivate an old key and verify nothing breaks before deleting it',
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
    accessKeyIdToUpdate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The access key ID whose status to change',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The status to set. Must be exactly one of: Active, Inactive. An Inactive key is rejected by AWS but can be reactivated.',
    },
    userName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The IAM user that owns the key (defaults to the calling user if omitted)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      accessKeyIdToUpdate: params.accessKeyIdToUpdate,
      status: params.status,
      ...(params.userName ? { userName: params.userName } : {}),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update access key')
    }

    return {
      success: true,
      output: { message: data.message ?? '' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
