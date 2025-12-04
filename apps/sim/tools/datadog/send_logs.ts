import type { SendLogsParams, SendLogsResponse } from '@/tools/datadog/types'
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
        'JSON array of log entries. Each entry should have message and optionally ddsource, ddtags, hostname, service.',
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
      let logs: any[]
      try {
        logs = typeof params.logs === 'string' ? JSON.parse(params.logs) : params.logs
      } catch {
        throw new Error('Invalid JSON in logs parameter')
      }

      // Ensure each log entry has the required format
      return logs.map((log: any) => ({
        ddsource: log.ddsource || 'custom',
        ddtags: log.ddtags || '',
        hostname: log.hostname || '',
        message: log.message,
        service: log.service || '',
      }))
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
      description: 'Whether the logs were sent successfully',
    },
  },
}
