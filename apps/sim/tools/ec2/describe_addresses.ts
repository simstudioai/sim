import {
  EC2_TAGS_OUTPUT,
  type Ec2DescribeAddressesParams,
  type Ec2DescribeAddressesResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeAddressesTool: InternalToolConfig<
  Ec2DescribeAddressesParams,
  Ec2DescribeAddressesResponse
> = {
  id: 'ec2_describe_addresses',
  name: 'EC2 Describe Addresses',
  description: 'List Elastic IP addresses and what they are associated with',
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
    publicIps: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated Elastic IP addresses to describe',
    },
    allocationIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated allocation IDs (e.g., eipalloc-0abc123)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'EC2 filters as a JSON array, e.g. [{"Name":"domain","Values":["vpc"]}]',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        publicIps: params.publicIps,
        allocationIds: params.allocationIds,
        filters: params.filters,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Addresses')
    }

    return {
      success: true,
      output: {
        addresses: data.addresses ?? [],
      },
    }
  },

  outputs: {
    addresses: {
      type: 'array',
      description: 'Elastic IP addresses',
      items: {
        type: 'object',
        properties: {
          publicIp: {
            type: 'string',
            description: 'Elastic IP address',
            nullable: true,
          },
          allocationId: {
            type: 'string',
            description: 'Allocation ID',
            nullable: true,
          },
          associationId: {
            type: 'string',
            description: 'Association ID when associated',
            nullable: true,
          },
          domain: {
            type: 'string',
            description: 'Address scope (vpc or standard)',
            nullable: true,
          },
          instanceId: {
            type: 'string',
            description: 'Associated instance ID',
            nullable: true,
          },
          networkInterfaceId: {
            type: 'string',
            description: 'Associated network interface ID',
            nullable: true,
          },
          networkInterfaceOwnerId: {
            type: 'string',
            description: 'AWS account ID that owns the network interface',
            nullable: true,
          },
          privateIpAddress: {
            type: 'string',
            description: 'Associated private IP address',
            nullable: true,
          },
          publicIpv4Pool: {
            type: 'string',
            description: 'Public IPv4 pool the address came from',
            nullable: true,
          },
          networkBorderGroup: {
            type: 'string',
            description: 'Network border group the address is advertised from',
            nullable: true,
          },
          serviceManaged: {
            type: 'string',
            description: 'AWS service managing the address, if any (e.g., alb, nlb)',
            nullable: true,
          },
          tags: EC2_TAGS_OUTPUT,
        },
      },
    },
  },
}
