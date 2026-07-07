import type {
  SecretsManagerRotateSecretParams,
  SecretsManagerRotateSecretResponse,
} from '@/tools/secrets_manager/types'
import type { ToolConfig } from '@/tools/types'

export const rotateSecretTool: ToolConfig<
  SecretsManagerRotateSecretParams,
  SecretsManagerRotateSecretResponse
> = {
  id: 'secrets_manager_rotate_secret',
  name: 'Secrets Manager Rotate Secret',
  description: 'Start or reconfigure rotation for a secret in AWS Secrets Manager',
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
      description: 'The name or ARN of the secret to rotate',
    },
    clientRequestToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Idempotency token for the new secret version (32-64 characters)',
    },
    rotationLambdaARN: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of the Lambda function that performs rotation (omit for managed rotation)',
    },
    automaticallyAfterDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of days between rotations (1-1000). Mutually exclusive with schedule expression',
    },
    duration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Length of the rotation window in hours, e.g. "3h"',
    },
    scheduleExpression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A cron() or rate() expression defining the rotation schedule',
    },
    rotateImmediately: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to rotate immediately (default true) or wait for the next scheduled window',
    },
  },

  request: {
    url: '/api/tools/secrets_manager/rotate-secret',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      secretId: params.secretId,
      clientRequestToken: params.clientRequestToken,
      rotationLambdaARN: params.rotationLambdaARN,
      automaticallyAfterDays: params.automaticallyAfterDays,
      duration: params.duration,
      scheduleExpression: params.scheduleExpression,
      rotateImmediately: params.rotateImmediately,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to rotate secret')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Rotation started successfully',
        name: data.name ?? '',
        arn: data.arn ?? '',
        versionId: data.versionId ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    name: { type: 'string', description: 'Name of the secret' },
    arn: { type: 'string', description: 'ARN of the secret' },
    versionId: { type: 'string', description: 'ID of the new secret version created by rotation' },
  },
}
