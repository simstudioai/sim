import type { Ec2StartInstancesParams, Ec2StartInstancesResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const startInstancesTool: InternalToolConfig<
  Ec2StartInstancesParams,
  Ec2StartInstancesResponse
> = {
  id: 'ec2_start_instances',
  name: 'EC2 Start Instances',
  description: 'Start one or more stopped EC2 instances',
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
      description: 'Comma-separated instance IDs to start',
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
      throw new Error(data.error || 'Failed to run EC2 Start Instances')
    }

    return {
      success: true,
      output: {
        instances: data.instances ?? [],
      },
    }
  },

  outputs: {
    instances: {
      type: 'array',
      description: 'State transition for each instance',
      items: {
        type: 'object',
        properties: {
          instanceId: {
            type: 'string',
            description: 'Instance ID',
          },
          currentState: {
            type: 'string',
            description: 'State after the request (e.g., pending, running)',
            nullable: true,
          },
          previousState: {
            type: 'string',
            description: 'State before the request',
            nullable: true,
          },
        },
      },
    },
  },
}
