import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeSubnetsParams,
  type Ec2DescribeSubnetsResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeSubnetsTool: InternalToolConfig<
  Ec2DescribeSubnetsParams,
  Ec2DescribeSubnetsResponse
> = {
  id: 'ec2_describe_subnets',
  name: 'EC2 Describe Subnets',
  description: 'List subnets with their CIDR, Availability Zone, and free IP count',
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
    subnetIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated subnet IDs (e.g., subnet-0abc123)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'EC2 filters as a JSON array, e.g. [{"Name":"vpc-id","Values":["vpc-0abc123"]}]',
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
        subnetIds: params.subnetIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Subnets')
    }

    return {
      success: true,
      output: {
        subnets: data.subnets ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    subnets: {
      type: 'array',
      description: 'Subnets',
      items: {
        type: 'object',
        properties: {
          subnetId: {
            type: 'string',
            description: 'Subnet ID',
          },
          subnetArn: {
            type: 'string',
            description: 'Subnet ARN',
            nullable: true,
          },
          vpcId: {
            type: 'string',
            description: 'VPC ID',
            nullable: true,
          },
          cidrBlock: {
            type: 'string',
            description: 'IPv4 CIDR block',
            nullable: true,
          },
          ipv6CidrBlocks: {
            type: 'array',
            description: 'Associated IPv6 CIDR blocks',
            items: { type: 'string' },
          },
          availabilityZone: {
            type: 'string',
            description: 'Availability Zone',
            nullable: true,
          },
          availabilityZoneId: {
            type: 'string',
            description: 'Availability Zone ID',
            nullable: true,
          },
          availableIpAddressCount: {
            type: 'number',
            description: 'Number of unused private IPv4 addresses',
            nullable: true,
          },
          state: {
            type: 'string',
            description: 'State (pending, available, unavailable)',
            nullable: true,
          },
          defaultForAz: {
            type: 'boolean',
            description: 'Whether this is the default subnet for its Availability Zone',
          },
          mapPublicIpOnLaunch: {
            type: 'boolean',
            description: 'Whether instances get a public IPv4 address on launch',
          },
          ownerId: {
            type: 'string',
            description: 'Owning AWS account ID',
            nullable: true,
          },
          tags: EC2_TAGS_OUTPUT,
        },
      },
    },
    nextToken: EC2_NEXT_TOKEN_OUTPUT,
  },
}
