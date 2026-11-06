import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeNatGatewaysParams,
  type Ec2DescribeNatGatewaysResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeNatGatewaysTool: InternalToolConfig<
  Ec2DescribeNatGatewaysParams,
  Ec2DescribeNatGatewaysResponse
> = {
  id: 'ec2_describe_nat_gateways',
  name: 'EC2 Describe NAT Gateways',
  description: 'List NAT gateways with their state, subnet, and IP addresses',
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
    natGatewayIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated NAT gateway IDs (e.g., nat-0abc123)',
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
        natGatewayIds: params.natGatewayIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe NAT Gateways')
    }

    return {
      success: true,
      output: {
        natGateways: data.natGateways ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    natGateways: {
      type: 'array',
      description: 'NAT gateways',
      items: {
        type: 'object',
        properties: {
          natGatewayId: {
            type: 'string',
            description: 'NAT gateway ID',
          },
          state: {
            type: 'string',
            description: 'State (pending, failed, available, deleting, deleted)',
            nullable: true,
          },
          connectivityType: {
            type: 'string',
            description: 'Connectivity type (public or private)',
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
          createTime: {
            type: 'string',
            description: 'Creation time (ISO 8601)',
            nullable: true,
          },
          deleteTime: {
            type: 'string',
            description: 'Deletion time (ISO 8601)',
            nullable: true,
          },
          failureCode: {
            type: 'string',
            description: 'Failure code when state is failed',
            nullable: true,
          },
          failureMessage: {
            type: 'string',
            description: 'Failure message when state is failed',
            nullable: true,
          },
          addresses: {
            type: 'array',
            description: 'IP addresses of the NAT gateway',
            items: {
              type: 'object',
              properties: {
                allocationId: {
                  type: 'string',
                  description: 'Elastic IP allocation ID',
                  nullable: true,
                },
                networkInterfaceId: {
                  type: 'string',
                  description: 'Network interface ID',
                  nullable: true,
                },
                privateIp: {
                  type: 'string',
                  description: 'Private IP address',
                  nullable: true,
                },
                publicIp: {
                  type: 'string',
                  description: 'Elastic IP address',
                  nullable: true,
                },
                associationId: {
                  type: 'string',
                  description: 'Association ID',
                  nullable: true,
                },
                isPrimary: {
                  type: 'boolean',
                  description: 'Whether this is the primary address',
                  nullable: true,
                },
                status: {
                  type: 'string',
                  description: 'Address status',
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
