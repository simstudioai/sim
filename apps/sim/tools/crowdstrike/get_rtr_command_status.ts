import type {
  CrowdStrikeGetRtrCommandStatusParams,
  CrowdStrikeGetRtrCommandStatusResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeGetRtrCommandStatusTool: ToolConfig<
  CrowdStrikeGetRtrCommandStatusParams,
  CrowdStrikeGetRtrCommandStatusResponse
> = {
  id: 'crowdstrike_get_rtr_command_status',
  name: 'CrowdStrike Get RTR Command Status',
  description:
    'Get the status and output of a Real Time Response command by cloud request ID (GET /real-time-response/entities/command/v1). Long output is chunked across sequences, so increment the sequence ID to read the next chunk. Requires the "Real time response: Read" API scope.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client secret',
    },
    cloud: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon cloud region',
    },
    cloudRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cloud request ID returned by Execute RTR Command',
    },
    sequenceId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output chunk to retrieve, starting at 0',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      cloudRequestId: params.cloudRequestId,
      operation: 'crowdstrike_get_rtr_command_status',
      sequenceId: params.sequenceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to fetch CrowdStrike RTR command status')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    complete: {
      type: 'boolean',
      description: 'Whether the command has finished running',
      optional: true,
    },
    stdout: { type: 'string', description: 'Standard output from the command', optional: true },
    stderr: { type: 'string', description: 'Standard error from the command', optional: true },
    baseCommand: { type: 'string', description: 'Base command that was run', optional: true },
    sessionId: { type: 'string', description: 'RTR session the command ran in', optional: true },
    taskId: { type: 'string', description: 'Task identifier for the command', optional: true },
    sequenceId: {
      type: 'number',
      description: 'Output chunk sequence this response covers',
      optional: true,
    },
    errors: {
      type: 'array',
      description: 'Errors CrowdStrike returned alongside a partially successful response',
      optional: true,
      items: {
        type: 'object',
        properties: {
          code: { type: 'number', description: 'CrowdStrike error code', optional: true },
          id: { type: 'string', description: 'Identifier the error applies to', optional: true },
          message: { type: 'string', description: 'Error message', optional: true },
        },
      },
    },
  },
}
