import type {
  SsmGetAutomationExecutionParams,
  SsmGetAutomationExecutionResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const getAutomationExecutionTool: InternalToolConfig<
  SsmGetAutomationExecutionParams,
  SsmGetAutomationExecutionResponse
> = {
  id: 'ssm_get_automation_execution',
  name: 'SSM Get Automation Execution',
  description: 'Read the status, outputs, and step results of one Automation execution',
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
      description: 'ID of the execution, as returned by ssm_start_automation_execution',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      automationExecutionId: params.automationExecutionId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get automation execution')
    }

    return {
      success: true,
      output: {
        automationExecutionId: data.automationExecutionId ?? '',
        documentName: data.documentName ?? '',
        documentVersion: data.documentVersion ?? null,
        automationExecutionStatus: data.automationExecutionStatus ?? '',
        executionStartTime: data.executionStartTime ?? null,
        executionEndTime: data.executionEndTime ?? null,
        executedBy: data.executedBy ?? null,
        mode: data.mode ?? null,
        parentAutomationExecutionId: data.parentAutomationExecutionId ?? null,
        currentStepName: data.currentStepName ?? null,
        currentAction: data.currentAction ?? null,
        failureMessage: data.failureMessage ?? null,
        targetParameterName: data.targetParameterName ?? null,
        target: data.target ?? null,
        maxConcurrency: data.maxConcurrency ?? null,
        maxErrors: data.maxErrors ?? null,
        parameters: data.parameters ?? null,
        outputs: data.outputs ?? null,
        stepExecutions: data.stepExecutions ?? [],
        stepExecutionsTruncated: data.stepExecutionsTruncated ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    automationExecutionId: {
      type: 'string',
      description: 'ID of the execution',
    },
    documentName: {
      type: 'string',
      description: 'Runbook that was run',
    },
    documentVersion: {
      type: 'string',
      description: 'Runbook version that was run',
      optional: true,
    },
    automationExecutionStatus: {
      type: 'string',
      description:
        'Execution status (Pending, InProgress, Waiting, Success, TimedOut, Cancelling, Cancelled, Failed, and related values)',
    },
    executionStartTime: {
      type: 'string',
      description: 'When the execution started',
      optional: true,
    },
    executionEndTime: {
      type: 'string',
      description: 'When the execution finished',
      optional: true,
    },
    executedBy: {
      type: 'string',
      description: 'IAM identity that started the execution',
      optional: true,
    },
    mode: {
      type: 'string',
      description: 'Execution mode, Auto or Interactive',
      optional: true,
    },
    parentAutomationExecutionId: {
      type: 'string',
      description: 'ID of the parent execution, for a child execution',
      optional: true,
    },
    currentStepName: {
      type: 'string',
      description: 'Step the execution is currently running',
      optional: true,
    },
    currentAction: {
      type: 'string',
      description: 'Action the execution is currently running',
      optional: true,
    },
    failureMessage: {
      type: 'string',
      description: 'Reason the execution failed',
      optional: true,
    },
    targetParameterName: {
      type: 'string',
      description: 'Runbook parameter that received each resolved target',
      optional: true,
    },
    target: {
      type: 'string',
      description: 'Resource the execution targeted',
      optional: true,
    },
    maxConcurrency: {
      type: 'string',
      description: 'Concurrency setting the execution ran with',
      optional: true,
    },
    maxErrors: {
      type: 'string',
      description: 'Error threshold the execution ran with',
      optional: true,
    },
    parameters: {
      type: 'json',
      description: 'Parameter values the execution was started with',
      optional: true,
    },
    outputs: {
      type: 'json',
      description: 'Outputs the execution produced',
      optional: true,
    },
    stepExecutions: {
      type: 'json',
      description:
        'Steps, each with stepName, action, stepStatus, stepExecutionId, executionStartTime, executionEndTime, failureMessage, response, isEnd, and nextStep',
    },
    stepExecutionsTruncated: {
      type: 'boolean',
      description: 'Whether the returned step list was truncated',
      optional: true,
    },
  },
}
