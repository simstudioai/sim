import type {
  IAMListAttachedPoliciesResponse,
  IAMListAttachedRolePoliciesParams,
} from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const listAttachedRolePoliciesTool: ToolConfig<
  IAMListAttachedRolePoliciesParams,
  IAMListAttachedPoliciesResponse
> = {
  id: 'iam_list_attached_role_policies',
  name: 'IAM List Attached Role Policies',
  description: 'List all managed policies attached to an IAM role',
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
      description: 'Name of the IAM role',
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
    url: '/api/tools/iam/list-attached-role-policies',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      roleName: params.roleName,
      pathPrefix: params.pathPrefix,
      maxItems: params.maxItems,
      marker: params.marker,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list attached role policies')
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
