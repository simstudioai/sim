import type {
  CloudFormationDescribeStackEventsParams,
  CloudFormationDescribeStackEventsResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const describeStackEventsTool: ToolConfig<
  CloudFormationDescribeStackEventsParams,
  CloudFormationDescribeStackEventsResponse
> = {
  id: 'cloudformation_describe_stack_events',
  name: 'CloudFormation Describe Stack Events',
  description: 'Get the event history for a CloudFormation stack',
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
    stackName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stack name or ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return (default: 50)',
    },
  },

  request: {
    url: '/api/tools/cloudformation/describe-stack-events',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      stackName: params.stackName,
      ...(params.limit !== undefined && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe CloudFormation stack events')
    }

    return {
      success: true,
      output: {
        events: data.output.events,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of stack events with resource status and timestamps',
    },
  },
}
