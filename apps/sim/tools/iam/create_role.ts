import type { IAMCreateRoleParams, IAMCreateRoleResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const createRoleTool: ToolConfig<IAMCreateRoleParams, IAMCreateRoleResponse> = {
  id: 'iam_create_role',
  name: 'IAM Create Role',
  description: 'Create a new IAM role with a trust policy',
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
      description: 'Name for the new IAM role (1-64 characters)',
    },
    assumeRolePolicyDocument: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Trust policy JSON specifying who can assume this role',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the role',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Path for the role (e.g., /application/), defaults to /',
    },
    maxSessionDuration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum session duration in seconds (3600-43200, default 3600)',
    },
  },

  request: {
    url: '/api/tools/iam/create-role',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      roleName: params.roleName,
      assumeRolePolicyDocument: params.assumeRolePolicyDocument,
      description: params.description,
      path: params.path,
      maxSessionDuration: params.maxSessionDuration,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create IAM role')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        roleName: data.roleName ?? '',
        roleId: data.roleId ?? '',
        arn: data.arn ?? '',
        path: data.path ?? '',
        createDate: data.createDate ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    roleName: { type: 'string', description: 'The name of the created role' },
    roleId: { type: 'string', description: 'The unique ID of the created role' },
    arn: { type: 'string', description: 'The ARN of the created role' },
    path: { type: 'string', description: 'The path of the created role' },
    createDate: { type: 'string', description: 'Date the role was created', optional: true },
  },
}
