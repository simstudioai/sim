import type {
  SecretsManagerGetSecretParams,
  SecretsManagerGetSecretResponse,
} from '@/tools/secrets_manager/types'
import type { ToolConfig } from '@/tools/types'

export const getSecretTool: ToolConfig<
  SecretsManagerGetSecretParams,
  SecretsManagerGetSecretResponse
> = {
  id: 'secrets_manager_get_secret',
  name: 'Secrets Manager Get Secret',
  description: 'Retrieve a secret value from AWS Secrets Manager',
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
      description: 'The name or ARN of the secret to retrieve',
    },
    versionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the version to retrieve',
    },
    versionStage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The staging label of the version to retrieve (e.g., AWSCURRENT, AWSPREVIOUS)',
    },
  },

  request: {
    url: '/api/tools/secrets_manager/get-secret',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      secretId: params.secretId,
      versionId: params.versionId,
      versionStage: params.versionStage,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to retrieve secret')
    }

    return {
      success: true,
      output: {
        name: data.name ?? '',
        secretValue: data.secretValue ?? '',
        arn: data.arn ?? '',
        versionId: data.versionId ?? '',
        versionStages: data.versionStages ?? [],
        createdDate: data.createdDate ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    name: { type: 'string', description: 'Name of the secret' },
    secretValue: { type: 'string', description: 'The decrypted secret value' },
    arn: { type: 'string', description: 'ARN of the secret' },
    versionId: { type: 'string', description: 'Version ID of the secret' },
    versionStages: { type: 'array', description: 'Staging labels attached to this version' },
    createdDate: { type: 'string', description: 'Date the secret was created' },
  },
}
