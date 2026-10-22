import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeInstancesParams,
  type Ec2DescribeInstancesResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeInstancesTool: InternalToolConfig<
  Ec2DescribeInstancesParams,
  Ec2DescribeInstancesResponse
> = {
  id: 'ec2_describe_instances',
  name: 'EC2 Describe Instances',
  description: 'List EC2 instances with their state, type, networking, and tags',
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
      description:
        'Comma-separated instance IDs (e.g., i-0abc123,i-0def456). Leave empty to list all',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'EC2 filters as a JSON array, e.g. [{"Name":"instance-state-name","Values":["running"]}]',
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
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Instances')
    }

    return {
      success: true,
      output: {
        instances: data.instances ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    instances: {
      type: 'array',
      description: 'EC2 instances',
      items: {
        type: 'object',
        properties: {
          instanceId: {
            type: 'string',
            description: 'Instance ID',
          },
          instanceType: {
            type: 'string',
            description: 'Instance type (e.g., t3.micro)',
            nullable: true,
          },
          state: {
            type: 'string',
            description:
              'Instance state (pending, running, stopping, stopped, shutting-down, terminated)',
            nullable: true,
          },
          stateReason: {
            type: 'string',
            description: 'Reason for the most recent state transition',
            nullable: true,
          },
          launchTime: {
            type: 'string',
            description: 'Launch time (ISO 8601)',
            nullable: true,
          },
          availabilityZone: {
            type: 'string',
            description: 'Availability Zone',
            nullable: true,
          },
          vpcId: {
            type: 'string',
            description: 'VPC ID',
            nullable: true,
          },
          subnetId: {
            type: 'string',
            description: 'Subnet ID',
            nullable: true,
          },
          privateIpAddress: {
            type: 'string',
            description: 'Primary private IPv4 address',
            nullable: true,
          },
          publicIpAddress: {
            type: 'string',
            description: 'Public IPv4 address',
            nullable: true,
          },
          privateDnsName: {
            type: 'string',
            description: 'Private DNS name',
            nullable: true,
          },
          publicDnsName: {
            type: 'string',
            description: 'Public DNS name',
            nullable: true,
          },
          imageId: {
            type: 'string',
            description: 'AMI ID used to launch the instance',
            nullable: true,
          },
          keyName: {
            type: 'string',
            description: 'Key pair name',
            nullable: true,
          },
          platformDetails: {
            type: 'string',
            description: 'Platform details (e.g., Linux/UNIX, Windows)',
            nullable: true,
          },
          architecture: {
            type: 'string',
            description: 'CPU architecture',
            nullable: true,
          },
          iamInstanceProfileArn: {
            type: 'string',
            description: 'ARN of the attached IAM instance profile',
            nullable: true,
          },
          securityGroups: {
            type: 'array',
            description: 'Attached security groups',
            items: {
              type: 'object',
              properties: {
                groupId: {
                  type: 'string',
                  description: 'Security group ID',
                  nullable: true,
                },
                groupName: {
                  type: 'string',
                  description: 'Security group name',
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
