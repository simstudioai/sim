import type { IAMListAccessKeysParams, IAMListAccessKeysResponse } from '@/tools/iam/types'
import type { InternalToolConfig } from '@/tools/types'

export const listAccessKeysTool: InternalToolConfig<
  IAMListAccessKeysParams,
  IAMListAccessKeysResponse
> = {
  id: 'iam_list_access_keys',
  name: 'IAM List Access Keys',
  description:
    "List an IAM user's access key IDs with their status and age — use to find stale keys and to confirm which keys remain after a rotation",
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
      description: 'The IAM user whose keys to list (defaults to the calling user if omitted)',
    },
    maxItems: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of access keys to return (1-1000)',
    },
    marker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination marker from a previous request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      ...(params.userName ? { userName: params.userName } : {}),
      maxItems: params.maxItems,
      marker: params.marker,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list access keys')
    }

    return {
      success: true,
      output: {
        accessKeys: data.accessKeys ?? [],
        isTruncated: data.isTruncated ?? false,
        marker: data.marker ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    accessKeys: {
      type: 'json',
      description:
        'Access key metadata: accessKeyId, userName, status (Active/Inactive), createDate. The secret access key is never returned by this operation.',
    },
    isTruncated: {
      type: 'boolean',
      description: 'Whether there are more results available',
    },
    marker: {
      type: 'string',
      description: 'Pagination marker for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of access keys returned' },
  },
}
