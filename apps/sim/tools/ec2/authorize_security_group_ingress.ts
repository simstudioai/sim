import type {
  Ec2AuthorizeSecurityGroupIngressParams,
  Ec2AuthorizeSecurityGroupIngressResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const authorizeSecurityGroupIngressTool: InternalToolConfig<
  Ec2AuthorizeSecurityGroupIngressParams,
  Ec2AuthorizeSecurityGroupIngressResponse
> = {
  id: 'ec2_authorize_security_group_ingress',
  name: 'EC2 Authorize Security Group Ingress',
  description: 'Add an inbound rule to a security group',
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
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Security group ID (e.g., sg-0abc123)',
    },
    ipProtocol: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'IP protocol: tcp, udp, icmp, icmpv6, or -1 for all traffic',
    },
    fromPort: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of the port range (ICMP type for icmp; omit for -1)',
    },
    toPort: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the port range (ICMP code for icmp; omit for -1)',
    },
    cidrIp: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IPv4 CIDR source (e.g., 203.0.113.0/24). Provide exactly one source',
    },
    cidrIpv6: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IPv6 CIDR source (e.g., 2001:db8::/32). Provide exactly one source',
    },
    sourceGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source security group ID. Provide exactly one source',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the rule',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        groupId: params.groupId,
        ipProtocol: params.ipProtocol,
        fromPort: params.fromPort,
        toPort: params.toPort,
        cidrIp: params.cidrIp,
        cidrIpv6: params.cidrIpv6,
        sourceGroupId: params.sourceGroupId,
        description: params.description,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Authorize Security Group Ingress')
    }

    return {
      success: true,
      output: {
        authorized: data.authorized ?? false,
        securityGroupRules: data.securityGroupRules ?? [],
      },
    }
  },

  outputs: {
    authorized: {
      type: 'boolean',
      description: 'Whether the rule was added',
    },
    securityGroupRules: {
      type: 'array',
      description: 'Rules that were added',
      items: {
        type: 'object',
        properties: {
          securityGroupRuleId: {
            type: 'string',
            description: 'Security group rule ID',
          },
          groupId: {
            type: 'string',
            description: 'Security group ID',
          },
          ipProtocol: {
            type: 'string',
            description: 'IP protocol',
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
          cidrIpv4: {
            type: 'string',
            description: 'IPv4 CIDR source',
            nullable: true,
          },
          cidrIpv6: {
            type: 'string',
            description: 'IPv6 CIDR source',
            nullable: true,
          },
          referencedGroupId: {
            type: 'string',
            description: 'Source security group ID',
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
  },
}
