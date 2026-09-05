import type {
  SsmGetCommandInvocationParams,
  SsmGetCommandInvocationResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const getCommandInvocationTool: InternalToolConfig<
  SsmGetCommandInvocationParams,
  SsmGetCommandInvocationResponse
> = {
  id: 'ssm_get_command_invocation',
  name: 'SSM Get Command Invocation',
  description: 'Read the output and status of a Run Command execution on one managed node',
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
      description: 'ID of the command, as returned by ssm_send_command',
    },
    instanceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Managed node the command ran on (e.g., i-0abc123)',
    },
    pluginName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name of the document plugin to read output for; required for documents with more than one plugin',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      commandId: params.commandId,
      instanceId: params.instanceId,
      pluginName: params.pluginName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get command invocation')
    }

    return {
      success: true,
      output: {
        commandId: data.commandId ?? '',
        instanceId: data.instanceId ?? '',
        comment: data.comment ?? null,
        documentName: data.documentName ?? null,
        documentVersion: data.documentVersion ?? null,
        pluginName: data.pluginName ?? null,
        responseCode: data.responseCode ?? null,
        executionStartDateTime: data.executionStartDateTime ?? null,
        executionElapsedTime: data.executionElapsedTime ?? null,
        executionEndDateTime: data.executionEndDateTime ?? null,
        status: data.status ?? '',
        statusDetails: data.statusDetails ?? null,
        standardOutputContent: data.standardOutputContent ?? '',
        standardOutputUrl: data.standardOutputUrl ?? null,
        standardErrorContent: data.standardErrorContent ?? '',
        standardErrorUrl: data.standardErrorUrl ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    commandId: {
      type: 'string',
      description: 'ID of the command',
    },
    instanceId: {
      type: 'string',
      description: 'Managed node the command ran on',
    },
    comment: {
      type: 'string',
      description: 'Comment supplied with the command',
      optional: true,
    },
    documentName: {
      type: 'string',
      description: 'Document that was run',
      optional: true,
    },
    documentVersion: {
      type: 'string',
      description: 'Document version that was run',
      optional: true,
    },
    pluginName: {
      type: 'string',
      description: 'Plugin the output belongs to',
      optional: true,
    },
    responseCode: {
      type: 'number',
      description: 'Exit code of the command, or -1 if it has not started',
      optional: true,
    },
    executionStartDateTime: {
      type: 'string',
      description: 'When the command started running on the node',
      optional: true,
    },
    executionElapsedTime: {
      type: 'string',
      description: 'How long the command ran, as an ISO 8601 duration',
      optional: true,
    },
    executionEndDateTime: {
      type: 'string',
      description: 'When the command finished running on the node',
      optional: true,
    },
    status: {
      type: 'string',
      description:
        'Invocation status (Pending, InProgress, Delayed, Success, Cancelled, TimedOut, Failed, Cancelling)',
    },
    statusDetails: {
      type: 'string',
      description: 'Detailed status of the invocation',
      optional: true,
    },
    standardOutputContent: {
      type: 'string',
      description:
        'First 24000 characters of stdout; longer output is available at standardOutputUrl',
    },
    standardOutputUrl: {
      type: 'string',
      description: 'S3 URL of the full stdout, if S3 output was configured',
      optional: true,
    },
    standardErrorContent: {
      type: 'string',
      description:
        'First 8000 characters of stderr; longer output is available at standardErrorUrl',
    },
    standardErrorUrl: {
      type: 'string',
      description: 'S3 URL of the full stderr, if S3 output was configured',
      optional: true,
    },
  },
}
