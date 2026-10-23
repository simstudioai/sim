import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeInternetGatewaysParams,
  type Ec2DescribeInternetGatewaysResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeInternetGatewaysTool: InternalToolConfig<
  Ec2DescribeInternetGatewaysParams,
  Ec2DescribeInternetGatewaysResponse
> = {
  id: 'ec2_describe_internet_gateways',
  name: 'EC2 Describe Internet Gateways',
  description: 'List internet gateways and the VPCs they are attached to',
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
    internetGatewayIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated internet gateway IDs (e.g., igw-0abc123)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'EC2 filters as a JSON array, e.g. [{"Name":"attachment.vpc-id","Values":["vpc-0abc123"]}]',
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
        internetGatewayIds: params.internetGatewayIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Internet Gateways')
    }

    return {
      success: true,
      output: {
        internetGateways: data.internetGateways ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    internetGateways: {
      type: 'array',
      description: 'Internet gateways',
      items: {
        type: 'object',
        properties: {
          internetGatewayId: {
            type: 'string',
            description: 'Internet gateway ID',
          },
          ownerId: {
            type: 'string',
            description: 'Owning AWS account ID',
            nullable: true,
          },
          attachments: {
            type: 'array',
            description: 'VPC attachments',
            items: {
              type: 'object',
              properties: {
                vpcId: {
                  type: 'string',
                  description: 'Attached VPC ID',
                  nullable: true,
                },
                state: {
                  type: 'string',
                  description: 'Attachment state',
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
