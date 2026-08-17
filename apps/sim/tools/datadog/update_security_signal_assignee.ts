import type {
  UpdateSecuritySignalAssigneeParams,
  UpdateSecuritySignalAssigneeResponse,
} from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
  mapSignalTriageData,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const updateSecuritySignalAssigneeTool: ToolConfig<
  UpdateSecuritySignalAssigneeParams,
  UpdateSecuritySignalAssigneeResponse
> = {
  id: 'datadog_update_security_signal_assignee',
  name: 'Datadog Assign Security Signal',
  description:
    'Assign a Cloud SIEM security signal to a Datadog user by UUID. Requires the `security_monitoring_signals_write` permission.',
  version: '1.0.0',

  params: {
    signalId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the security signal',
    },
    assigneeUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'UUID of the Datadog user to assign the signal to (e.g., "773b045d-ccf8-4808-bd3b-955ef6a8c940")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) =>
      datadogApiUrl(
        params.site,
        `/api/v2/security_monitoring/signals/${datadogPathSegment(params.signalId)}/assignee`
      ),
    method: 'PATCH',
    headers: datadogHeaders,
    body: (params) => ({
      data: { attributes: { assignee: { uuid: params.assigneeUuid } } },
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { signal: {} },
        error: await datadogErrorMessage(response),
      }
    }

    return {
      success: true,
      output: { signal: mapSignalTriageData(await response.json()) },
    }
  },

  outputs: {
    signal: {
      type: 'object',
      description: 'The updated signal triage data',
      properties: {
        id: { type: 'string', description: 'Signal ID' },
        type: { type: 'string', description: 'Resource type of the signal' },
        state: { type: 'string', description: 'Current triage state' },
        assignee: { type: 'object', description: 'User the signal is assigned to' },
        incidentIds: { type: 'array', description: 'IDs of incidents linked to the signal' },
        archiveReason: { type: 'string', description: 'Archive reason, when archived' },
        archiveComment: { type: 'string', description: 'Archive comment, when archived' },
        stateUpdateTimestamp: {
          type: 'number',
          description: 'Timestamp of the last state update',
        },
      },
    },
  },
}
