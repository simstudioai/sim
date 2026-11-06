import type { Ec2ReleaseAddressParams, Ec2ReleaseAddressResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const releaseAddressTool: InternalToolConfig<
  Ec2ReleaseAddressParams,
  Ec2ReleaseAddressResponse
> = {
  id: 'ec2_release_address',
  name: 'EC2 Release Address',
  description: 'Release an Elastic IP address back to AWS',
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
    allocationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Allocation ID of the Elastic IP to release',
    },
    networkBorderGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Network border group the address was allocated from',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        allocationId: params.allocationId,
        networkBorderGroup: params.networkBorderGroup,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Release Address')
    }

    return {
      success: true,
      output: {
        released: data.released ?? false,
        allocationId: data.allocationId ?? '',
      },
    }
  },

  outputs: {
    released: {
      type: 'boolean',
      description: 'Whether the address was released',
    },
    allocationId: {
      type: 'string',
      description: 'Allocation ID that was released',
    },
  },
}
