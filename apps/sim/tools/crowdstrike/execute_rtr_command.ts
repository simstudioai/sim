import { CROWDSTRIKE_ERRORS_OUTPUT } from '@/tools/crowdstrike/outputs'
import type {
  CrowdStrikeExecuteRtrCommandParams,
  CrowdStrikeExecuteRtrCommandResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeExecuteRtrCommandTool: ToolConfig<
  CrowdStrikeExecuteRtrCommandParams,
  CrowdStrikeExecuteRtrCommandResponse
> = {
  id: 'crowdstrike_execute_rtr_command',
  name: 'CrowdStrike Execute RTR Command',
  description:
    'Run a read-only Real Time Response command inside an open CrowdStrike Falcon session (POST /real-time-response/entities/command/v1). Documented read-only base commands: cat, cd, clear, env, eventlog, filehash, getsid, help, history, ipconfig, ls, mount, netstat, ps, and "reg query". Commands that write to or modify the host require the Active Responder or Admin RTR endpoints, which this tool does not expose. Returns a cloud request ID; poll Get RTR Command Status for output. Requires the "Real time response: Read" API scope.',
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
    sessionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'RTR session ID returned by Init RTR Session',
    },
    baseCommand: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Read-only RTR base command: cat, cd, clear, env, eventlog, filehash, getsid, help, history, ipconfig, ls, mount, netstat, ps, or "reg query"',
    },
    commandString: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Full command line to run, such as "ls C:\\Windows" or "reg query HKLM\\Software"',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      baseCommand: params.baseCommand,
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      commandString: params.commandString,
      operation: 'crowdstrike_execute_rtr_command',
      sessionId: params.sessionId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to execute CrowdStrike RTR command')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    cloudRequestId: {
      type: 'string',
      description: 'Cloud request ID to poll for command output',
      optional: true,
    },
    sessionId: { type: 'string', description: 'RTR session the command ran in', optional: true },
    queuedCommandOffline: {
      type: 'boolean',
      description: 'Whether the command was queued for an offline host',
      optional: true,
    },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}
