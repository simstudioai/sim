import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeRouteTablesParams,
  type Ec2DescribeRouteTablesResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeRouteTablesTool: InternalToolConfig<
  Ec2DescribeRouteTablesParams,
  Ec2DescribeRouteTablesResponse
> = {
  id: 'ec2_describe_route_tables',
  name: 'EC2 Describe Route Tables',
  description: 'List VPC route tables with their routes and subnet associations',
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
    routeTableIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated route table IDs (e.g., rtb-0abc123)',
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
      description: 'Maximum results per page when no IDs are given (5-100, default 100)',
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
        routeTableIds: params.routeTableIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Route Tables')
    }

    return {
      success: true,
      output: {
        routeTables: data.routeTables ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    routeTables: {
      type: 'array',
      description: 'Route tables',
      items: {
        type: 'object',
        properties: {
          routeTableId: {
            type: 'string',
            description: 'Route table ID',
          },
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
          routes: {
            type: 'array',
            description: 'Routes in the table',
            items: {
              type: 'object',
              properties: {
                destinationCidrBlock: {
                  type: 'string',
                  description: 'IPv4 destination CIDR',
                  nullable: true,
                },
                destinationIpv6CidrBlock: {
                  type: 'string',
                  description: 'IPv6 destination CIDR',
                  nullable: true,
                },
                destinationPrefixListId: {
                  type: 'string',
                  description: 'Destination prefix list ID',
                  nullable: true,
                },
                gatewayId: {
                  type: 'string',
                  description:
                    'Internet or virtual private gateway ID (local for VPC-local routes)',
                  nullable: true,
                },
                natGatewayId: {
                  type: 'string',
                  description: 'NAT gateway ID',
                  nullable: true,
                },
                transitGatewayId: {
                  type: 'string',
                  description: 'Transit gateway ID',
                  nullable: true,
                },
                vpcPeeringConnectionId: {
                  type: 'string',
                  description: 'VPC peering connection ID',
                  nullable: true,
                },
                networkInterfaceId: {
                  type: 'string',
                  description: 'Network interface ID',
                  nullable: true,
                },
                instanceId: {
                  type: 'string',
                  description: 'NAT instance ID',
                  nullable: true,
                },
                egressOnlyInternetGatewayId: {
                  type: 'string',
                  description: 'Egress-only internet gateway ID',
                  nullable: true,
                },
                state: {
                  type: 'string',
                  description: 'Route state (active or blackhole)',
                  nullable: true,
                },
                origin: {
                  type: 'string',
                  description: 'How the route was created',
                  nullable: true,
                },
              },
            },
          },
          associations: {
            type: 'array',
            description: 'Subnet and gateway associations',
            items: {
              type: 'object',
              properties: {
                associationId: {
                  type: 'string',
                  description: 'Association ID',
                  nullable: true,
                },
                main: {
                  type: 'boolean',
                  description: 'Whether this is the main route table for the VPC',
                },
                subnetId: {
                  type: 'string',
                  description: 'Associated subnet ID',
                  nullable: true,
                },
                gatewayId: {
                  type: 'string',
                  description: 'Associated gateway ID',
                  nullable: true,
                },
                state: {
                  type: 'string',
                  description: 'Association state',
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
