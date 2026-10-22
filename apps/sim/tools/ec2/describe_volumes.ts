import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeVolumesParams,
  type Ec2DescribeVolumesResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeVolumesTool: InternalToolConfig<
  Ec2DescribeVolumesParams,
  Ec2DescribeVolumesResponse
> = {
  id: 'ec2_describe_volumes',
  name: 'EC2 Describe Volumes',
  description: 'List EBS volumes with their size, type, state, and attachments',
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
    volumeIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated volume IDs (e.g., vol-0abc123)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'EC2 filters as a JSON array, e.g. [{"Name":"status","Values":["available"]}]',
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
        volumeIds: params.volumeIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Volumes')
    }

    return {
      success: true,
      output: {
        volumes: data.volumes ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    volumes: {
      type: 'array',
      description: 'EBS volumes',
      items: {
        type: 'object',
        properties: {
          volumeId: {
            type: 'string',
            description: 'Volume ID',
          },
          volumeType: {
            type: 'string',
            description: 'Volume type (gp2, gp3, io1, io2, st1, sc1, standard)',
            nullable: true,
          },
          size: {
            type: 'number',
            description: 'Size in GiB',
            nullable: true,
          },
          state: {
            type: 'string',
            description: 'State (creating, available, in-use, deleting, deleted, error)',
            nullable: true,
          },
          availabilityZone: {
            type: 'string',
            description: 'Availability Zone',
            nullable: true,
          },
          iops: {
            type: 'number',
            description: 'Provisioned IOPS',
            nullable: true,
          },
          throughput: {
            type: 'number',
            description: 'Throughput in MiB/s (gp3)',
            nullable: true,
          },
          encrypted: {
            type: 'boolean',
            description: 'Whether the volume is encrypted',
          },
          kmsKeyId: {
            type: 'string',
            description: 'KMS key ARN used for encryption',
            nullable: true,
          },
          snapshotId: {
            type: 'string',
            description: 'Snapshot the volume was created from',
            nullable: true,
          },
          createTime: {
            type: 'string',
            description: 'Creation time (ISO 8601)',
            nullable: true,
          },
          multiAttachEnabled: {
            type: 'boolean',
            description: 'Whether Multi-Attach is enabled',
          },
          attachments: {
            type: 'array',
            description: 'Instance attachments',
            items: {
              type: 'object',
              properties: {
                instanceId: {
                  type: 'string',
                  description: 'Attached instance ID',
                  nullable: true,
                },
                device: {
                  type: 'string',
                  description: 'Device name (e.g., /dev/xvda)',
                  nullable: true,
                },
                state: {
                  type: 'string',
                  description: 'Attachment state',
                  nullable: true,
                },
                attachTime: {
                  type: 'string',
                  description: 'Attach time (ISO 8601)',
                  nullable: true,
                },
                deleteOnTermination: {
                  type: 'boolean',
                  description: 'Whether the volume is deleted when the instance terminates',
                  nullable: true,
                },
              },
            },
          },
          tags: EC2_TAGS_OUTPUT,
        },
      },
    },
    nextToken: EC2_NEXT_TOKEN_OUTPUT,
  },
}
