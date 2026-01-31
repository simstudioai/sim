import type { MuteMonitorParams, MuteMonitorResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const muteMonitorTool: ToolConfig<MuteMonitorParams, MuteMonitorResponse> = {
  id: 'datadog_mute_monitor',
  name: 'Datadog Mute Monitor',
  description: 'Mute a monitor to temporarily suppress notifications.',
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
        'Unix timestamp in seconds when the mute should end (e.g., 1705323600). If not specified, mutes indefinitely.',
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
    url: (params) => {
      const site = params.site || 'datadoghq.com'
      return `https://api.${site}/api/v1/monitor/${params.monitorId}/mute`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
      'DD-APPLICATION-KEY': params.applicationKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.scope) body.scope = params.scope
      if (params.end) body.end = params.end
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          success: false,
        },
        error: errorData.errors?.[0] || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the monitor was successfully muted',
    },
  },
}
