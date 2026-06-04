import type { IAMGetRoleParams, IAMGetRoleResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const getRoleTool: ToolConfig<IAMGetRoleParams, IAMGetRoleResponse> = {
  id: 'iam_get_role',
  name: 'IAM Get Role',
  description: 'Get detailed information about an IAM role',
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
      description: 'The name of the IAM role to retrieve',
    },
  },

  request: {
    url: '/api/tools/iam/get-role',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      roleName: params.roleName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get IAM role')
    }

    return {
      success: true,
      output: {
        roleName: data.roleName ?? '',
        roleId: data.roleId ?? '',
        arn: data.arn ?? '',
        path: data.path ?? '',
        createDate: data.createDate ?? null,
        description: data.description ?? null,
        maxSessionDuration: data.maxSessionDuration ?? null,
        assumeRolePolicyDocument: data.assumeRolePolicyDocument ?? null,
        roleLastUsedDate: data.roleLastUsedDate ?? null,
        roleLastUsedRegion: data.roleLastUsedRegion ?? null,
      },
    }
  },

  outputs: {
    roleName: { type: 'string', description: 'The name of the role' },
    roleId: { type: 'string', description: 'The unique ID of the role' },
    arn: { type: 'string', description: 'The ARN of the role' },
    path: { type: 'string', description: 'The path to the role' },
    createDate: { type: 'string', description: 'Date the role was created', optional: true },
    description: { type: 'string', description: 'Description of the role', optional: true },
    maxSessionDuration: {
      type: 'number',
      description: 'Maximum session duration in seconds',
      optional: true,
    },
    assumeRolePolicyDocument: {
      type: 'string',
      description: 'The trust policy document (JSON)',
      optional: true,
    },
    roleLastUsedDate: {
      type: 'string',
      description: 'Date the role was last used',
      optional: true,
    },
    roleLastUsedRegion: {
      type: 'string',
      description: 'AWS region where the role was last used',
      optional: true,
    },
  },
}
