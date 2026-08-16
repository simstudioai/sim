import type {
  CreateDowntimeParams,
  CreateDowntimeResponse,
  DowntimeAttributes,
} from '@/tools/datadog/types'
import { datadogErrorMessage, parseMonitorIds, splitCommaList } from '@/tools/datadog/utils'
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
      // A one-time schedule accepts only `start` and `end` (`additionalProperties: false`);
      // the timezone is a display-only attribute on the downtime itself.
      const schedule: { start?: string; end?: string } = {}
      if (params.start) schedule.start = new Date(params.start * 1000).toISOString()
      if (params.end) schedule.end = new Date(params.end * 1000).toISOString()

      const monitorTags = splitCommaList(params.monitorTags)
      const monitorId = parseMonitorIds(params.monitorId)?.[0]

      /**
       * `monitor_identifier` is required and is a `oneOf`: a downtime targets either a
       * single monitor or a tag set, never both. Accepting both silently would drop one
       * of them and mute a different set of monitors than the caller asked for. Both
       * sides are compared after parsing so a blank or whitespace-only input, which is
       * how an untouched field arrives, does not read as a chosen target.
       */
      if (monitorId !== undefined && monitorTags) {
        throw new Error(
          'Supply either a monitor ID or monitor tags, not both — a downtime targets one or the other'
        )
      }

      // Datadog expresses "every monitor in scope" as the `*` monitor tag, which is the
      // fallback when no monitor is named.
      const monitorIdentifier =
        monitorId !== undefined ? { monitor_id: monitorId } : { monitor_tags: monitorTags ?? ['*'] }

      const attributes: Record<string, unknown> = {
        scope: params.scope,
        monitor_identifier: monitorIdentifier,
      }
      if (Object.keys(schedule).length > 0) attributes.schedule = schedule
      if (params.timezone) attributes.display_timezone = params.timezone
      if (params.message) attributes.message = params.message
      if (params.muteFirstRecoveryNotification !== undefined) {
        attributes.mute_first_recovery_notification = params.muteFirstRecoveryNotification
      }

      return { data: { type: 'downtime', attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const message = await datadogErrorMessage(response)
      return {
        success: false,
        output: {
          downtime: { scope: [] },
        },
        error: message,
      }
    }

    const data = await response.json()
    const attrs: DowntimeAttributes = data.data?.attributes || {}
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
          timezone: attrs.display_timezone ?? undefined,
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
        id: { type: 'string', description: 'Downtime UUID' },
        scope: { type: 'array', description: 'Downtime scope' },
        message: { type: 'string', description: 'Downtime message' },
        start: { type: 'number', description: 'Start time (Unix timestamp)' },
        end: { type: 'number', description: 'End time (Unix timestamp)' },
        timezone: { type: 'string', description: 'Display timezone for the downtime' },
        active: { type: 'boolean', description: 'Whether downtime is currently active' },
        created: { type: 'number', description: 'Creation time (Unix timestamp)' },
        modified: { type: 'number', description: 'Last modification time (Unix timestamp)' },
      },
    },
  },
}
