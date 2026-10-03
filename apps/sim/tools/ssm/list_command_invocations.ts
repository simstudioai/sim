import type {
  SsmListCommandInvocationsParams,
  SsmListCommandInvocationsResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const listCommandInvocationsTool: InternalToolConfig<
  SsmListCommandInvocationsParams,
  SsmListCommandInvocationsResponse
> = {
  id: 'ssm_list_command_invocations',
  name: 'SSM List Command Invocations',
  description: 'List the per-node invocations of Run Command executions',
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
      description: 'Return only invocations of this command',
    },
    instanceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only invocations on this managed node',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters, as an array of {key, value} objects. Valid keys: InvokedAfter, InvokedBefore, Status, DocumentName',
    },
    details: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include per-plugin detail (command plugins and their output) for each invocation',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of invocations to return (1-50)',
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
      details: params.details,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list command invocations')
    }

    return {
      success: true,
      output: {
        commandInvocations: data.commandInvocations ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    commandInvocations: {
      type: 'json',
      description:
        'Invocations, each with commandId, instanceId, instanceName, status, statusDetails, requestedDateTime, standardOutputUrl, standardErrorUrl, and commandPlugins',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Number of invocations returned',
    },
  },
}
