import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeVpcEndpointsParams,
  type Ec2DescribeVpcEndpointsResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeVpcEndpointsTool: InternalToolConfig<
  Ec2DescribeVpcEndpointsParams,
  Ec2DescribeVpcEndpointsResponse
> = {
  id: 'ec2_describe_vpc_endpoints',
  name: 'EC2 Describe VPC Endpoints',
  description: 'List VPC endpoints with their service, type, state, and network placement',
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
    vpcEndpointIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated VPC endpoint IDs (e.g., vpce-0abc123)',
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
        vpcEndpointIds: params.vpcEndpointIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe VPC Endpoints')
    }

    return {
      success: true,
      output: {
        vpcEndpoints: data.vpcEndpoints ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    vpcEndpoints: {
      type: 'array',
      description: 'VPC endpoints',
      items: {
        type: 'object',
        properties: {
          vpcEndpointId: {
            type: 'string',
            description: 'VPC endpoint ID',
          },
          vpcEndpointType: {
            type: 'string',
            description:
              'Endpoint type (Interface, Gateway, GatewayLoadBalancer, Resource, ServiceNetwork)',
            nullable: true,
          },
          vpcId: {
            type: 'string',
            description: 'VPC ID',
            nullable: true,
          },
          serviceName: {
            type: 'string',
            description: 'Service name (e.g., com.amazonaws.us-east-1.s3)',
            nullable: true,
          },
          state: {
            type: 'string',
            description: 'Endpoint state',
            nullable: true,
          },
          privateDnsEnabled: {
            type: 'boolean',
            description: 'Whether private DNS is enabled',
          },
          routeTableIds: {
            type: 'array',
            description: 'Associated route table IDs (gateway endpoints)',
            items: { type: 'string' },
          },
          subnetIds: {
            type: 'array',
            description: 'Subnet IDs (interface endpoints)',
            items: { type: 'string' },
          },
          networkInterfaceIds: {
            type: 'array',
            description: 'Endpoint network interface IDs',
            items: { type: 'string' },
          },
          securityGroupIds: {
            type: 'array',
            description: 'Attached security group IDs',
            items: { type: 'string' },
          },
          dnsNames: {
            type: 'array',
            description: 'DNS names for the endpoint',
            items: { type: 'string' },
          },
          creationTimestamp: {
            type: 'string',
            description: 'Creation time (ISO 8601)',
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
