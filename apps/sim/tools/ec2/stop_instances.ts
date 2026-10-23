import type { Ec2StopInstancesParams, Ec2StopInstancesResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const stopInstancesTool: InternalToolConfig<
  Ec2StopInstancesParams,
  Ec2StopInstancesResponse
> = {
  id: 'ec2_stop_instances',
  name: 'EC2 Stop Instances',
  description: 'Stop one or more running EC2 instances',
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
      description: 'Comma-separated instance IDs to stop',
    },
    hibernate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Hibernate the instances instead of stopping them (hibernation must be enabled on the instance)',
    },
    force: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Force the instances to stop without flushing file system caches',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        instanceIds: params.instanceIds,
        hibernate: params.hibernate,
        force: params.force,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Stop Instances')
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
            description: 'State after the request (e.g., stopping, stopped)',
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
