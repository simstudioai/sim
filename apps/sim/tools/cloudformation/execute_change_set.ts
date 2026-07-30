import type {
  CloudFormationExecuteChangeSetParams,
  CloudFormationExecuteChangeSetResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const executeChangeSetTool: ToolConfig<
  CloudFormationExecuteChangeSetParams,
  CloudFormationExecuteChangeSetResponse
> = {
  id: 'cloudformation_execute_change_set',
  name: 'CloudFormation Execute Change Set',
  description: 'Apply a previously created and reviewed change set to its stack',
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
    changeSetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name or ARN of the change set to execute',
    },
    stackName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name or ID of the stack the change set belongs to (required if changeSetName is not an ARN)',
    },
  },

  request: {
    url: '/api/tools/cloudformation/execute-change-set',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      changeSetName: params.changeSetName,
      ...(params.stackName && { stackName: params.stackName }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to execute CloudFormation change set')
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
