import type {
  CrowdStrikePerformHostActionParams,
  CrowdStrikePerformHostActionResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikePerformHostActionTool: ToolConfig<
  CrowdStrikePerformHostActionParams,
  CrowdStrikePerformHostActionResponse
> = {
  id: 'crowdstrike_perform_host_action',
  name: 'CrowdStrike Perform Host Action',
  description:
    'Act on CrowdStrike Falcon hosts (POST /devices/entities/devices-actions/v2). Actions: contain, lift_containment, hide_host, unhide_host, detection_suppress, detection_unsuppress. contain network-isolates the host so it can only reach the Falcon cloud; hide_host removes the host record from the console. Both are immediately disruptive. Up to 100 host IDs per call. Requires the "Hosts: Write" API scope.',
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
    actionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Action to take: contain, lift_containment, hide_host, unhide_host, detection_suppress, or detection_unsuppress. "contain" network-isolates the host; "hide_host" removes it from the Falcon console.',
    },
    deviceIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of up to 100 CrowdStrike host agent IDs (AIDs) to act on',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      actionName: params.actionName,
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      deviceIds: params.deviceIds,
      operation: 'crowdstrike_perform_host_action',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to perform CrowdStrike host action')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    affected: {
      type: 'array',
      description: 'Entities affected by the action',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Affected entity identifier', optional: true },
          path: { type: 'string', description: 'API path of the affected entity', optional: true },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of hosts the action was applied to',
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
