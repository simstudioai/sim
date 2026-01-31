import type { CreateDowntimeParams, CreateDowntimeResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const createDowntimeTool: ToolConfig<CreateDowntimeParams, CreateDowntimeResponse> = {
  id: 'datadog_create_downtime',
  name: 'Datadog Create Downtime',
  description: 'Schedule a downtime to suppress monitor notifications during maintenance windows.',
  version: '1.0.0',

  params: {
    scope: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Scope to apply downtime to (e.g., "host:myhost", "env:production", or "*" for all)',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message to display during downtime',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unix timestamp for downtime start in seconds (e.g., 1705320000, defaults to now)',
    },
    end: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp for downtime end in seconds (e.g., 1705323600)',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timezone for the downtime (e.g., "America/New_York", "UTC", "Europe/London")',
    },
    monitorId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific monitor ID to mute (e.g., "12345678")',
    },
    monitorTags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated monitor tags to match (e.g., "team:backend,priority:high")',
    },
    muteFirstRecoveryNotification: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Mute the first recovery notification',
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
      return `https://api.${site}/api/v2/downtime`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
      'DD-APPLICATION-KEY': params.applicationKey,
    }),
    body: (params) => {
      const schedule: Record<string, any> = {}
      if (params.start) schedule.start = new Date(params.start * 1000).toISOString()
      if (params.end) schedule.end = new Date(params.end * 1000).toISOString()
      if (params.timezone) schedule.timezone = params.timezone

      const body: Record<string, any> = {
        data: {
          type: 'downtime',
          attributes: {
            scope: params.scope,
            schedule: Object.keys(schedule).length > 0 ? schedule : undefined,
          },
        },
      }

      if (params.message) body.data.attributes.message = params.message
      if (params.muteFirstRecoveryNotification !== undefined) {
        body.data.attributes.mute_first_recovery_notification = params.muteFirstRecoveryNotification
      }

      if (params.monitorId) {
        body.data.attributes.monitor_identifier = {
          monitor_id: Number.parseInt(params.monitorId, 10),
        }
      } else if (params.monitorTags) {
        body.data.attributes.monitor_identifier = {
          monitor_tags: params.monitorTags
            .split(',')
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 0),
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          downtime: {} as any,
        },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const attrs = data.data?.attributes || {}
    return {
      success: true,
      output: {
        downtime: {
          id: data.data?.id,
          scope: attrs.scope ? [attrs.scope] : [],
          message: attrs.message,
          start: attrs.schedule?.start
            ? new Date(attrs.schedule.start).getTime() / 1000
            : undefined,
          end: attrs.schedule?.end ? new Date(attrs.schedule.end).getTime() / 1000 : undefined,
          timezone: attrs.schedule?.timezone,
          disabled: attrs.disabled,
          active: attrs.status === 'active',
          created: attrs.created ? new Date(attrs.created).getTime() / 1000 : undefined,
          modified: attrs.modified ? new Date(attrs.modified).getTime() / 1000 : undefined,
        },
      },
    }
  },

  outputs: {
    downtime: {
      type: 'object',
      description: 'The created downtime details',
      properties: {
        id: { type: 'number', description: 'Downtime ID' },
        scope: { type: 'array', description: 'Downtime scope' },
        message: { type: 'string', description: 'Downtime message' },
        start: { type: 'number', description: 'Start time (Unix timestamp)' },
        end: { type: 'number', description: 'End time (Unix timestamp)' },
        active: { type: 'boolean', description: 'Whether downtime is currently active' },
      },
    },
  },
}
