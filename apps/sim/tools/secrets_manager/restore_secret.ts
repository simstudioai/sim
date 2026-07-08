import type {
  SecretsManagerRestoreSecretParams,
  SecretsManagerRestoreSecretResponse,
} from '@/tools/secrets_manager/types'
import type { ToolConfig } from '@/tools/types'

export const restoreSecretTool: ToolConfig<
  SecretsManagerRestoreSecretParams,
  SecretsManagerRestoreSecretResponse
> = {
  id: 'secrets_manager_restore_secret',
  name: 'Secrets Manager Restore Secret',
  description:
    'Cancel a scheduled deletion for a secret in AWS Secrets Manager, restoring access to it',
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
      description: 'The name or ARN of the secret to restore',
    },
  },

  request: {
    url: '/api/tools/secrets_manager/restore-secret',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      secretId: params.secretId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to restore secret')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Secret restored successfully',
        name: data.name ?? '',
        arn: data.arn ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    name: { type: 'string', description: 'Name of the restored secret' },
    arn: { type: 'string', description: 'ARN of the restored secret' },
  },
}
