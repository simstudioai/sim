import { filterUndefined } from '@sim/utils/object'
import type { LogEntry, SendLogsParams, SendLogsResponse } from '@/tools/datadog/types'
import { datadogErrorMessage, parseJsonParam } from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const sendLogsTool: ToolConfig<SendLogsParams, SendLogsResponse> = {
  id: 'datadog_send_logs',
  name: 'Datadog Send Logs',
  description: 'Send log entries to Datadog for centralized logging and analysis.',
  version: '1.0.0',

  params: {
    logs: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of log entries. Each entry should have message and optionally ddsource, ddtags, hostname, service. Sim fills in ddsource="custom" when an entry omits it — that is a Sim default, not a Datadog one; set ddsource yourself to have Datadog apply the matching integration log pipeline.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
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
      // Logs API uses a different subdomain
      const logsHost =
        site === 'datadoghq.com'
          ? 'http-intake.logs.datadoghq.com'
          : site === 'datadoghq.eu'
            ? 'http-intake.logs.datadoghq.eu'
            : `http-intake.logs.${site}`
      return `https://${logsHost}/api/v2/logs`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
    }),
    body: (params) => {
      const logs = parseJsonParam<LogEntry[]>(params.logs, 'logs parameter')
      if (!Array.isArray(logs) || logs.length === 0) {
        throw new Error('logs must be a non-empty JSON array of log entries')
      }

      /**
       * Every extra key is preserved: Datadog's log intake accepts arbitrary
       * additional properties as the log's structured attributes, so rebuilding each
       * entry from a fixed field list would silently discard them. Empty optional
       * fields are dropped rather than sent blank, which would otherwise suppress
       * Datadog's own host inference and write an empty reserved `service` attribute.
       */
      return logs.map((log) => filterUndefined({ ...log, ddsource: log.ddsource || 'custom' }))
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const message = await datadogErrorMessage(response)
      return {
        success: false,
        output: {
          success: false,
        },
        error: message,
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
      description: 'Whether the logs were sent successfully',
    },
  },
}
