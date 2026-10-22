import type { Ec2AllocateAddressParams, Ec2AllocateAddressResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const allocateAddressTool: InternalToolConfig<
  Ec2AllocateAddressParams,
  Ec2AllocateAddressResponse
> = {
  id: 'ec2_allocate_address',
  name: 'EC2 Allocate Address',
  description: 'Allocate a new Elastic IP address for use in a VPC',
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
    networkBorderGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Network border group to allocate from (defaults to the region)',
    },
    publicIpv4Pool: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BYOIP address pool to allocate from (defaults to the Amazon pool)',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tags to apply as a JSON object, e.g. {"Name":"web-eip"}',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        networkBorderGroup: params.networkBorderGroup,
        publicIpv4Pool: params.publicIpv4Pool,
        tags: params.tags,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Allocate Address')
    }

    return {
      success: true,
      output: {
        allocationId: data.allocationId ?? '',
        publicIp: data.publicIp ?? '',
        domain: data.domain ?? null,
        networkBorderGroup: data.networkBorderGroup ?? null,
        publicIpv4Pool: data.publicIpv4Pool ?? null,
      },
    }
  },

  outputs: {
    allocationId: {
      type: 'string',
      description: 'Allocation ID of the new Elastic IP',
    },
    publicIp: {
      type: 'string',
      description: 'Allocated Elastic IP address',
    },
    domain: {
      type: 'string',
      description: 'Address scope (vpc)',
      nullable: true,
    },
    networkBorderGroup: {
      type: 'string',
      description: 'Network border group',
      nullable: true,
    },
    publicIpv4Pool: {
      type: 'string',
      description: 'Public IPv4 pool',
      nullable: true,
    },
  },
}
