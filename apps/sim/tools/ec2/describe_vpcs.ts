import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeVpcsParams,
  type Ec2DescribeVpcsResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeVpcsTool: InternalToolConfig<Ec2DescribeVpcsParams, Ec2DescribeVpcsResponse> =
  {
    id: 'ec2_describe_vpcs',
    name: 'EC2 Describe VPCs',
    description: 'List VPCs with their CIDR blocks and state',
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
      vpcIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated VPC IDs (e.g., vpc-0abc123)',
      },
      filters: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'EC2 filters as a JSON array, e.g. [{"Name":"is-default","Values":["false"]}]',
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
          vpcIds: params.vpcIds,
          filters: params.filters,
          maxResults: params.maxResults,
          nextToken: params.nextToken,
        }),
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to run EC2 Describe VPCs')
      }

      return {
        success: true,
        output: {
          vpcs: data.vpcs ?? [],
          nextToken: data.nextToken ?? null,
        },
      }
    },

    outputs: {
      vpcs: {
        type: 'array',
        description: 'VPCs',
        items: {
          type: 'object',
          properties: {
            vpcId: {
              type: 'string',
              description: 'VPC ID',
            },
            cidrBlock: {
              type: 'string',
              description: 'Primary IPv4 CIDR block',
              nullable: true,
            },
            cidrBlocks: {
              type: 'array',
              description: 'All associated IPv4 CIDR blocks',
              items: { type: 'string' },
            },
            ipv6CidrBlocks: {
              type: 'array',
              description: 'Associated IPv6 CIDR blocks',
              items: { type: 'string' },
            },
            state: {
              type: 'string',
              description: 'State (pending or available)',
              nullable: true,
            },
            isDefault: {
              type: 'boolean',
              description: 'Whether this is the default VPC',
            },
            instanceTenancy: {
              type: 'string',
              description: 'Instance tenancy',
              nullable: true,
            },
            dhcpOptionsId: {
              type: 'string',
              description: 'DHCP options set ID',
              nullable: true,
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
