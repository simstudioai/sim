import type { SsmCancelCommandParams, SsmCancelCommandResponse } from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const cancelCommandTool: InternalToolConfig<
  SsmCancelCommandParams,
  SsmCancelCommandResponse
> = {
  id: 'ssm_cancel_command',
  name: 'SSM Cancel Command',
  description: 'Cancel an in-flight Run Command execution',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    commandId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the command to cancel, as returned by ssm_send_command',
    },
    instanceIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Managed node IDs to cancel on, as an array of strings; omit to cancel on every targeted node',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      commandId: params.commandId,
      instanceIds: params.instanceIds,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to cancel command')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        commandId: data.commandId ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Operation status message',
    },
    commandId: {
      type: 'string',
      description: 'ID of the command that was cancelled',
    },
  },
}
