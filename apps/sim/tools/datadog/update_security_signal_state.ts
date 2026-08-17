import type {
  UpdateSecuritySignalStateParams,
  UpdateSecuritySignalStateResponse,
} from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
  mapSignalTriageData,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const updateSecuritySignalStateTool: ToolConfig<
  UpdateSecuritySignalStateParams,
  UpdateSecuritySignalStateResponse
> = {
  id: 'datadog_update_security_signal_state',
  name: 'Datadog Update Security Signal State',
  description:
    'Change the triage state of a Cloud SIEM security signal to open, under_review, or archived. Requires the `security_monitoring_signals_write` permission.',
  version: '1.0.0',

  params: {
    signalId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the security signal',
    },
    state: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New triage state: "open", "under_review", or "archived"',
    },
    archiveReason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Reason when archiving: none, false_positive, testing_or_maintenance, remediated, investigated_case_opened, true_positive_benign, true_positive_malicious, or other',
    },
    archiveComment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment explaining why the signal was archived',
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
        `/api/v2/security_monitoring/signals/${datadogPathSegment(params.signalId)}/state`
      ),
    method: 'PATCH',
    headers: datadogHeaders,
    body: (params) => {
      const attributes: Record<string, unknown> = { state: params.state }
      if (params.archiveReason) attributes.archive_reason = params.archiveReason
      if (params.archiveComment) attributes.archive_comment = params.archiveComment
      return { data: { attributes } }
    },
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
