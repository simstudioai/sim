import type { IAMGetUserParams, IAMGetUserResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const getUserTool: ToolConfig<IAMGetUserParams, IAMGetUserResponse> = {
  id: 'iam_get_user',
  name: 'IAM Get User',
  description: 'Get detailed information about an IAM user',
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
      description: 'The name of the IAM user to retrieve (defaults to the caller if omitted)',
    },
  },

  request: {
    url: '/api/tools/iam/get-user',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      ...(params.userName ? { userName: params.userName } : {}),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get IAM user')
    }

    return {
      success: true,
      output: {
        userName: data.userName ?? '',
        userId: data.userId ?? '',
        arn: data.arn ?? '',
        path: data.path ?? '',
        createDate: data.createDate ?? null,
        passwordLastUsed: data.passwordLastUsed ?? null,
        permissionsBoundaryArn: data.permissionsBoundaryArn ?? null,
        tags: data.tags ?? [],
      },
    }
  },

  outputs: {
    userName: { type: 'string', description: 'The name of the user' },
    userId: { type: 'string', description: 'The unique ID of the user' },
    arn: { type: 'string', description: 'The ARN of the user' },
    path: { type: 'string', description: 'The path to the user' },
    createDate: { type: 'string', description: 'Date the user was created', optional: true },
    passwordLastUsed: {
      type: 'string',
      description: 'Date the password was last used',
      optional: true,
    },
    permissionsBoundaryArn: {
      type: 'string',
      description: 'ARN of the permissions boundary policy',
      optional: true,
    },
    tags: {
      type: 'json',
      description: 'Tags attached to the user (key, value pairs)',
      optional: true,
    },
  },
}
