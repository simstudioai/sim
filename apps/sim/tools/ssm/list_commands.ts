import type { SsmListCommandsParams, SsmListCommandsResponse } from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const listCommandsTool: InternalToolConfig<SsmListCommandsParams, SsmListCommandsResponse> =
  {
    id: 'ssm_list_commands',
    name: 'SSM List Commands',
    description: 'List Run Command executions in an AWS account',
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
        required: false,
        visibility: 'user-or-llm',
        description: 'Return only the command with this ID',
      },
      instanceId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Return only commands sent to this managed node',
      },
      filters: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Filters, as an array of {key, value} objects. Valid keys: InvokedAfter, InvokedBefore, Status, ExecutionStage, DocumentName',
      },
      maxResults: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of commands to return (1-50)',
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
        commandId: params.commandId,
        instanceId: params.instanceId,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to list commands')
      }

      return {
        success: true,
        output: {
          commands: data.commands ?? [],
          nextToken: data.nextToken ?? null,
          count: data.count ?? 0,
        },
        error: undefined,
      }
    },

    outputs: {
      commands: {
        type: 'json',
        description:
          'Commands, each with commandId, documentName, status, statusDetails, requestedDateTime, instanceIds, targets, targetCount, completedCount, and errorCount',
      },
      nextToken: {
        type: 'string',
        description: 'Pagination token for the next page of results',
        optional: true,
      },
      count: {
        type: 'number',
        description: 'Number of commands returned',
      },
    },
  }
