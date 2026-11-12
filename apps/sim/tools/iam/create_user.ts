import type { IAMCreateUserParams, IAMCreateUserResponse } from '@/tools/iam/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const createUserTool: InternalToolConfig<IAMCreateUserParams, IAMCreateUserResponse> = {
  id: 'iam_create_user',
  name: 'IAM Create User',
  description: 'Create a new IAM user',
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
    userName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new IAM user (1-64 characters)',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Path for the user (e.g., /division_abc/), defaults to /',
    },
    permissionsBoundary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of a managed policy to set as the user permissions boundary',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of up to 50 tag key/value pairs to attach to the new user',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      userName: params.userName,
      path: params.path,
      permissionsBoundary: params.permissionsBoundary,
      tags: params.tags,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create IAM user')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        userName: data.userName ?? '',
        userId: data.userId ?? '',
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
    userName: { type: 'string', description: 'The name of the created user' },
    userId: { type: 'string', description: 'The unique ID of the created user' },
    arn: { type: 'string', description: 'The ARN of the created user' },
    path: { type: 'string', description: 'The path of the created user' },
    createDate: { type: 'string', description: 'Date the user was created', optional: true },
    permissionsBoundaryArn: {
      type: 'string',
      description: 'ARN of the permissions boundary policy set on the user',
      optional: true,
    },
    tags: {
      type: 'json',
      description: 'Tags attached to the user (key, value pairs)',
      optional: true,
    },
  },
}
