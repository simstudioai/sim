import {
  CROWDSTRIKE_AFFECTED_ENTITIES_OUTPUT,
  CROWDSTRIKE_ERRORS_OUTPUT,
} from '@/tools/crowdstrike/outputs'
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
    'Take a containment or visibility action on CrowdStrike Falcon hosts (POST /devices/entities/devices-actions/v2). "contain" network-isolates the host so it can only reach the Falcon cloud, cutting it off from the rest of the network; "lift_containment" restores normal network access; "hide_host" removes the host from the Falcon console host list and "unhide_host" restores it. Containment is immediately disruptive to the endpoint. Requires the "Hosts: Write" API scope.',
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
        'Action to take: contain, lift_containment, hide_host, or unhide_host. "contain" network-isolates the host.',
    },
    deviceIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of CrowdStrike host agent IDs (AIDs) to act on',
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
    affected: CROWDSTRIKE_AFFECTED_ENTITIES_OUTPUT,
    count: {
      type: 'number',
      description: 'Number of hosts the action was applied to',
    },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}
