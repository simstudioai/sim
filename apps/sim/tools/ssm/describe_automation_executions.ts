import type {
  SsmDescribeAutomationExecutionsParams,
  SsmDescribeAutomationExecutionsResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const describeAutomationExecutionsTool: InternalToolConfig<
  SsmDescribeAutomationExecutionsParams,
  SsmDescribeAutomationExecutionsResponse
> = {
  id: 'ssm_describe_automation_executions',
  name: 'SSM Describe Automation Executions',
  description: 'List Automation runbook executions in an AWS account',
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
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters, as an array of {Key, Values} objects. Valid keys: DocumentNamePrefix, ExecutionStatus, ExecutionId, ParentExecutionId, CurrentAction, StartTimeBefore, StartTimeAfter, AutomationType, TagKey, TargetResourceGroup, AutomationSubtype, OpsItemId',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of executions to return (1-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      filters: params.filters,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe automation executions')
    }

    return {
      success: true,
      output: {
        automationExecutions: data.automationExecutions ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    automationExecutions: {
      type: 'json',
      description:
        'Executions, each with automationExecutionId, documentName, documentVersion, automationExecutionStatus, executionStartTime, executionEndTime, executedBy, currentStepName, currentAction, failureMessage, and outputs',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Number of executions returned',
    },
  },
}
