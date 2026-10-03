import type { AthenaGetWorkGroupParams, AthenaGetWorkGroupResponse } from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const getWorkGroupTool: InternalToolConfig<
  AthenaGetWorkGroupParams,
  AthenaGetWorkGroupResponse
> = {
  id: 'athena_get_work_group',
  name: 'Athena Get Workgroup',
  description:
    'Get the configuration of an Athena workgroup, including its result location, encryption, and limits',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    workGroup: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workgroup name',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      workGroup: params.workGroup,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Athena workgroup')
    }
    return {
      success: true,
      output: {
        name: data.output.name,
        state: data.output.state ?? null,
        description: data.output.description ?? null,
        creationTime: data.output.creationTime ?? null,
        identityCenterApplicationArn: data.output.identityCenterApplicationArn ?? null,
        engineVersion: data.output.engineVersion ?? null,
        outputLocation: data.output.outputLocation ?? null,
        encryptionOption: data.output.encryptionOption ?? null,
        kmsKey: data.output.kmsKey ?? null,
        expectedBucketOwner: data.output.expectedBucketOwner ?? null,
        managedQueryResultsEnabled: data.output.managedQueryResultsEnabled ?? null,
        enforceWorkGroupConfiguration: data.output.enforceWorkGroupConfiguration ?? null,
        publishCloudWatchMetricsEnabled: data.output.publishCloudWatchMetricsEnabled ?? null,
        bytesScannedCutoffPerQuery: data.output.bytesScannedCutoffPerQuery ?? null,
        requesterPaysEnabled: data.output.requesterPaysEnabled ?? null,
        enableMinimumEncryptionConfiguration:
          data.output.enableMinimumEncryptionConfiguration ?? null,
        executionRole: data.output.executionRole ?? null,
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Workgroup name',
    },
    state: {
      type: 'string',
      description: 'Workgroup state (ENABLED, DISABLED)',
      optional: true,
    },
    description: {
      type: 'string',
      description: 'Workgroup description',
      optional: true,
    },
    creationTime: {
      type: 'number',
      description: 'Creation time (Unix epoch ms)',
      optional: true,
    },
    identityCenterApplicationArn: {
      type: 'string',
      description: 'IAM Identity Center application ARN',
      optional: true,
    },
    engineVersion: {
      type: 'json',
      description: 'Engine version setting (selected and effective versions)',
      optional: true,
      properties: {
        selectedEngineVersion: {
          type: 'string',
          description: 'Requested engine version',
          optional: true,
        },
        effectiveEngineVersion: {
          type: 'string',
          description: 'Engine version Athena actually uses',
          optional: true,
        },
      },
    },
    outputLocation: {
      type: 'string',
      description: 'S3 location where query results are written',
      optional: true,
    },
    encryptionOption: {
      type: 'string',
      description: 'Result encryption option (SSE_S3, SSE_KMS, CSE_KMS)',
      optional: true,
    },
    kmsKey: {
      type: 'string',
      description: 'KMS key ARN or ID used for result encryption',
      optional: true,
    },
    expectedBucketOwner: {
      type: 'string',
      description: 'Expected AWS account ID of the results bucket owner',
      optional: true,
    },
    managedQueryResultsEnabled: {
      type: 'boolean',
      description: 'Whether results are stored in Athena-owned storage',
      optional: true,
    },
    enforceWorkGroupConfiguration: {
      type: 'boolean',
      description: 'Whether workgroup settings override client-side settings',
      optional: true,
    },
    publishCloudWatchMetricsEnabled: {
      type: 'boolean',
      description: 'Whether CloudWatch metrics are published for the workgroup',
      optional: true,
    },
    bytesScannedCutoffPerQuery: {
      type: 'number',
      description: 'Per-query data scan limit in bytes',
      optional: true,
    },
    requesterPaysEnabled: {
      type: 'boolean',
      description: 'Whether Requester Pays S3 buckets may be queried',
      optional: true,
    },
    enableMinimumEncryptionConfiguration: {
      type: 'boolean',
      description: 'Whether a minimum encryption level is enforced',
      optional: true,
    },
    executionRole: {
      type: 'string',
      description: 'Execution role ARN for Spark or IAM Identity Center workgroups',
      optional: true,
    },
  },
}
