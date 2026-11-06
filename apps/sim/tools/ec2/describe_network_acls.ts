import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeNetworkAclsParams,
  type Ec2DescribeNetworkAclsResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeNetworkAclsTool: InternalToolConfig<
  Ec2DescribeNetworkAclsParams,
  Ec2DescribeNetworkAclsResponse
> = {
  id: 'ec2_describe_network_acls',
  name: 'EC2 Describe Network ACLs',
  description: 'List network ACLs with their inbound and outbound rules and subnet associations',
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
    networkAclIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated network ACL IDs (e.g., acl-0abc123)',
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
        networkAclIds: params.networkAclIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Network ACLs')
    }

    return {
      success: true,
      output: {
        networkAcls: data.networkAcls ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    networkAcls: {
      type: 'array',
      description: 'Network ACLs',
      items: {
        type: 'object',
        properties: {
          networkAclId: {
            type: 'string',
            description: 'Network ACL ID',
          },
          vpcId: {
            type: 'string',
            description: 'VPC ID',
            nullable: true,
          },
          isDefault: {
            type: 'boolean',
            description: 'Whether this is the default ACL for the VPC',
          },
          ownerId: {
            type: 'string',
            description: 'Owning AWS account ID',
            nullable: true,
          },
          entries: {
            type: 'array',
            description: 'Rules, evaluated in ascending rule number',
            items: {
              type: 'object',
              properties: {
                ruleNumber: {
                  type: 'number',
                  description: 'Rule number',
                  nullable: true,
                },
                egress: {
                  type: 'boolean',
                  description: 'Whether the rule applies to outbound traffic',
                },
                ruleAction: {
                  type: 'string',
                  description: 'allow or deny',
                  nullable: true,
                },
                protocol: {
                  type: 'string',
                  description: 'Protocol number (-1 for all, 6 for TCP, 17 for UDP)',
                  nullable: true,
                },
                cidrBlock: {
                  type: 'string',
                  description: 'IPv4 CIDR',
                  nullable: true,
                },
                ipv6CidrBlock: {
                  type: 'string',
                  description: 'IPv6 CIDR',
                  nullable: true,
                },
                fromPort: {
                  type: 'number',
                  description: 'Start of the port range',
                  nullable: true,
                },
                toPort: {
                  type: 'number',
                  description: 'End of the port range',
                  nullable: true,
                },
                icmpType: {
                  type: 'number',
                  description: 'ICMP type',
                  nullable: true,
                },
                icmpCode: {
                  type: 'number',
                  description: 'ICMP code',
                  nullable: true,
                },
              },
            },
          },
          associations: {
            type: 'array',
            description: 'Subnet associations',
            items: {
              type: 'object',
              properties: {
                associationId: {
                  type: 'string',
                  description: 'Association ID',
                  nullable: true,
                },
                subnetId: {
                  type: 'string',
                  description: 'Subnet ID',
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
