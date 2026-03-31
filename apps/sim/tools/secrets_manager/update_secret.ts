import type {
  SecretsManagerUpdateSecretParams,
  SecretsManagerUpdateSecretResponse,
} from '@/tools/secrets_manager/types'
import type { ToolConfig } from '@/tools/types'

export const updateSecretTool: ToolConfig<
  SecretsManagerUpdateSecretParams,
  SecretsManagerUpdateSecretResponse
> = {
  id: 'secrets_manager_update_secret',
  name: 'Secrets Manager Update Secret',
  description: 'Update the value of an existing secret in AWS Secrets Manager',
  version: '1.0',

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
      description: 'The name or ARN of the secret to update',
    },
    secretValue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The new secret value (plain text or JSON string)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description of the secret',
    },
  },

  request: {
    url: '/api/tools/secrets_manager/update-secret',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      secretId: params.secretId,
      secretValue: params.secretValue,
      description: params.description,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update secret')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Secret updated successfully',
        name: data.name ?? '',
        arn: data.arn ?? '',
        versionId: data.versionId ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    name: { type: 'string', description: 'Name of the updated secret' },
    arn: { type: 'string', description: 'ARN of the updated secret' },
    versionId: { type: 'string', description: 'Version ID of the updated secret' },
  },
}
