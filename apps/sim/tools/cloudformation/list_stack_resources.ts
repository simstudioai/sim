import type {
  CloudFormationListStackResourcesParams,
  CloudFormationListStackResourcesResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const listStackResourcesTool: ToolConfig<
  CloudFormationListStackResourcesParams,
  CloudFormationListStackResourcesResponse
> = {
  id: 'cloudformation_list_stack_resources',
  name: 'CloudFormation List Stack Resources',
  description: 'List all resources in a CloudFormation stack',
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
  },

  request: {
    url: '/api/tools/cloudformation/list-stack-resources',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      stackName: params.stackName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list CloudFormation stack resources')
    }

    return {
      success: true,
      output: {
        resources: data.output.resources,
      },
    }
  },

  outputs: {
    resources: {
      type: 'array',
      description: 'List of stack resources with type, status, and drift information',
    },
  },
}
