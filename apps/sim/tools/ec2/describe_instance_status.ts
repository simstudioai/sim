import {
  EC2_NEXT_TOKEN_OUTPUT,
  type Ec2DescribeInstanceStatusParams,
  type Ec2DescribeInstanceStatusResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeInstanceStatusTool: InternalToolConfig<
  Ec2DescribeInstanceStatusParams,
  Ec2DescribeInstanceStatusResponse
> = {
  id: 'ec2_describe_instance_status',
  name: 'EC2 Describe Instance Status',
  description: 'Get status checks and scheduled events for EC2 instances',
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
    instanceIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated instance IDs (max 100). Leave empty to describe all',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'EC2 filters as a JSON array, e.g. [{"Name":"instance-status.status","Values":["impaired"]}]',
    },
    includeAllInstances: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include instances that are not running (by default only running instances are returned)',
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
        instanceIds: params.instanceIds,
        filters: params.filters,
        includeAllInstances: params.includeAllInstances,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Instance Status')
    }

    return {
      success: true,
      output: {
        instanceStatuses: data.instanceStatuses ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    instanceStatuses: {
      type: 'array',
      description: 'Status of each instance',
      items: {
        type: 'object',
        properties: {
          instanceId: {
            type: 'string',
            description: 'Instance ID',
          },
          availabilityZone: {
            type: 'string',
            description: 'Availability Zone',
            nullable: true,
          },
          instanceState: {
            type: 'string',
            description: 'Instance state (e.g., running, stopped)',
            nullable: true,
          },
          instanceStatus: {
            type: 'string',
            description:
              'Instance status check (ok, impaired, initializing, insufficient-data, not-applicable)',
            nullable: true,
          },
          systemStatus: {
            type: 'string',
            description:
              'System status check (ok, impaired, initializing, insufficient-data, not-applicable)',
            nullable: true,
          },
          attachedEbsStatus: {
            type: 'string',
            description: 'Attached EBS status check',
            nullable: true,
          },
          events: {
            type: 'array',
            description: 'Scheduled events',
            items: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'Event code (e.g., system-reboot, instance-retirement)',
                  nullable: true,
                },
                description: {
                  type: 'string',
                  description: 'Event description',
                  nullable: true,
                },
                notBefore: {
                  type: 'string',
                  description: 'Earliest start time (ISO 8601)',
                  nullable: true,
                },
                notAfter: {
                  type: 'string',
                  description: 'Latest end time (ISO 8601)',
                  nullable: true,
                },
              },
            },
          },
        },
      },
    },
    nextToken: EC2_NEXT_TOKEN_OUTPUT,
  },
}
