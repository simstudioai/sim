import type {
  CloudFormationDeleteStackParams,
  CloudFormationDeleteStackResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const deleteStackTool: ToolConfig<
  CloudFormationDeleteStackParams,
  CloudFormationDeleteStackResponse
> = {
  id: 'cloudformation_delete_stack',
  name: 'CloudFormation Delete Stack',
  description: 'Delete a CloudFormation stack and its resources',
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
      description: 'Name or ID of the stack to delete',
    },
    retainResources: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated logical resource IDs to retain instead of deleting (only applies to stacks in DELETE_FAILED state)',
    },
  },

  request: {
    url: '/api/tools/cloudformation/delete-stack',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      stackName: params.stackName,
      ...(params.retainResources && { retainResources: params.retainResources }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete CloudFormation stack')
    }

    return {
      success: true,
      output: {
        message: data.output.message,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
