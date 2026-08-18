import type {
  CrowdStrikeUpdateAlertsParams,
  CrowdStrikeUpdateAlertsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeUpdateAlertsTool: ToolConfig<
  CrowdStrikeUpdateAlertsParams,
  CrowdStrikeUpdateAlertsResponse
> = {
  id: 'crowdstrike_update_alerts',
  name: 'CrowdStrike Update Alerts',
  description:
    'Update CrowdStrike Falcon alerts by composite ID: change status, assign or unassign an analyst, add or remove tags, append a comment, or toggle visibility (PATCH /alerts/entities/alerts/v3). This modifies live alerts in the Falcon console. Requires the "Alerts: Write" API scope.',
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
    compositeIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of CrowdStrike composite alert IDs to update',
    },
    updateStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New alert status: new, in_progress, reopened, or closed',
    },
    assignToUuid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assign the alert to this Falcon user UUID',
    },
    assignToUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assign the alert to this Falcon user ID, such as user@example.com',
    },
    assignToName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assign the alert to this Falcon username, such as John Doe',
    },
    unassign: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Clear the assigned user UUID, user ID, and username from the alert',
    },
    appendComment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment to append to the alert in the Falcon console',
    },
    addTag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag to add to the alert',
    },
    removeTag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag to remove from the alert',
    },
    removeTagsByPrefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Remove every tag on the alert that starts with this prefix',
    },
    showInUi: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the alert is displayed in the Falcon console',
    },
    actionParameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Raw JSON array of additional CrowdStrike action parameters, each shaped { "name": string, "value": string }',
    },
    includeHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include previously hidden alerts (CrowdStrike defaults this to true)',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      actionParameters: params.actionParameters,
      addTag: params.addTag,
      appendComment: params.appendComment,
      assignToName: params.assignToName,
      assignToUserId: params.assignToUserId,
      assignToUuid: params.assignToUuid,
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      compositeIds: params.compositeIds,
      includeHidden: params.includeHidden,
      operation: 'crowdstrike_update_alerts',
      removeTag: params.removeTag,
      removeTagsByPrefix: params.removeTagsByPrefix,
      showInUi: params.showInUi,
      unassign: params.unassign,
      updateStatus: params.updateStatus,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to update CrowdStrike alerts')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    updatedIds: {
      type: 'array',
      description: 'Composite alert IDs the update was submitted for',
      items: { type: 'string' },
    },
    count: {
      type: 'number',
      description: 'Number of alerts the update was submitted for',
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
