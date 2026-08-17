import type { UnmuteMonitorParams, UnmuteMonitorResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const unmuteMonitorTool: ToolConfig<UnmuteMonitorParams, UnmuteMonitorResponse> = {
  id: 'datadog_unmute_monitor',
  name: 'Datadog Unmute Monitor',
  description:
    'Unmute a monitor so it resumes sending notifications. Reverses Mute Monitor, either for one scope or for every scope at once.',
  version: '1.0.0',

  params: {
    monitorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the monitor to unmute (e.g., "12345678")',
    },
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Scope to unmute (e.g., "host:myhost"). Leave blank to unmute the monitor itself rather than a single scope.',
    },
    allScopes: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Clear the mute settings for every scope on this monitor',
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

  /**
   * `scope` and `all_scopes` are query parameters, not a request body: the
   * UnmuteMonitor operation declares no `requestBody` and documents both under
   * "Query Strings". Sent as a body they are dropped, so "clear every scope"
   * silently never applies.
   */
  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.scope) queryParams.set('scope', params.scope)
      if (params.allScopes !== undefined && params.allScopes !== null)
        queryParams.set('all_scopes', String(params.allScopes))

      const queryString = queryParams.toString()
      return datadogApiUrl(
        params.site,
        `/api/v1/monitor/${datadogPathSegment(params.monitorId)}/unmute${queryString ? `?${queryString}` : ''}`
      )
    },
    method: 'POST',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { success: false },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json().catch(() => ({}))

    return {
      success: true,
      output: {
        success: true,
        monitorId: data.id,
        name: data.name,
        overallState: data.overall_state,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the monitor was successfully unmuted',
    },
    monitorId: {
      type: 'number',
      description: 'ID of the unmuted monitor',
      optional: true,
    },
    name: {
      type: 'string',
      description: 'Name of the unmuted monitor',
      optional: true,
    },
    overallState: {
      type: 'string',
      description: 'Monitor state after unmuting',
      optional: true,
    },
  },
}
