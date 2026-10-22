import type { Ec2RebootInstancesParams, Ec2RebootInstancesResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const rebootInstancesTool: InternalToolConfig<
  Ec2RebootInstancesParams,
  Ec2RebootInstancesResponse
> = {
  id: 'ec2_reboot_instances',
  name: 'EC2 Reboot Instances',
  description: 'Request a reboot of one or more EC2 instances',
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
    instanceIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated instance IDs to reboot',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        instanceIds: params.instanceIds,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Reboot Instances')
    }

    return {
      success: true,
      output: {
        rebooted: data.rebooted ?? false,
        instanceIds: data.instanceIds ?? [],
      },
    }
  },

  outputs: {
    rebooted: {
      type: 'boolean',
      description: 'Whether the reboot request was accepted',
    },
    instanceIds: {
      type: 'array',
      description: 'Instance IDs that were sent the reboot request',
      items: { type: 'string' },
    },
  },
}
