import type {
  SecretsManagerTagResourceParams,
  SecretsManagerTagResourceResponse,
} from '@/tools/secrets_manager/types'
import type { ToolConfig } from '@/tools/types'

export const tagResourceTool: ToolConfig<
  SecretsManagerTagResourceParams,
  SecretsManagerTagResourceResponse
> = {
  id: 'secrets_manager_tag_resource',
  name: 'Secrets Manager Tag Resource',
  description: 'Attach tags to a secret in AWS Secrets Manager',
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
    secretId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name or ARN of the secret to tag',
    },
    tags: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tags to attach, as an array of {key, value} pairs (max 50)',
    },
  },

  request: {
    url: '/api/tools/secrets_manager/tag-resource',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      secretId: params.secretId,
      tags: params.tags,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to tag secret')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Secret tagged successfully',
        name: data.name ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    name: { type: 'string', description: 'Name or ARN of the tagged secret' },
  },
}
