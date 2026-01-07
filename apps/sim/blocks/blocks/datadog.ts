import { DatadogIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { DatadogResponse } from '@/tools/datadog/types'

export const DatadogBlock: BlockConfig<DatadogResponse> = {
  type: 'datadog',
  name: 'Datadog',
  description: 'Monitor infrastructure, applications, and logs with Datadog',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Datadog monitoring into workflows. Submit metrics, manage monitors, query logs, create events, handle downtimes, and more.',
  docsLink: 'https://docs.sim.ai/tools/datadog',
  category: 'tools',
  bgColor: '#632CA6',
  icon: DatadogIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Submit Metrics', id: 'datadog_submit_metrics' },
        { label: 'Query Timeseries', id: 'datadog_query_timeseries' },
        { label: 'Create Event', id: 'datadog_create_event' },
        { label: 'Create Monitor', id: 'datadog_create_monitor' },
        { label: 'Get Monitor', id: 'datadog_get_monitor' },
        { label: 'List Monitors', id: 'datadog_list_monitors' },
        { label: 'Mute Monitor', id: 'datadog_mute_monitor' },
        { label: 'Query Logs', id: 'datadog_query_logs' },
        { label: 'Send Logs', id: 'datadog_send_logs' },
        { label: 'Create Downtime', id: 'datadog_create_downtime' },
        { label: 'List Downtimes', id: 'datadog_list_downtimes' },
        { label: 'Cancel Downtime', id: 'datadog_cancel_downtime' },
      ],
      value: () => 'datadog_submit_metrics',
    },

    // ========================
    // Submit Metrics inputs
    // ========================
    {
      id: 'series',
      title: 'Metrics Data (JSON)',
      type: 'code',
      placeholder: `[
  {
    "metric": "custom.app.response_time",
    "type": "gauge",
    "points": [{"timestamp": ${Math.floor(Date.now() / 1000)}, "value": 0.85}],
    "tags": ["env:production", "service:api"]
  }
]`,
      condition: { field: 'operation', value: 'datadog_submit_metrics' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Datadog metrics based on the user's description.
Each metric object should have:
- "metric": The metric name (e.g., "custom.app.response_time")
- "type": The metric type ("gauge", "count", or "rate")
- "points": Array of {timestamp, value} objects
- "tags": Array of tag strings (e.g., "env:production")

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the metrics you want to submit...',
        generationType: 'json-object',
      },
    },

    // ========================
    // Query Timeseries inputs
    // ========================
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'avg:system.cpu.user{*}',
      condition: { field: 'operation', value: 'datadog_query_timeseries' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog metrics query based on the user's description.
The query format is: <aggregation>:<metric_name>{<tag_filters>}
Examples:
- "avg:system.cpu.user{*}" - Average CPU usage across all hosts
- "sum:app.requests{env:production} by {service}" - Sum of requests grouped by service
- "max:system.mem.used{host:webserver-1}" - Max memory on specific host

Return ONLY the query string - no explanations, no quotes around the entire query.`,
        placeholder: 'Describe what metrics you want to query...',
      },
    },
    {
      id: 'from',
      title: 'From (Unix Timestamp)',
      type: 'short-input',
      placeholder: 'e.g., 1701360000',
      condition: { field: 'operation', value: 'datadog_query_timeseries' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp (seconds since epoch) based on the user's description.
The timestamp should be a number representing seconds since January 1, 1970 UTC.
Examples:
- "yesterday" -> Calculate yesterday's date at 00:00:00 UTC as Unix timestamp
- "last week" -> Calculate 7 days ago at 00:00:00 UTC as Unix timestamp
- "1 hour ago" -> Calculate current time minus 3600 seconds

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "1 hour ago", "yesterday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'to',
      title: 'To (Unix Timestamp)',
      type: 'short-input',
      placeholder: 'e.g., 1701446400',
      condition: { field: 'operation', value: 'datadog_query_timeseries' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp (seconds since epoch) based on the user's description.
The timestamp should be a number representing seconds since January 1, 1970 UTC.
Examples:
- "now" -> Calculate current time as Unix timestamp
- "end of today" -> Calculate today at 23:59:59 UTC as Unix timestamp
- "tomorrow" -> Calculate tomorrow's date at 00:00:00 UTC as Unix timestamp

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "now", "end of today")...',
        generationType: 'timestamp',
      },
    },

    // ========================
    // Create Event inputs
    // ========================
    {
      id: 'title',
      title: 'Event Title',
      type: 'short-input',
      placeholder: 'Deployment completed',
      condition: { field: 'operation', value: 'datadog_create_event' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a concise, descriptive event title for Datadog based on the user's description.
The title should be short (under 100 characters), clear, and action-oriented.
Examples: "Deployment completed", "High CPU usage detected", "Service restart initiated"

Return ONLY the title text - no quotes, no extra formatting.`,
        placeholder: 'Describe the event you want to create...',
      },
    },
    {
      id: 'text',
      title: 'Event Text',
      type: 'long-input',
      placeholder: 'Describe the event...',
      condition: { field: 'operation', value: 'datadog_create_event' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate descriptive event text for a Datadog event based on the user's description.
Include relevant details like what happened, when, and any important context.
Can use Markdown formatting for readability.

Return the event description text directly - no extra formatting needed.`,
        placeholder: 'Describe the event details...',
      },
    },
    {
      id: 'alertType',
      title: 'Alert Type',
      type: 'dropdown',
      options: [
        { label: 'Info', id: 'info' },
        { label: 'Success', id: 'success' },
        { label: 'Warning', id: 'warning' },
        { label: 'Error', id: 'error' },
      ],
      value: () => 'info',
      condition: { field: 'operation', value: 'datadog_create_event' },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'dropdown',
      options: [
        { label: 'Normal', id: 'normal' },
        { label: 'Low', id: 'low' },
      ],
      value: () => 'normal',
      condition: { field: 'operation', value: 'datadog_create_event' },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'env:production, service:api',
      condition: { field: 'operation', value: 'datadog_create_event' },
    },

    // ========================
    // Create Monitor inputs
    // ========================
    {
      id: 'name',
      title: 'Monitor Name',
      type: 'short-input',
      placeholder: 'High CPU Usage Alert',
      condition: { field: 'operation', value: 'datadog_create_monitor' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, descriptive monitor name for Datadog based on the user's description.
The name should be concise but descriptive, indicating what is being monitored.
Examples: "High CPU Usage Alert", "Database Connection Pool Low", "API Error Rate Spike"

Return ONLY the monitor name - no quotes, no extra formatting.`,
        placeholder: 'Describe what the monitor should track...',
      },
    },
    {
      id: 'type',
      title: 'Monitor Type',
      type: 'dropdown',
      options: [
        { label: 'Metric Alert', id: 'metric alert' },
        { label: 'Service Check', id: 'service check' },
        { label: 'Event Alert', id: 'event alert' },
        { label: 'Log Alert', id: 'log alert' },
        { label: 'Query Alert', id: 'query alert' },
        { label: 'Composite', id: 'composite' },
        { label: 'SLO Alert', id: 'slo alert' },
      ],
      value: () => 'metric alert',
      condition: { field: 'operation', value: 'datadog_create_monitor' },
      required: true,
    },
    {
      id: 'monitorQuery',
      title: 'Monitor Query',
      type: 'long-input',
      placeholder: 'avg(last_5m):avg:system.cpu.idle{*} < 20',
      condition: { field: 'operation', value: 'datadog_create_monitor' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog monitor query based on the user's description.
Monitor query format: <aggregation>(<time_window>):<metric_query> <comparator> <threshold>
Examples:
- "avg(last_5m):avg:system.cpu.idle{*} < 20" - Alert when average CPU idle is below 20%
- "sum(last_1h):sum:app.errors{env:production} > 100" - Alert when errors exceed 100 in an hour
- "max(last_15m):max:system.disk.used{*} by {host} > 90" - Alert when disk usage exceeds 90%

Return ONLY the monitor query string - no explanations.`,
        placeholder: 'Describe what condition should trigger the alert...',
      },
    },
    {
      id: 'message',
      title: 'Notification Message',
      type: 'long-input',
      placeholder: 'Alert! CPU usage is high. @slack-alerts',
      condition: { field: 'operation', value: 'datadog_create_monitor' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog monitor notification message based on the user's description.
The message should include:
- A clear description of what triggered the alert
- Relevant template variables like {{host.name}}, {{value}}
- Optional: notification handles like @slack-channel or @pagerduty

Return the notification message text directly.`,
        placeholder: 'Describe what the notification should say...',
      },
    },
    {
      id: 'monitorTags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'team:backend, priority:high',
      condition: { field: 'operation', value: 'datadog_create_monitor' },
    },
    {
      id: 'monitorPriority',
      title: 'Priority (1-5)',
      type: 'short-input',
      placeholder: '3',
      condition: { field: 'operation', value: 'datadog_create_monitor' },
    },
    {
      id: 'options',
      title: 'Options (JSON)',
      type: 'code',
      placeholder: '{"notify_no_data": true, "thresholds": {"critical": 90}}',
      condition: { field: 'operation', value: 'datadog_create_monitor' },
      wandConfig: {
        enabled: true,
        prompt: `Generate Datadog monitor options JSON based on the user's description.
Common options include:
- "notify_no_data": boolean - Notify when data stops arriving
- "thresholds": {"critical": number, "warning": number} - Alert thresholds
- "renotify_interval": number - Minutes between re-notifications
- "timeout_h": number - Hours before auto-resolving
- "include_tags": boolean - Include trigger tags in notifications

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the monitor options you need...',
        generationType: 'json-object',
      },
    },

    // ========================
    // Get Monitor inputs
    // ========================
    {
      id: 'monitorId',
      title: 'Monitor ID',
      type: 'short-input',
      placeholder: '12345678',
      condition: { field: 'operation', value: 'datadog_get_monitor' },
      required: true,
    },

    // ========================
    // List Monitors inputs
    // ========================
    {
      id: 'listMonitorName',
      title: 'Filter by Name',
      type: 'short-input',
      placeholder: 'CPU',
      condition: { field: 'operation', value: 'datadog_list_monitors' },
    },
    {
      id: 'listMonitorTags',
      title: 'Filter by Tags',
      type: 'short-input',
      placeholder: 'env:production',
      condition: { field: 'operation', value: 'datadog_list_monitors' },
    },

    // ========================
    // Mute Monitor inputs
    // ========================
    {
      id: 'muteMonitorId',
      title: 'Monitor ID',
      type: 'short-input',
      placeholder: '12345678',
      condition: { field: 'operation', value: 'datadog_mute_monitor' },
      required: true,
    },
    {
      id: 'scope',
      title: 'Scope',
      type: 'short-input',
      placeholder: 'host:myhost (optional)',
      condition: { field: 'operation', value: 'datadog_mute_monitor' },
    },
    {
      id: 'end',
      title: 'End Time (Unix Timestamp)',
      type: 'short-input',
      placeholder: 'Leave empty for indefinite',
      condition: { field: 'operation', value: 'datadog_mute_monitor' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp (seconds since epoch) based on the user's description.
The timestamp should be a number representing seconds since January 1, 1970 UTC.
Examples:
- "in 1 hour" -> Calculate current time plus 3600 seconds
- "tomorrow morning" -> Calculate tomorrow at 09:00:00 UTC as Unix timestamp
- "end of day" -> Calculate today at 23:59:59 UTC as Unix timestamp

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when mute should end (e.g., "in 1 hour", "tomorrow")...',
        generationType: 'timestamp',
      },
    },

    // ========================
    // Query Logs inputs
    // ========================
    {
      id: 'logQuery',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'service:web-app status:error',
      condition: { field: 'operation', value: 'datadog_query_logs' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog log search query based on the user's description.
The query uses facet syntax: facet:value
Examples:
- "service:web-app status:error" - Errors from web-app service
- "source:nginx @http.status_code:>=500" - Nginx 5xx errors
- "host:prod-* @duration:>1000" - Slow requests on prod hosts

Return ONLY the search query string - no explanations.`,
        placeholder: 'Describe what logs you want to find...',
      },
    },
    {
      id: 'logFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'now-1h',
      condition: { field: 'operation', value: 'datadog_query_logs' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog relative time string based on the user's description.
The format uses relative time syntax like: now-1h, now-15m, now-1d, now-1w
Examples:
- "1 hour ago" -> now-1h
- "15 minutes ago" -> now-15m
- "yesterday" -> now-1d
- "last week" -> now-7d

Return ONLY the relative time string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "1 hour ago", "yesterday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'logTo',
      title: 'To',
      type: 'short-input',
      placeholder: 'now',
      condition: { field: 'operation', value: 'datadog_query_logs' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog relative time string based on the user's description.
The format uses relative time syntax like: now, now-1h, now-15m
Examples:
- "now" or "current time" -> now
- "5 minutes ago" -> now-5m
- "1 hour ago" -> now-1h

Return ONLY the relative time string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "now", "5 minutes ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'logLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: 'datadog_query_logs' },
    },

    // ========================
    // Send Logs inputs
    // ========================
    {
      id: 'logs',
      title: 'Logs (JSON)',
      type: 'code',
      placeholder: `[
  {
    "message": "Application started successfully",
    "service": "my-app",
    "ddsource": "custom",
    "ddtags": "env:production"
  }
]`,
      condition: { field: 'operation', value: 'datadog_send_logs' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Datadog log entries based on the user's description.
Each log object should have:
- "message": The log message text
- "service": The service name
- "ddsource": The log source (e.g., "custom", "nodejs", "python")
- "ddtags": Comma-separated tags (e.g., "env:production,version:1.0")
- Optional: "hostname", "status" (info/warn/error)

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the logs you want to send...',
        generationType: 'json-object',
      },
    },

    // ========================
    // Create Downtime inputs
    // ========================
    {
      id: 'downtimeScope',
      title: 'Scope',
      type: 'short-input',
      placeholder: 'host:myhost or env:production or *',
      condition: { field: 'operation', value: 'datadog_create_downtime' },
      required: true,
    },
    {
      id: 'downtimeMessage',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Scheduled maintenance',
      condition: { field: 'operation', value: 'datadog_create_downtime' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a downtime message for Datadog based on the user's description.
The message should explain why monitoring is being muted.
Examples: "Scheduled maintenance window", "Deploying new version", "Infrastructure upgrade in progress"

Return the message text directly - no extra formatting.`,
        placeholder: 'Describe the reason for the downtime...',
      },
    },
    {
      id: 'downtimeStart',
      title: 'Start Time (Unix Timestamp)',
      type: 'short-input',
      placeholder: 'Leave empty for now',
      condition: { field: 'operation', value: 'datadog_create_downtime' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp (seconds since epoch) based on the user's description.
The timestamp should be a number representing seconds since January 1, 1970 UTC.
Examples:
- "now" -> Calculate current time as Unix timestamp
- "in 30 minutes" -> Calculate current time plus 1800 seconds
- "tonight at 10pm" -> Calculate today at 22:00:00 UTC as Unix timestamp

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when downtime should start (e.g., "now", "in 30 minutes")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'downtimeEnd',
      title: 'End Time (Unix Timestamp)',
      type: 'short-input',
      placeholder: 'e.g., 1701450000',
      condition: { field: 'operation', value: 'datadog_create_downtime' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp (seconds since epoch) based on the user's description.
The timestamp should be a number representing seconds since January 1, 1970 UTC.
Examples:
- "in 2 hours" -> Calculate current time plus 7200 seconds
- "tomorrow morning" -> Calculate tomorrow at 09:00:00 UTC as Unix timestamp
- "end of maintenance window" -> Interpret based on context

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when downtime should end (e.g., "in 2 hours", "tomorrow")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'downtimeMonitorId',
      title: 'Monitor ID (optional)',
      type: 'short-input',
      placeholder: '12345678',
      condition: { field: 'operation', value: 'datadog_create_downtime' },
    },

    // ========================
    // List Downtimes inputs
    // ========================
    {
      id: 'currentOnly',
      title: 'Current Only',
      type: 'switch',
      condition: { field: 'operation', value: 'datadog_list_downtimes' },
    },

    // ========================
    // Cancel Downtime inputs
    // ========================
    {
      id: 'downtimeId',
      title: 'Downtime ID',
      type: 'short-input',
      placeholder: 'abc123',
      condition: { field: 'operation', value: 'datadog_cancel_downtime' },
      required: true,
    },

    // ========================
    // Authentication (common)
    // ========================
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Datadog API key',
      password: true,
      required: true,
    },
    // Application Key - REQUIRED only for read/manage operations (not needed for submit_metrics, create_event, send_logs)
    {
      id: 'applicationKey',
      title: 'Application Key',
      type: 'short-input',
      placeholder: 'Enter your Datadog application key',
      password: true,
      condition: {
        field: 'operation',
        value: [
          'datadog_query_timeseries',
          'datadog_create_monitor',
          'datadog_get_monitor',
          'datadog_list_monitors',
          'datadog_mute_monitor',
          'datadog_query_logs',
          'datadog_create_downtime',
          'datadog_list_downtimes',
          'datadog_cancel_downtime',
        ],
      },
      required: true,
    },
    {
      id: 'site',
      title: 'Datadog Site',
      type: 'dropdown',
      options: [
        { label: 'US1 (datadoghq.com)', id: 'datadoghq.com' },
        { label: 'US3 (us3.datadoghq.com)', id: 'us3.datadoghq.com' },
        { label: 'US5 (us5.datadoghq.com)', id: 'us5.datadoghq.com' },
        { label: 'EU (datadoghq.eu)', id: 'datadoghq.eu' },
        { label: 'AP1 (ap1.datadoghq.com)', id: 'ap1.datadoghq.com' },
        { label: 'US1-FED (ddog-gov.com)', id: 'ddog-gov.com' },
      ],
      value: () => 'datadoghq.com',
    },
  ],
  tools: {
    access: [
      'datadog_submit_metrics',
      'datadog_query_timeseries',
      'datadog_create_event',
      'datadog_create_monitor',
      'datadog_get_monitor',
      'datadog_list_monitors',
      'datadog_mute_monitor',
      'datadog_query_logs',
      'datadog_send_logs',
      'datadog_create_downtime',
      'datadog_list_downtimes',
      'datadog_cancel_downtime',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        // Base params that are always needed
        const baseParams: Record<string, any> = {
          apiKey: params.apiKey,
          applicationKey: params.applicationKey,
          site: params.site,
        }

        // Only include params relevant to each operation
        switch (params.operation) {
          case 'datadog_submit_metrics':
            return { ...baseParams, series: params.series }

          case 'datadog_query_timeseries':
            return {
              ...baseParams,
              query: params.query,
              from: params.from ? Number(params.from) : undefined,
              to: params.to ? Number(params.to) : undefined,
            }

          case 'datadog_create_event':
            return {
              ...baseParams,
              title: params.title,
              text: params.text,
              alertType: params.alertType,
              priority: params.priority,
              tags: params.tags,
            }

          case 'datadog_create_monitor':
            return {
              ...baseParams,
              name: params.name,
              type: params.type,
              query: params.monitorQuery,
              message: params.message,
              tags: params.monitorTags,
              priority: params.monitorPriority ? Number(params.monitorPriority) : undefined,
              options: params.options,
            }

          case 'datadog_get_monitor':
            return { ...baseParams, monitorId: params.monitorId }

          case 'datadog_list_monitors':
            return {
              ...baseParams,
              name: params.listMonitorName || undefined,
              tags: params.listMonitorTags || undefined,
            }

          case 'datadog_mute_monitor':
            return {
              ...baseParams,
              monitorId: params.muteMonitorId,
              scope: params.scope,
              end: params.end ? Number(params.end) : undefined,
            }

          case 'datadog_query_logs':
            return {
              ...baseParams,
              query: params.logQuery,
              from: params.logFrom,
              to: params.logTo,
              limit: params.logLimit ? Number(params.logLimit) : undefined,
            }

          case 'datadog_send_logs':
            return { ...baseParams, logs: params.logs }

          case 'datadog_create_downtime':
            return {
              ...baseParams,
              scope: params.downtimeScope,
              message: params.downtimeMessage,
              start: params.downtimeStart ? Number(params.downtimeStart) : undefined,
              end: params.downtimeEnd ? Number(params.downtimeEnd) : undefined,
              monitorId: params.downtimeMonitorId,
            }

          case 'datadog_list_downtimes':
            return { ...baseParams, currentOnly: params.currentOnly }

          case 'datadog_cancel_downtime':
            return { ...baseParams, downtimeId: params.downtimeId }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Datadog API key' },
    applicationKey: { type: 'string', description: 'Datadog Application key' },
    site: { type: 'string', description: 'Datadog site/region' },
    // Metrics
    series: { type: 'json', description: 'Metrics data to submit' },
    query: { type: 'string', description: 'Query string' },
    from: { type: 'number', description: 'Start time (Unix timestamp)' },
    to: { type: 'number', description: 'End time (Unix timestamp)' },
    // Events
    title: { type: 'string', description: 'Event title' },
    text: { type: 'string', description: 'Event text/body' },
    alertType: { type: 'string', description: 'Alert type' },
    priority: { type: 'string', description: 'Priority level' },
    tags: { type: 'string', description: 'Comma-separated tags' },
    // Monitors
    name: { type: 'string', description: 'Monitor name' },
    type: { type: 'string', description: 'Monitor type' },
    monitorQuery: { type: 'string', description: 'Monitor query' },
    message: { type: 'string', description: 'Notification message' },
    monitorTags: { type: 'string', description: 'Monitor tags' },
    monitorPriority: { type: 'number', description: 'Monitor priority (1-5)' },
    options: { type: 'json', description: 'Monitor options' },
    monitorId: { type: 'string', description: 'Monitor ID' },
    muteMonitorId: { type: 'string', description: 'Monitor ID to mute' },
    scope: { type: 'string', description: 'Scope for muting' },
    end: { type: 'number', description: 'End time for mute' },
    // Logs
    logQuery: { type: 'string', description: 'Log search query' },
    logFrom: { type: 'string', description: 'Log start time' },
    logTo: { type: 'string', description: 'Log end time' },
    logLimit: { type: 'number', description: 'Max logs to return' },
    logs: { type: 'json', description: 'Logs to send' },
    // Downtimes
    downtimeScope: { type: 'string', description: 'Downtime scope' },
    downtimeMessage: { type: 'string', description: 'Downtime message' },
    downtimeStart: { type: 'number', description: 'Downtime start time' },
    downtimeEnd: { type: 'number', description: 'Downtime end time' },
    downtimeMonitorId: { type: 'string', description: 'Monitor ID for downtime' },
    currentOnly: { type: 'boolean', description: 'Filter to current downtimes' },
    downtimeId: { type: 'string', description: 'Downtime ID to cancel' },
    listMonitorName: { type: 'string', description: 'Filter monitors by name' },
    listMonitorTags: { type: 'string', description: 'Filter monitors by tags' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    // Metrics
    series: { type: 'json', description: 'Timeseries data' },
    status: { type: 'string', description: 'Query status' },
    // Events
    event: { type: 'json', description: 'Event data' },
    events: { type: 'json', description: 'List of events' },
    // Monitors
    monitor: { type: 'json', description: 'Monitor data' },
    monitors: { type: 'json', description: 'List of monitors' },
    // Logs
    logs: { type: 'json', description: 'Log entries' },
    nextLogId: { type: 'string', description: 'Pagination cursor for logs' },
    // Downtimes
    downtime: { type: 'json', description: 'Downtime data' },
    downtimes: { type: 'json', description: 'List of downtimes' },
  },
}
