import type {
  SecretsManagerDescribeSecretParams,
  SecretsManagerDescribeSecretResponse,
} from '@/tools/secrets_manager/types'
import type { ToolConfig } from '@/tools/types'

export const describeSecretTool: ToolConfig<
  SecretsManagerDescribeSecretParams,
  SecretsManagerDescribeSecretResponse
> = {
  id: 'secrets_manager_describe_secret',
  name: 'Secrets Manager Describe Secret',
  description:
    'Retrieve full metadata for a secret in AWS Secrets Manager, including rotation configuration and replication status, without exposing the secret value',
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
      description: 'The name or ARN of the secret to describe',
    },
  },

  request: {
    url: '/api/tools/secrets_manager/describe-secret',
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
      throw new Error(data.error || 'Failed to describe secret')
    }

    return {
      success: true,
      output: {
        name: data.name ?? '',
        arn: data.arn ?? '',
        description: data.description ?? null,
        kmsKeyId: data.kmsKeyId ?? null,
        rotationEnabled: data.rotationEnabled ?? false,
        rotationLambdaARN: data.rotationLambdaARN ?? null,
        rotationRules: data.rotationRules ?? null,
        lastRotatedDate: data.lastRotatedDate ?? null,
        lastChangedDate: data.lastChangedDate ?? null,
        lastAccessedDate: data.lastAccessedDate ?? null,
        deletedDate: data.deletedDate ?? null,
        nextRotationDate: data.nextRotationDate ?? null,
        tags: data.tags ?? [],
        versionIdsToStages: data.versionIdsToStages ?? null,
        owningService: data.owningService ?? null,
        createdDate: data.createdDate ?? null,
        primaryRegion: data.primaryRegion ?? null,
        replicationStatus: data.replicationStatus ?? [],
      },
      error: undefined,
    }
  },

  outputs: {
    name: { type: 'string', description: 'Name of the secret' },
    arn: { type: 'string', description: 'ARN of the secret' },
    description: { type: 'string', description: 'Description of the secret', optional: true },
    kmsKeyId: {
      type: 'string',
      description: 'KMS key ID used to encrypt the secret',
      optional: true,
    },
    rotationEnabled: { type: 'boolean', description: 'Whether automatic rotation is enabled' },
    rotationLambdaARN: {
      type: 'string',
      description: 'ARN of the Lambda function used for rotation',
      optional: true,
    },
    rotationRules: {
      type: 'json',
      description: 'Rotation schedule configuration',
      optional: true,
    },
    lastRotatedDate: {
      type: 'string',
      description: 'Date the secret was last rotated',
      optional: true,
    },
    lastChangedDate: {
      type: 'string',
      description: 'Date the secret was last changed',
      optional: true,
    },
    lastAccessedDate: {
      type: 'string',
      description: 'Date the secret was last accessed',
      optional: true,
    },
    deletedDate: { type: 'string', description: 'Scheduled deletion date', optional: true },
    nextRotationDate: {
      type: 'string',
      description: 'Date the secret is next scheduled to rotate',
      optional: true,
    },
    tags: { type: 'array', description: 'Tags attached to the secret' },
    versionIdsToStages: {
      type: 'json',
      description: 'Map of version IDs to their staging labels',
      optional: true,
    },
    owningService: {
      type: 'string',
      description: 'ID of the AWS service that manages this secret, if any',
      optional: true,
    },
    createdDate: { type: 'string', description: 'Date the secret was created', optional: true },
    primaryRegion: {
      type: 'string',
      description: 'The primary region of the secret, if replicated',
      optional: true,
    },
    replicationStatus: {
      type: 'array',
      description: 'Replication status for each region the secret is replicated to',
    },
  },
}
