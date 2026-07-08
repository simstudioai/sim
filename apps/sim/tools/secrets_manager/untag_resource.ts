import type {
  SecretsManagerUntagResourceParams,
  SecretsManagerUntagResourceResponse,
} from '@/tools/secrets_manager/types'
import type { ToolConfig } from '@/tools/types'

export const untagResourceTool: ToolConfig<
  SecretsManagerUntagResourceParams,
  SecretsManagerUntagResourceResponse
> = {
  id: 'secrets_manager_untag_resource',
  name: 'Secrets Manager Untag Resource',
  description: 'Remove tags from a secret in AWS Secrets Manager',
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
      description: 'The name or ARN of the secret to untag',
    },
    tagKeys: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tag keys to remove, as an array of strings (max 50)',
    },
  },

  request: {
    url: '/api/tools/secrets_manager/untag-resource',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      secretId: params.secretId,
      tagKeys: params.tagKeys,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to untag secret')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Secret untagged successfully',
        name: data.name ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    name: { type: 'string', description: 'Name or ARN of the untagged secret' },
  },
}
