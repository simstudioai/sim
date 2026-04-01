import type {
  SecretsManagerDeleteSecretParams,
  SecretsManagerDeleteSecretResponse,
} from '@/tools/secrets_manager/types'
import type { ToolConfig } from '@/tools/types'

export const deleteSecretTool: ToolConfig<
  SecretsManagerDeleteSecretParams,
  SecretsManagerDeleteSecretResponse
> = {
  id: 'secrets_manager_delete_secret',
  name: 'Secrets Manager Delete Secret',
  description: 'Delete a secret from AWS Secrets Manager',
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
      description: 'The name or ARN of the secret to delete',
    },
    recoveryWindowInDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of days before permanent deletion (7-30, default 30)',
    },
    forceDelete: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If true, immediately delete without recovery window',
    },
  },

  request: {
    url: '/api/tools/secrets_manager/delete-secret',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      secretId: params.secretId,
      recoveryWindowInDays: params.recoveryWindowInDays,
      forceDelete: params.forceDelete,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete secret')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Secret scheduled for deletion',
        name: data.name ?? '',
        arn: data.arn ?? '',
        deletionDate: data.deletionDate ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    name: { type: 'string', description: 'Name of the deleted secret' },
    arn: { type: 'string', description: 'ARN of the deleted secret' },
    deletionDate: { type: 'string', description: 'Scheduled deletion date', optional: true },
  },
}
