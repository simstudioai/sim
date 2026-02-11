import type { CancelDowntimeParams, CancelDowntimeResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const cancelDowntimeTool: ToolConfig<CancelDowntimeParams, CancelDowntimeResponse> = {
  id: 'datadog_cancel_downtime',
  name: 'Datadog Cancel Downtime',
  description: 'Cancel a scheduled downtime.',
  version: '1.0.0',

  params: {
    downtimeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the downtime to cancel (e.g., "abc123def456")',
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
      return `https://api.${site}/api/v2/downtime/${params.downtimeId}`
    },
    method: 'DELETE',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
      'DD-APPLICATION-KEY': params.applicationKey,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok && response.status !== 204) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          success: false,
        },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
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
      description: 'Whether the downtime was successfully canceled',
    },
  },
}
