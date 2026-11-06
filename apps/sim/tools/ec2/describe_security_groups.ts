import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeSecurityGroupsParams,
  type Ec2DescribeSecurityGroupsResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeSecurityGroupsTool: InternalToolConfig<
  Ec2DescribeSecurityGroupsParams,
  Ec2DescribeSecurityGroupsResponse
> = {
  id: 'ec2_describe_security_groups',
  name: 'EC2 Describe Security Groups',
  description: 'List security groups with their inbound and outbound rules',
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
    groupIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated security group IDs (e.g., sg-0abc123)',
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
        groupIds: params.groupIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Security Groups')
    }

    return {
      success: true,
      output: {
        securityGroups: data.securityGroups ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    securityGroups: {
      type: 'array',
      description: 'Security groups',
      items: {
        type: 'object',
        properties: {
          groupId: {
            type: 'string',
            description: 'Security group ID',
          },
          groupName: {
            type: 'string',
            description: 'Security group name',
            nullable: true,
          },
          description: {
            type: 'string',
            description: 'Description',
            nullable: true,
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
          ingressRules: {
            type: 'array',
            description: 'Inbound rules',
            items: {
              type: 'object',
              properties: {
                ipProtocol: {
                  type: 'string',
                  description: 'IP protocol (tcp, udp, icmp, or -1 for all)',
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
                ipv4Ranges: {
                  type: 'array',
                  description: 'IPv4 CIDR ranges',
                  items: {
                    type: 'object',
                    properties: {
                      cidr: {
                        type: 'string',
                        description: 'IPv4 CIDR',
                        nullable: true,
                      },
                      description: {
                        type: 'string',
                        description: 'Rule description',
                        nullable: true,
                      },
                    },
                  },
                },
                ipv6Ranges: {
                  type: 'array',
                  description: 'IPv6 CIDR ranges',
                  items: {
                    type: 'object',
                    properties: {
                      cidr: {
                        type: 'string',
                        description: 'IPv6 CIDR',
                        nullable: true,
                      },
                      description: {
                        type: 'string',
                        description: 'Rule description',
                        nullable: true,
                      },
                    },
                  },
                },
                referencedGroups: {
                  type: 'array',
                  description: 'Referenced security groups',
                  items: {
                    type: 'object',
                    properties: {
                      groupId: {
                        type: 'string',
                        description: 'Security group ID',
                        nullable: true,
                      },
                      userId: {
                        type: 'string',
                        description: 'Owning AWS account ID',
                        nullable: true,
                      },
                      description: {
                        type: 'string',
                        description: 'Rule description',
                        nullable: true,
                      },
                    },
                  },
                },
                prefixListIds: {
                  type: 'array',
                  description: 'Referenced prefix list IDs',
                  items: { type: 'string' },
                },
              },
            },
          },
          egressRules: {
            type: 'array',
            description: 'Outbound rules',
            items: {
              type: 'object',
              properties: {
                ipProtocol: {
                  type: 'string',
                  description: 'IP protocol (tcp, udp, icmp, or -1 for all)',
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
                ipv4Ranges: {
                  type: 'array',
                  description: 'IPv4 CIDR ranges',
                  items: {
                    type: 'object',
                    properties: {
                      cidr: {
                        type: 'string',
                        description: 'IPv4 CIDR',
                        nullable: true,
                      },
                      description: {
                        type: 'string',
                        description: 'Rule description',
                        nullable: true,
                      },
                    },
                  },
                },
                ipv6Ranges: {
                  type: 'array',
                  description: 'IPv6 CIDR ranges',
                  items: {
                    type: 'object',
                    properties: {
                      cidr: {
                        type: 'string',
                        description: 'IPv6 CIDR',
                        nullable: true,
                      },
                      description: {
                        type: 'string',
                        description: 'Rule description',
                        nullable: true,
                      },
                    },
                  },
                },
                referencedGroups: {
                  type: 'array',
                  description: 'Referenced security groups',
                  items: {
                    type: 'object',
                    properties: {
                      groupId: {
                        type: 'string',
                        description: 'Security group ID',
                        nullable: true,
                      },
                      userId: {
                        type: 'string',
                        description: 'Owning AWS account ID',
                        nullable: true,
                      },
                      description: {
                        type: 'string',
                        description: 'Rule description',
                        nullable: true,
                      },
                    },
                  },
                },
                prefixListIds: {
                  type: 'array',
                  description: 'Referenced prefix list IDs',
                  items: { type: 'string' },
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
