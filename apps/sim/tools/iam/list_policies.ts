import type { IAMListPoliciesParams, IAMListPoliciesResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const listPoliciesTool: ToolConfig<IAMListPoliciesParams, IAMListPoliciesResponse> = {
  id: 'iam_list_policies',
  name: 'IAM List Policies',
  description: 'List managed IAM policies',
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
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by scope: All, AWS (AWS-managed), or Local (customer-managed)',
    },
    onlyAttached: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If true, only return policies attached to an entity',
    },
    pathPrefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Path prefix to filter policies',
    },
    maxItems: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of policies to return (1-1000, default 100)',
    },
    marker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination marker from a previous request',
    },
  },

  request: {
    url: '/api/tools/iam/list-policies',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      scope: params.scope,
      onlyAttached: params.onlyAttached,
      pathPrefix: params.pathPrefix,
      maxItems: params.maxItems,
      marker: params.marker,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list IAM policies')
    }

    return {
      success: true,
      output: {
        policies: data.policies ?? [],
        isTruncated: data.isTruncated ?? false,
        marker: data.marker ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    policies: {
      type: 'json',
      description: 'List of policies with policyName, arn, attachmentCount, and dates',
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
    count: { type: 'number', description: 'Number of policies returned' },
  },
}
