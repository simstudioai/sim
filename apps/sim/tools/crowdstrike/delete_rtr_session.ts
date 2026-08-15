import { CROWDSTRIKE_ERRORS_OUTPUT } from '@/tools/crowdstrike/outputs'
import type {
  CrowdStrikeDeleteRtrSessionParams,
  CrowdStrikeDeleteRtrSessionResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeDeleteRtrSessionTool: ToolConfig<
  CrowdStrikeDeleteRtrSessionParams,
  CrowdStrikeDeleteRtrSessionResponse
> = {
  id: 'crowdstrike_delete_rtr_session',
  name: 'CrowdStrike Delete RTR Session',
  description:
    'Close an open CrowdStrike Falcon Real Time Response session (DELETE /real-time-response/entities/sessions/v1). Requires the "Real time response: Read" API scope.',
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
      description: 'RTR session ID to close',
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
      operation: 'crowdstrike_delete_rtr_session',
      sessionId: params.sessionId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to delete CrowdStrike RTR session')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    sessionId: { type: 'string', description: 'RTR session ID that was closed' },
    deleted: { type: 'boolean', description: 'Whether CrowdStrike accepted the session deletion' },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}
