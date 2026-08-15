import {
  CROWDSTRIKE_ERRORS_OUTPUT,
  CROWDSTRIKE_HOST_GROUP_OUTPUT_PROPERTIES,
} from '@/tools/crowdstrike/outputs'
import type {
  CrowdStrikeGetHostGroupDetailsParams,
  CrowdStrikeGetHostGroupDetailsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeGetHostGroupDetailsTool: ToolConfig<
  CrowdStrikeGetHostGroupDetailsParams,
  CrowdStrikeGetHostGroupDetailsResponse
> = {
  id: 'crowdstrike_get_host_group_details',
  name: 'CrowdStrike Get Host Group Details',
  description:
    'Get CrowdStrike Falcon host group records for one or more group IDs (GET /devices/entities/host-groups/v1). Requires the "Host groups: Read" API scope.',
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
    hostGroupIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of CrowdStrike host group IDs',
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
      hostGroupIds: params.hostGroupIds,
      operation: 'crowdstrike_get_host_group_details',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to fetch CrowdStrike host group details')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    hostGroups: {
      type: 'array',
      description: 'CrowdStrike host group records',
      items: {
        type: 'object',
        properties: CROWDSTRIKE_HOST_GROUP_OUTPUT_PROPERTIES,
      },
    },
    count: {
      type: 'number',
      description: 'Number of host groups returned',
    },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}
