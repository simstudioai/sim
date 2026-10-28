import type {
  Ec2RevokeSecurityGroupIngressParams,
  Ec2RevokeSecurityGroupIngressResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const revokeSecurityGroupIngressTool: InternalToolConfig<
  Ec2RevokeSecurityGroupIngressParams,
  Ec2RevokeSecurityGroupIngressResponse
> = {
  id: 'ec2_revoke_security_group_ingress',
  name: 'EC2 Revoke Security Group Ingress',
  description:
    'Remove inbound rules from a security group by rule ID or by matching protocol, ports, and source',
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
      required: false,
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
    securityGroupRuleIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated security group rule IDs (e.g., sgr-0abc123). Use instead of protocol, ports, and source',
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
        securityGroupRuleIds: params.securityGroupRuleIds,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Revoke Security Group Ingress')
    }

    return {
      success: true,
      output: {
        revoked: data.revoked ?? false,
        revokedRules: data.revokedRules ?? [],
        unmatchedRuleCount: data.unmatchedRuleCount ?? 0,
      },
    }
  },

  outputs: {
    revoked: {
      type: 'boolean',
      description: 'Whether the request succeeded',
    },
    revokedRules: {
      type: 'array',
      description: 'Rules that were removed',
      items: {
        type: 'object',
        properties: {
          securityGroupRuleId: {
            type: 'string',
            description: 'Security group rule ID',
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
    unmatchedRuleCount: {
      type: 'number',
      description: 'Number of requested rules that did not match an existing rule',
    },
  },
}
