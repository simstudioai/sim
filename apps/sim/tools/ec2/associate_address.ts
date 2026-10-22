import type { Ec2AssociateAddressParams, Ec2AssociateAddressResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const associateAddressTool: InternalToolConfig<
  Ec2AssociateAddressParams,
  Ec2AssociateAddressResponse
> = {
  id: 'ec2_associate_address',
  name: 'EC2 Associate Address',
  description: 'Associate an Elastic IP address with an instance or network interface',
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
      description: 'Allocation ID of the Elastic IP (e.g., eipalloc-0abc123)',
    },
    instanceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instance ID to associate with (provide this or networkInterfaceId)',
    },
    networkInterfaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Network interface ID to associate with (provide this or instanceId)',
    },
    privateIpAddress: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Private IP address on the target to associate with',
    },
    allowReassociation: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Allow moving an Elastic IP that is already associated',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        allocationId: params.allocationId,
        instanceId: params.instanceId,
        networkInterfaceId: params.networkInterfaceId,
        privateIpAddress: params.privateIpAddress,
        allowReassociation: params.allowReassociation,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Associate Address')
    }

    return {
      success: true,
      output: {
        associationId: data.associationId ?? '',
      },
    }
  },

  outputs: {
    associationId: {
      type: 'string',
      description: 'ID of the new association',
    },
  },
}
