import type { IAMCreateRoleParams, IAMCreateRoleResponse } from '@/tools/iam/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const createRoleTool: InternalToolConfig<IAMCreateRoleParams, IAMCreateRoleResponse> = {
  id: 'iam_create_role',
  name: 'IAM Create Role',
  description: 'Create a new IAM role with a trust policy',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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
    permissionsBoundary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of a managed policy to set as the role permissions boundary',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of up to 50 tag key/value pairs to attach to the new role',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      roleName: params.roleName,
      assumeRolePolicyDocument: params.assumeRolePolicyDocument,
      description: params.description,
      path: params.path,
      maxSessionDuration: params.maxSessionDuration,
      permissionsBoundary: params.permissionsBoundary,
      tags: params.tags,
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
        permissionsBoundaryArn: data.permissionsBoundaryArn ?? null,
        tags: data.tags ?? [],
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
    permissionsBoundaryArn: {
      type: 'string',
      description: 'ARN of the permissions boundary policy set on the role',
      optional: true,
    },
    tags: {
      type: 'json',
      description: 'Tags attached to the role (key, value pairs)',
      optional: true,
    },
  },
}
