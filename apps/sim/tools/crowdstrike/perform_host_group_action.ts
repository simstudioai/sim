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
        properties: {
          id: { type: 'string', description: 'Host group identifier', optional: true },
          name: { type: 'string', description: 'Host group name', optional: true },
          description: { type: 'string', description: 'Host group description', optional: true },
          groupType: {
            type: 'string',
            description: 'Group type (static, dynamic, staticByID)',
            optional: true,
          },
          assignmentRule: {
            type: 'string',
            description: 'FQL assignment rule for dynamic groups',
            optional: true,
          },
          createdBy: { type: 'string', description: 'User who created the group', optional: true },
          createdTimestamp: {
            type: 'string',
            description: 'Group creation timestamp',
            optional: true,
          },
          modifiedBy: {
            type: 'string',
            description: 'User who last modified the group',
            optional: true,
          },
          modifiedTimestamp: {
            type: 'string',
            description: 'Group modification timestamp',
            optional: true,
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of host group records returned',
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
