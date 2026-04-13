import type { IAMListRolesParams, IAMListRolesResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const listRolesTool: ToolConfig<IAMListRolesParams, IAMListRolesResponse> = {
  id: 'iam_list_roles',
  name: 'IAM List Roles',
  description: 'List IAM roles in your AWS account',
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
    pathPrefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Path prefix to filter roles (e.g., /application/)',
    },
    maxItems: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of roles to return (1-1000, default 100)',
    },
    marker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination marker from a previous request',
    },
  },

  request: {
    url: '/api/tools/iam/list-roles',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      pathPrefix: params.pathPrefix,
      maxItems: params.maxItems,
      marker: params.marker,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list IAM roles')
    }

    return {
      success: true,
      output: {
        roles: data.roles ?? [],
        isTruncated: data.isTruncated ?? false,
        marker: data.marker ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    roles: {
      type: 'json',
      description: 'List of IAM roles with roleName, roleId, arn, path, and dates',
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
    count: { type: 'number', description: 'Number of roles returned' },
  },
}
