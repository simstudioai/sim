import type { ToolConfig } from '@/tools/types'
import {
  buildMonitorBody,
  MONITOR_OUTPUT_PROPERTIES,
  mapMonitor,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotMonitorResponse,
  type UptimeRobotUpdateMonitorParams,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotUpdateMonitorTool: ToolConfig<
  UptimeRobotUpdateMonitorParams,
  UptimeRobotMonitorResponse
> = {
  id: 'uptimerobot_update_monitor',
  name: 'UptimeRobot Update Monitor',
  description: 'Update an existing UptimeRobot monitor. Only the provided fields are changed.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    monitorId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the monitor to update',
    },
    friendlyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New friendly name',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New URL or host to monitor',
    },
    interval: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New check interval in seconds (minimum 30)',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New check timeout in seconds, 0-60',
    },
    port: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New port, 1-65535 (Port and UDP monitors)',
    },
    keywordType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keyword match type: ALERT_EXISTS or ALERT_NOT_EXISTS',
    },
    keywordValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New keyword to look for',
    },
    httpMethodType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTTP method: HEAD, GET, POST, PUT, PATCH, DELETE, or OPTIONS',
    },
    authType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTTP authentication: NONE, HTTP_BASIC, DIGEST, or BEARER',
    },
    httpUsername: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Username for HTTP authentication',
    },
    httpPassword: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password for HTTP authentication',
    },
    successHttpResponseCodes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated success HTTP response codes (e.g. "2xx,3xx")',
    },
    checkSSLErrors: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to check for SSL and domain expiration errors',
    },
    followRedirections: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to follow redirects',
    },
    sslExpirationReminder: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send SSL certificate expiration reminders',
    },
    domainExpirationReminder: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send domain expiration reminders',
    },
    responseTimeThreshold: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Response time threshold in milliseconds, 0-60000',
    },
    tagNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag names to assign to the monitor',
    },
    assignedAlertContacts: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of alert-contact assignments, e.g. [{"alertContactId":123,"threshold":0,"recurrence":0}]',
    },
    customHttpHeaders: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of custom HTTP headers to send with the request',
    },
    groupId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Monitor group ID to assign the monitor to (0 for no group)',
    },
  },

  request: {
    url: (params) => `${UPTIMEROBOT_API_BASE}/monitors/${params.monitorId}`,
    method: 'PATCH',
    headers: (params) => ({
      ...uptimeRobotHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    body: (params) => buildMonitorBody(params),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { monitor: mapMonitor(data) },
    }
  },

  outputs: {
    monitor: {
      type: 'object',
      description: 'The updated monitor',
      properties: MONITOR_OUTPUT_PROPERTIES,
    },
  },
}
