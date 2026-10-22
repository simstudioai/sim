import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeSnapshotsParams,
  type Ec2DescribeSnapshotsResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeSnapshotsTool: InternalToolConfig<
  Ec2DescribeSnapshotsParams,
  Ec2DescribeSnapshotsResponse
> = {
  id: 'ec2_describe_snapshots',
  name: 'EC2 Describe Snapshots',
  description: 'List EBS snapshots owned by the account (or by the owners you specify)',
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
    snapshotIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated snapshot IDs (e.g., snap-0abc123)',
    },
    ownerIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated owners: AWS account IDs, self, or amazon (defaults to self)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'EC2 filters as a JSON array, e.g. [{"Name":"volume-id","Values":["vol-0abc123"]}]',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results per page when no IDs are given (5-1000, default 100)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        snapshotIds: params.snapshotIds,
        ownerIds: params.ownerIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Snapshots')
    }

    return {
      success: true,
      output: {
        snapshots: data.snapshots ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    snapshots: {
      type: 'array',
      description: 'EBS snapshots',
      items: {
        type: 'object',
        properties: {
          snapshotId: {
            type: 'string',
            description: 'Snapshot ID',
          },
          volumeId: {
            type: 'string',
            description: 'Source volume ID',
            nullable: true,
          },
          volumeSize: {
            type: 'number',
            description: 'Source volume size in GiB',
            nullable: true,
          },
          state: {
            type: 'string',
            description: 'State (pending, completed, error, recoverable, recovering)',
            nullable: true,
          },
          progress: {
            type: 'string',
            description: 'Completion progress (e.g., 100%)',
            nullable: true,
          },
          startTime: {
            type: 'string',
            description: 'Start time (ISO 8601)',
            nullable: true,
          },
          description: {
            type: 'string',
            description: 'Description',
            nullable: true,
          },
          ownerId: {
            type: 'string',
            description: 'Owning AWS account ID',
            nullable: true,
          },
          encrypted: {
            type: 'boolean',
            description: 'Whether the snapshot is encrypted',
          },
          kmsKeyId: {
            type: 'string',
            description: 'KMS key ARN used for encryption',
            nullable: true,
          },
          storageTier: {
            type: 'string',
            description: 'Storage tier (standard or archive)',
            nullable: true,
          },
          tags: EC2_TAGS_OUTPUT,
        },
      },
    },
    nextToken: EC2_NEXT_TOKEN_OUTPUT,
  },
}
