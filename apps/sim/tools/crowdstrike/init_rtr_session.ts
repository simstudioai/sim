import type {
  CrowdStrikeInitRtrSessionParams,
  CrowdStrikeInitRtrSessionResponse,
} from '@/tools/crowdstrike/types'
import type { InternalToolConfig } from '@/tools/types'

export const crowdstrikeInitRtrSessionTool: InternalToolConfig<
  CrowdStrikeInitRtrSessionParams,
  CrowdStrikeInitRtrSessionResponse
> = {
  id: 'crowdstrike_init_rtr_session',
  name: 'CrowdStrike Init RTR Session',
  description:
    'Open a CrowdStrike Falcon Real Time Response session against a host so read-only commands can be run on it (POST /real-time-response/entities/sessions/v1). This connects a live remote shell to the endpoint. Requires the "Real time response: Read" API scope.',
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
    deviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'CrowdStrike host agent ID (AID) to open the session against',
    },
    queueOffline: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Queue the session so it runs when an offline host comes back online',
    },
    origin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional session origin string recorded by CrowdStrike',
    },
  },

  operation: {
    input: (params) => ({
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      deviceId: params.deviceId,
      operation: 'crowdstrike_init_rtr_session',
      origin: params.origin,
      queueOffline: params.queueOffline,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to initialize CrowdStrike RTR session')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    sessionId: {
      type: 'string',
      description: 'RTR session ID to use for subsequent commands',
      optional: true,
    },
    deviceId: { type: 'string', description: 'Host agent ID for the session', optional: true },
    platform: { type: 'string', description: 'Platform of the connected host', optional: true },
    pwd: {
      type: 'string',
      description: 'Working directory the session started in',
      optional: true,
    },
    offlineQueued: {
      type: 'boolean',
      description: 'Whether the session was queued for an offline host',
      optional: true,
    },
    existingAidSessions: {
      type: 'number',
      description: 'Number of sessions already open against this host',
      optional: true,
    },
    createdAt: { type: 'string', description: 'Session creation timestamp', optional: true },
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
