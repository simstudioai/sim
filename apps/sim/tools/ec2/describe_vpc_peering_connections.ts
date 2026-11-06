import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeVpcPeeringConnectionsParams,
  type Ec2DescribeVpcPeeringConnectionsResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeVpcPeeringConnectionsTool: InternalToolConfig<
  Ec2DescribeVpcPeeringConnectionsParams,
  Ec2DescribeVpcPeeringConnectionsResponse
> = {
  id: 'ec2_describe_vpc_peering_connections',
  name: 'EC2 Describe VPC Peering Connections',
  description: 'List VPC peering connections with their status and both VPCs',
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
    vpcPeeringConnectionIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated VPC peering connection IDs (e.g., pcx-0abc123)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'EC2 filters as a JSON array, e.g. [{"Name":"status-code","Values":["active"]}]',
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
        vpcPeeringConnectionIds: params.vpcPeeringConnectionIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe VPC Peering Connections')
    }

    return {
      success: true,
      output: {
        vpcPeeringConnections: data.vpcPeeringConnections ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    vpcPeeringConnections: {
      type: 'array',
      description: 'VPC peering connections',
      items: {
        type: 'object',
        properties: {
          vpcPeeringConnectionId: {
            type: 'string',
            description: 'VPC peering connection ID',
          },
          status: {
            type: 'string',
            description: 'Status code (e.g., pending-acceptance, active, rejected, deleted)',
            nullable: true,
          },
          statusMessage: {
            type: 'string',
            description: 'Status message',
            nullable: true,
          },
          requesterVpc: {
            type: 'object',
            description: 'Requester VPC',
            properties: {
              vpcId: {
                type: 'string',
                description: 'VPC ID',
                nullable: true,
              },
              ownerId: {
                type: 'string',
                description: 'Owning AWS account ID',
                nullable: true,
              },
              region: {
                type: 'string',
                description: 'Region',
                nullable: true,
              },
              cidrBlock: {
                type: 'string',
                description: 'IPv4 CIDR block',
                nullable: true,
              },
            },
          },
          accepterVpc: {
            type: 'object',
            description: 'Accepter VPC',
            properties: {
              vpcId: {
                type: 'string',
                description: 'VPC ID',
                nullable: true,
              },
              ownerId: {
                type: 'string',
                description: 'Owning AWS account ID',
                nullable: true,
              },
              region: {
                type: 'string',
                description: 'Region',
                nullable: true,
              },
              cidrBlock: {
                type: 'string',
                description: 'IPv4 CIDR block',
                nullable: true,
              },
            },
          },
          expirationTime: {
            type: 'string',
            description: 'Time an unaccepted request expires (ISO 8601)',
            nullable: true,
          },
          tags: EC2_TAGS_OUTPUT,
        },
      },
    },
    nextToken: EC2_NEXT_TOKEN_OUTPUT,
  },
}
