import type { IAMCreateUserParams, IAMCreateUserResponse } from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const createUserTool: ToolConfig<IAMCreateUserParams, IAMCreateUserResponse> = {
  id: 'iam_create_user',
  name: 'IAM Create User',
  description: 'Create a new IAM user',
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
      description: 'Name for the new IAM user (1-64 characters)',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Path for the user (e.g., /division_abc/), defaults to /',
    },
  },

  request: {
    url: '/api/tools/iam/create-user',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      userName: params.userName,
      path: params.path,
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
  },
}
