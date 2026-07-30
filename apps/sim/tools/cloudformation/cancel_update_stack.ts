import type {
  CloudFormationCancelUpdateStackParams,
  CloudFormationCancelUpdateStackResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const cancelUpdateStackTool: ToolConfig<
  CloudFormationCancelUpdateStackParams,
  CloudFormationCancelUpdateStackResponse
> = {
  id: 'cloudformation_cancel_update_stack',
  name: 'CloudFormation Cancel Update Stack',
  description: 'Cancel an in-progress stack update and roll back to the last known stable state',
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
      description: 'Name or ID of the stack whose update should be cancelled',
    },
  },

  request: {
    url: '/api/tools/cloudformation/cancel-update-stack',
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
      throw new Error(data.error || 'Failed to cancel CloudFormation stack update')
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
