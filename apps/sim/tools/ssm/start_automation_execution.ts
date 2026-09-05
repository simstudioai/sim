import type {
  SsmStartAutomationExecutionParams,
  SsmStartAutomationExecutionResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const startAutomationExecutionTool: InternalToolConfig<
  SsmStartAutomationExecutionParams,
  SsmStartAutomationExecutionResponse
> = {
  id: 'ssm_start_automation_execution',
  name: 'SSM Start Automation Execution',
  description: 'Start an AWS Systems Manager Automation runbook execution',
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
    documentName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Automation runbook to run (e.g., AWS-RestartEC2Instance)',
    },
    documentVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Runbook version to run ($LATEST, $DEFAULT, or a version number)',
    },
    parameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Runbook parameters, as an object mapping each parameter name to an array of string values',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Execution mode, Auto or Interactive',
    },
    targetParameterName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Runbook parameter that receives each resolved target; required when targets is set',
    },
    targets: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Rate-control target, as an array holding a single {Key, Values} object; requires targetParameterName',
    },
    maxConcurrency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number or percentage of targets to run against at once (e.g., 10 or 50%)',
    },
    maxErrors: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number or percentage of errors allowed before the execution stops (e.g., 0 or 10%)',
    },
    clientToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Idempotency token, exactly 36 characters',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      documentName: params.documentName,
      documentVersion: params.documentVersion,
      parameters: params.parameters,
      mode: params.mode,
      targetParameterName: params.targetParameterName,
      targets: params.targets,
      maxConcurrency: params.maxConcurrency,
      maxErrors: params.maxErrors,
      clientToken: params.clientToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start automation execution')
    }

    return {
      success: true,
      output: {
        automationExecutionId: data.automationExecutionId ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    automationExecutionId: {
      type: 'string',
      description:
        'ID of the execution; pass it to ssm_get_automation_execution or ssm_stop_automation_execution',
    },
  },
}
