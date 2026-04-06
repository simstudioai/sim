import type {
  CloudFormationDescribeStacksParams,
  CloudFormationDescribeStacksResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const describeStacksTool: ToolConfig<
  CloudFormationDescribeStacksParams,
  CloudFormationDescribeStacksResponse
> = {
  id: 'cloudformation_describe_stacks',
  name: 'CloudFormation Describe Stacks',
  description: 'List and describe CloudFormation stacks',
  version: '1.0',

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
      required: false,
      visibility: 'user-or-llm',
      description: 'Stack name or ID to describe (omit to list all stacks)',
    },
  },

  request: {
    url: '/api/tools/cloudformation/describe-stacks',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.stackName && { stackName: params.stackName }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe CloudFormation stacks')
    }

    return {
      success: true,
      output: {
        stacks: data.output.stacks,
      },
    }
  },

  outputs: {
    stacks: {
      type: 'array',
      description: 'List of CloudFormation stacks with status, outputs, and tags',
    },
  },
}
