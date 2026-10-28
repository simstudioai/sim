import type { Ec2TerminateInstancesParams, Ec2TerminateInstancesResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const terminateInstancesTool: InternalToolConfig<
  Ec2TerminateInstancesParams,
  Ec2TerminateInstancesResponse
> = {
  id: 'ec2_terminate_instances',
  name: 'EC2 Terminate Instances',
  description: 'Permanently terminate one or more EC2 instances',
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
      description: 'Comma-separated instance IDs to terminate',
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
      throw new Error(data.error || 'Failed to run EC2 Terminate Instances')
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
            description: 'State after the request (e.g., shutting-down, terminated)',
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
