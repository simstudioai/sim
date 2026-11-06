import type {
  Ec2DisassociateAddressParams,
  Ec2DisassociateAddressResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const disassociateAddressTool: InternalToolConfig<
  Ec2DisassociateAddressParams,
  Ec2DisassociateAddressResponse
> = {
  id: 'ec2_disassociate_address',
  name: 'EC2 Disassociate Address',
  description: 'Disassociate an Elastic IP address from its instance or network interface',
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
    associationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Association ID of the Elastic IP (e.g., eipassoc-0abc123)',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        associationId: params.associationId,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Disassociate Address')
    }

    return {
      success: true,
      output: {
        disassociated: data.disassociated ?? false,
        associationId: data.associationId ?? '',
      },
    }
  },

  outputs: {
    disassociated: {
      type: 'boolean',
      description: 'Whether the address was disassociated',
    },
    associationId: {
      type: 'string',
      description: 'Association ID that was removed',
    },
  },
}
