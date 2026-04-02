import type {
  SecretsManagerCreateSecretParams,
  SecretsManagerCreateSecretResponse,
} from '@/tools/secrets_manager/types'
import type { ToolConfig } from '@/tools/types'

export const createSecretTool: ToolConfig<
  SecretsManagerCreateSecretParams,
  SecretsManagerCreateSecretResponse
> = {
  id: 'secrets_manager_create_secret',
  name: 'Secrets Manager Create Secret',
  description: 'Create a new secret in AWS Secrets Manager',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the secret to create',
    },
    secretValue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The secret value (plain text or JSON string)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the secret',
    },
  },

  request: {
    url: '/api/tools/secrets_manager/create-secret',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      name: params.name,
      secretValue: params.secretValue,
      description: params.description,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create secret')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Secret created successfully',
        name: data.name ?? '',
        arn: data.arn ?? '',
        versionId: data.versionId ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    name: { type: 'string', description: 'Name of the created secret' },
    arn: { type: 'string', description: 'ARN of the created secret' },
    versionId: { type: 'string', description: 'Version ID of the created secret' },
  },
}
