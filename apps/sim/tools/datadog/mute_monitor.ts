import type { MuteMonitorParams, MuteMonitorResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const muteMonitorTool: ToolConfig<MuteMonitorParams, MuteMonitorResponse> = {
  id: 'datadog_mute_monitor',
  name: 'Datadog Mute Monitor',
  description:
    'Mute a monitor to temporarily suppress its notifications. Use Unmute Monitor to reverse it, or schedule a downtime instead when you want a planned, auditable maintenance window.',
  version: '1.0.0',

  params: {
    monitorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the monitor to mute (e.g., "12345678")',
    },
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Scope to mute (e.g., "host:myhost", "env:prod"). If not specified, mutes all scopes.',
    },
    end: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unix timestamp in seconds when the mute should end (e.g., 1705323600). If not specified, the monitor stays muted until it is unmuted.',
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
   * `scope` and `end` are query parameters, not a request body: the MuteMonitor
   * operation declares no `requestBody` and documents both under "Query
   * Strings". Sent as a body they are dropped, turning a scoped, time-boxed
   * mute into an indefinite mute across every scope — with a 200 and the full
   * monitor object back, so the caller never sees it.
   */
  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.scope) queryParams.set('scope', params.scope)
      if (params.end !== undefined && params.end !== null)
        queryParams.set('end', String(params.end))

      const queryString = queryParams.toString()
      return datadogApiUrl(
        params.site,
        `/api/v1/monitor/${datadogPathSegment(params.monitorId)}/mute${queryString ? `?${queryString}` : ''}`
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
      description: 'Whether the monitor was successfully muted',
    },
    monitorId: {
      type: 'number',
      description: 'ID of the muted monitor',
      optional: true,
    },
    name: {
      type: 'string',
      description: 'Name of the muted monitor',
      optional: true,
    },
    overallState: {
      type: 'string',
      description: 'Monitor state after muting',
      optional: true,
    },
  },
}
