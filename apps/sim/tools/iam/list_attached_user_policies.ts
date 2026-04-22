import type {
  IAMListAttachedPoliciesResponse,
  IAMListAttachedUserPoliciesParams,
} from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const listAttachedUserPoliciesTool: ToolConfig<
  IAMListAttachedUserPoliciesParams,
  IAMListAttachedPoliciesResponse
> = {
  id: 'iam_list_attached_user_policies',
  name: 'IAM List Attached User Policies',
  description: 'List all managed policies attached to an IAM user',
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
      description: 'Name of the IAM user',
    },
    pathPrefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Path prefix to filter policies (e.g., /application/)',
    },
    maxItems: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of policies to return (1-1000)',
    },
    marker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination marker from a previous request',
    },
  },

  request: {
    url: '/api/tools/iam/list-attached-user-policies',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      userName: params.userName,
      pathPrefix: params.pathPrefix,
      maxItems: params.maxItems,
      marker: params.marker,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list attached user policies')
    }
    return {
      success: true,
      output: {
        attachedPolicies: data.attachedPolicies ?? [],
        isTruncated: data.isTruncated ?? false,
        marker: data.marker ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    attachedPolicies: {
      type: 'json',
      description: 'List of attached policies with policyName and policyArn',
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
    count: { type: 'number', description: 'Number of attached policies returned' },
  },
}
