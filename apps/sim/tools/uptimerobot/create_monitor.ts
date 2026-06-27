import type { ToolConfig } from '@/tools/types'
import {
  buildMonitorBody,
  MONITOR_OUTPUT_PROPERTIES,
  mapMonitor,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotCreateMonitorParams,
  type UptimeRobotMonitorResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotCreateMonitorTool: ToolConfig<
  UptimeRobotCreateMonitorParams,
  UptimeRobotMonitorResponse
> = {
  id: 'uptimerobot_create_monitor',
  name: 'UptimeRobot Create Monitor',
  description: 'Create a new monitor in UptimeRobot',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    friendlyName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Friendly name of the monitor',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Monitor type: HTTP, KEYWORD, PING, PORT, HEARTBEAT, DNS, API, or UDP',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL or host to monitor (not required for Heartbeat monitors)',
    },
    interval: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Check interval in seconds (minimum 30)',
    },
    checkTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Check timeout in seconds, 0-60 (HTTP, Keyword and Port monitors only)',
    },
    port: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Port to check, 1-65535 (required for Port and UDP monitors)',
    },
    keywordType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keyword match type for Keyword monitors: ALERT_EXISTS or ALERT_NOT_EXISTS',
    },
    keywordValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keyword to look for (Keyword monitors only)',
    },
    keywordCaseType: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keyword case sensitivity: 0 (case-sensitive) or 1 (case-insensitive)',
    },
    httpMethodType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'HTTP method: HEAD, GET, POST, PUT, PATCH, DELETE, or OPTIONS (defaults to HEAD)',
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
    gracePeriod: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Grace period in seconds, 0-86400 (Heartbeat monitors only)',
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
    url: () => `${UPTIMEROBOT_API_BASE}/monitors`,
    method: 'POST',
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
      description: 'The created monitor',
      properties: MONITOR_OUTPUT_PROPERTIES,
    },
  },
}
