import {
  CROWDSTRIKE_ERRORS_OUTPUT,
  CROWDSTRIKE_HOST_GROUP_OUTPUT_PROPERTIES,
} from '@/tools/crowdstrike/outputs'
import type {
  CrowdStrikePerformHostGroupActionParams,
  CrowdStrikePerformHostGroupActionResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikePerformHostGroupActionTool: ToolConfig<
  CrowdStrikePerformHostGroupActionParams,
  CrowdStrikePerformHostGroupActionResponse
> = {
  id: 'crowdstrike_perform_host_group_action',
  name: 'CrowdStrike Perform Host Group Action',
  description:
    'Add hosts to or remove hosts from a CrowdStrike Falcon static host group (POST /devices/entities/host-group-actions/v1). Group membership drives policy assignment, so changing it changes which policies apply to those hosts. Requires the "Host groups: Write" API scope.',
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
      description: 'Action to take: add-hosts or remove-hosts',
    },
    hostGroupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'CrowdStrike host group ID to modify (static groups only)',
    },
    deviceIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of CrowdStrike host agent IDs (AIDs) to add to or remove from the group',
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
      hostGroupId: params.hostGroupId,
      operation: 'crowdstrike_perform_host_group_action',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to perform CrowdStrike host group action')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    hostGroups: {
      type: 'array',
      description: 'Host group records returned after the action',
      items: {
        type: 'object',
        properties: CROWDSTRIKE_HOST_GROUP_OUTPUT_PROPERTIES,
      },
    },
    count: {
      type: 'number',
      description: 'Number of host group records returned',
    },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}
