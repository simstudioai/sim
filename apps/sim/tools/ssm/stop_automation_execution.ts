import type {
  SsmStopAutomationExecutionParams,
  SsmStopAutomationExecutionResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const stopAutomationExecutionTool: InternalToolConfig<
  SsmStopAutomationExecutionParams,
  SsmStopAutomationExecutionResponse
> = {
  id: 'ssm_stop_automation_execution',
  name: 'SSM Stop Automation Execution',
  description: 'Stop a running AWS Systems Manager Automation execution',
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
    automationExecutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the execution to stop, as returned by ssm_start_automation_execution',
    },
    stopType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How to stop the execution: Cancel to stop it immediately, or Complete to let the current step finish',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      automationExecutionId: params.automationExecutionId,
      stopType: params.stopType,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to stop automation execution')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        automationExecutionId: data.automationExecutionId ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Operation status message',
    },
    automationExecutionId: {
      type: 'string',
      description: 'ID of the execution that was stopped',
    },
  },
}
