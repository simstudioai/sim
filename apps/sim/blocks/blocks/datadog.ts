import { DatadogIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { DatadogResponse } from '@/tools/datadog/types'

/**
 * Normalizes a `switch` sub-block value. Switches serialize their state as the
 * strings `'true'`/`'false'`, so `Boolean(value)` would read `'false'` as true.
 * Returns `undefined` when the switch was never set so the tool falls back to
 * Datadog's own default.
 */
function toSwitchBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

/**
 * Coerce a numeric block input, dropping anything that is not a finite number.
 *
 * These are free-text fields, so they can carry a typo or an unresolved
 * reference, and a bare `Number()` would put the literal `NaN` into the request
 * — `JSON.stringify` writes it as `null` and it reaches a query string as the
 * string "NaN", either of which Datadog rejects with a message naming nothing
 * the user typed. An untouched subBlock resolves to `null` and an empty one to
 * `''`; both are omissions rather than zeros, while an explicit `0` is
 * meaningful (page 0, offset 0, a zero threshold) and is kept.
 */
function datadogNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const DatadogBlock: BlockConfig<DatadogResponse> = {
  type: 'datadog',
  name: 'Datadog',
  description: 'Monitor infrastructure, applications, and logs with Datadog',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Datadog monitoring into workflows. Submit metrics, manage monitors, query logs, create events, handle downtimes, and more.',
  docsLink: 'https://docs.sim.ai/integrations/datadog',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#632CA6',
  iconColor: '#632CA6',
  icon: DatadogIcon,
  canvasPresentation: {
    defaultTitle: 'Datadog',
    sentences: {
      byOperation: {
        datadog_submit_metrics: ['Submit custom metric points'],
        datadog_query_timeseries: [
          { text: 'Query metric timeseries', field: 'query', core: true },
          { text: ', since', field: 'from' },
        ],
        datadog_create_event: [
          { text: 'Post', field: 'title', after: 'to the event stream', core: true },
          { text: ', tagged', field: 'tags' },
        ],
        datadog_create_monitor: [
          { text: 'Create monitor', field: 'name', core: true },
          { text: ', alerting on', field: 'monitorQuery' },
        ],
        datadog_get_monitor: [{ text: 'Read monitor', field: 'monitorId', core: true }],
        datadog_list_monitors: [
          'List monitors',
          { text: ', named like', field: 'listMonitorName' },
          { text: ', tagged', field: 'listMonitorTags' },
        ],
        datadog_mute_monitor: [
          { text: 'Mute monitor', field: 'muteMonitorId', core: true },
          { text: ', for scope', field: 'scope' },
          { text: ', until', field: 'end' },
        ],
        datadog_unmute_monitor: [
          { text: 'Unmute monitor', field: 'muteMonitorId', core: true },
          { text: ', for scope', field: 'scope' },
        ],
        datadog_query_logs: [
          { text: 'Search logs matching', field: 'logQuery', core: true },
          { text: ', since', field: 'logFrom' },
        ],
        datadog_send_logs: ['Send log entries for indexing'],
        datadog_create_downtime: [
          { text: 'Schedule downtime for', field: 'downtimeScope', core: true },
          { text: ', until', field: 'downtimeEnd' },
        ],
        datadog_list_downtimes: ['List scheduled downtimes'],
        datadog_cancel_downtime: [{ text: 'Cancel downtime', field: 'downtimeId', core: true }],
        datadog_list_incidents: ['List incidents'],
        datadog_get_incident: [{ text: 'Read incident', field: 'incidentId', core: true }],
        datadog_create_incident: [
          { text: 'Declare incident', field: 'incidentTitle', core: true },
          { text: ', at severity', field: 'incidentSeverity' },
        ],
        datadog_update_incident: [
          { text: 'Update incident', field: 'incidentId', core: true },
          { text: ', to severity', field: 'incidentSeverity' },
        ],
        datadog_add_incident_todo: [
          { text: 'Add follow-up task to incident', field: 'incidentId', core: true },
          { text: ', assigned to', field: 'todoAssignees' },
        ],
        datadog_list_slos: [
          'List SLOs',
          { text: ', named like', field: 'sloQuery' },
          { text: ', tagged', field: 'sloTagsQuery' },
        ],
        datadog_get_slo: [{ text: 'Read SLO', field: 'sloId', core: true }],
        datadog_create_slo: [
          { text: 'Create SLO', field: 'sloName', core: true },
          { text: ', of type', field: 'sloType' },
        ],
        datadog_update_slo: [{ text: 'Update SLO', field: 'sloId', core: true }],
        datadog_delete_slo: [{ text: 'Delete SLO', field: 'sloId', core: true }],
        datadog_get_slo_history: [
          { text: 'Read SLO history for', field: 'sloId', core: true },
          { text: ', since', field: 'sloFromTs' },
        ],
        datadog_list_dashboards: ['List dashboards'],
        datadog_get_dashboard: [{ text: 'Read dashboard', field: 'dashboardId', core: true }],
        datadog_create_dashboard: [
          { text: 'Create dashboard', field: 'dashboardTitle', core: true },
        ],
        datadog_delete_dashboard: [{ text: 'Delete dashboard', field: 'dashboardId', core: true }],
        datadog_list_synthetics_tests: ['List Synthetic tests'],
        datadog_get_synthetics_test: [
          { text: 'Read Synthetic test', field: 'syntheticsPublicId', core: true },
        ],
        datadog_get_synthetics_results: [
          { text: 'Read results for Synthetic test', field: 'syntheticsPublicId', core: true },
        ],
        datadog_get_browser_synthetics_results: [
          {
            text: 'Read results for browser Synthetic test',
            field: 'syntheticsPublicId',
            core: true,
          },
        ],
        datadog_trigger_synthetics_tests: [
          { text: 'Trigger Synthetic tests', field: 'syntheticsPublicIds', core: true },
        ],
        datadog_update_synthetics_status: [
          { text: 'Set Synthetic test', field: 'syntheticsPublicId', core: true },
          { text: 'to', field: 'syntheticsNewStatus' },
        ],
        datadog_list_security_signals: [
          { text: 'Search security signals matching', field: 'signalQuery', core: true },
          { text: ', since', field: 'signalFrom' },
        ],
        datadog_get_security_signal: [
          { text: 'Read security signal', field: 'signalId', core: true },
        ],
        datadog_update_security_signal_state: [
          { text: 'Set security signal', field: 'signalId', core: true },
          { text: 'to state', field: 'signalState' },
        ],
        datadog_update_security_signal_assignee: [
          { text: 'Assign security signal', field: 'signalId', core: true },
          { text: ', to', field: 'signalAssigneeUuid' },
        ],
        datadog_list_security_rules: [
          'List detection rules',
          { text: ', matching', field: 'ruleQuery' },
        ],
        datadog_search_spans: [
          { text: 'Search APM spans matching', field: 'spanQuery', core: true },
          { text: ', since', field: 'spanFrom' },
        ],
        datadog_list_services: ['List services in the catalog'],
      },
    },
  },
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
        { label: 'Unmute Monitor', id: 'datadog_unmute_monitor' },
        { label: 'Query Logs', id: 'datadog_query_logs' },
        { label: 'Send Logs', id: 'datadog_send_logs' },
        { label: 'Create Downtime', id: 'datadog_create_downtime' },
        { label: 'List Downtimes', id: 'datadog_list_downtimes' },
        { label: 'Cancel Downtime', id: 'datadog_cancel_downtime' },
        { label: 'List Incidents', id: 'datadog_list_incidents' },
        { label: 'Get Incident', id: 'datadog_get_incident' },
        { label: 'Create Incident', id: 'datadog_create_incident' },
        { label: 'Update Incident', id: 'datadog_update_incident' },
        { label: 'Add Incident Todo', id: 'datadog_add_incident_todo' },
        { label: 'List SLOs', id: 'datadog_list_slos' },
        { label: 'Get SLO', id: 'datadog_get_slo' },
        { label: 'Create SLO', id: 'datadog_create_slo' },
        { label: 'Update SLO', id: 'datadog_update_slo' },
        { label: 'Delete SLO', id: 'datadog_delete_slo' },
        { label: 'Get SLO History', id: 'datadog_get_slo_history' },
        { label: 'List Dashboards', id: 'datadog_list_dashboards' },
        { label: 'Get Dashboard', id: 'datadog_get_dashboard' },
        { label: 'Create Dashboard', id: 'datadog_create_dashboard' },
        { label: 'Delete Dashboard', id: 'datadog_delete_dashboard' },
        { label: 'List Synthetic Tests', id: 'datadog_list_synthetics_tests' },
        { label: 'Get Synthetic Test', id: 'datadog_get_synthetics_test' },
        { label: 'Get Synthetic Test Results', id: 'datadog_get_synthetics_results' },
        {
          label: 'Get Browser Synthetic Test Results',
          id: 'datadog_get_browser_synthetics_results',
        },
        { label: 'Trigger Synthetic Tests', id: 'datadog_trigger_synthetics_tests' },
        { label: 'Pause Or Start Synthetic Test', id: 'datadog_update_synthetics_status' },
        { label: 'List Security Signals', id: 'datadog_list_security_signals' },
        { label: 'Get Security Signal', id: 'datadog_get_security_signal' },
        { label: 'Update Security Signal State', id: 'datadog_update_security_signal_state' },
        { label: 'Assign Security Signal', id: 'datadog_update_security_signal_assignee' },
        { label: 'List Security Rules', id: 'datadog_list_security_rules' },
        { label: 'Search Spans', id: 'datadog_search_spans' },
        { label: 'List Services', id: 'datadog_list_services' },
      ],
      value: () => 'datadog_submit_metrics',
    },

    // Submit Metrics inputs
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

    // Query Timeseries inputs
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

    // Create Event inputs
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
      mode: 'advanced',
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
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'env:production, service:api',
      condition: { field: 'operation', value: 'datadog_create_event' },
      mode: 'advanced',
    },

    // Create Monitor inputs
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
      mode: 'advanced',
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
      mode: 'advanced',
    },
    {
      id: 'monitorPriority',
      title: 'Priority (1-5)',
      type: 'short-input',
      placeholder: '3',
      condition: { field: 'operation', value: 'datadog_create_monitor' },
      mode: 'advanced',
    },
    {
      id: 'options',
      title: 'Options (JSON)',
      type: 'code',
      placeholder: '{"notify_no_data": true, "thresholds": {"critical": 90}}',
      condition: { field: 'operation', value: 'datadog_create_monitor' },
      mode: 'advanced',
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

    // Get Monitor inputs
    {
      id: 'monitorId',
      title: 'Monitor ID',
      type: 'short-input',
      placeholder: '12345678',
      condition: { field: 'operation', value: 'datadog_get_monitor' },
      required: true,
    },

    // List Monitors inputs
    {
      id: 'listMonitorName',
      title: 'Filter by Name',
      type: 'short-input',
      placeholder: 'CPU',
      condition: { field: 'operation', value: 'datadog_list_monitors' },
      mode: 'advanced',
    },
    {
      id: 'listMonitorTags',
      title: 'Filter by Tags',
      type: 'short-input',
      placeholder: 'env:production',
      condition: { field: 'operation', value: 'datadog_list_monitors' },
      mode: 'advanced',
    },
    {
      id: 'listMonitorPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '50',
      tooltip:
        'Monitors per page (max 1000). Datadog only applies a page size when a page number is sent, so setting this alone uses page 0.',
      condition: { field: 'operation', value: 'datadog_list_monitors' },
      mode: 'advanced',
    },
    {
      id: 'listMonitorPage',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '0',
      tooltip:
        'Page to start from (0-indexed). Leaving both this and Page Size blank returns every monitor in the org without pagination.',
      condition: { field: 'operation', value: 'datadog_list_monitors' },
      mode: 'advanced',
    },

    // Mute / Unmute Monitor inputs
    {
      id: 'muteMonitorId',
      title: 'Monitor ID',
      type: 'short-input',
      placeholder: '12345678',
      condition: {
        field: 'operation',
        value: ['datadog_mute_monitor', 'datadog_unmute_monitor'],
      },
      required: { field: 'operation', value: ['datadog_mute_monitor', 'datadog_unmute_monitor'] },
    },
    {
      id: 'scope',
      title: 'Scope',
      type: 'short-input',
      placeholder: 'host:myhost (leave blank for all scopes)',
      condition: {
        field: 'operation',
        value: ['datadog_mute_monitor', 'datadog_unmute_monitor'],
      },
      mode: 'advanced',
    },
    {
      id: 'end',
      title: 'Mute Until (Unix Timestamp)',
      type: 'short-input',
      placeholder: 'Leave empty to mute until unmuted',
      condition: { field: 'operation', value: 'datadog_mute_monitor' },
      mode: 'advanced',
    },
    {
      id: 'unmuteAllScopes',
      title: 'Clear All Scopes',
      type: 'switch',
      condition: { field: 'operation', value: 'datadog_unmute_monitor' },
      mode: 'advanced',
    },

    // Query Logs inputs
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
      mode: 'advanced',
    },
    {
      id: 'logCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Cursor returned by a previous call',
      condition: { field: 'operation', value: 'datadog_query_logs' },
      mode: 'advanced',
    },

    // Send Logs inputs
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

    // Create Downtime inputs
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
      mode: 'advanced',
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
      mode: 'advanced',
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
      mode: 'advanced',
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
      mode: 'advanced',
    },
    {
      id: 'downtimeMonitorTags',
      title: 'Monitor Tags',
      type: 'short-input',
      placeholder: 'team:backend,priority:high',
      condition: { field: 'operation', value: 'datadog_create_downtime' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Datadog monitor tags based on the user's description.
Each tag uses the "key:value" form.
Examples: "team:backend,priority:high", "env:production", "service:checkout"

Return ONLY the comma-separated tag list - no explanations, no extra text.`,
        placeholder: 'Describe which monitors to target...',
      },
    },
    {
      id: 'downtimeTimezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'UTC or America/New_York',
      condition: { field: 'operation', value: 'datadog_create_downtime' },
      mode: 'advanced',
    },
    {
      id: 'downtimeMuteFirstRecovery',
      title: 'Mute First Recovery Notification',
      type: 'switch',
      condition: { field: 'operation', value: 'datadog_create_downtime' },
      mode: 'advanced',
    },

    // List Downtimes inputs
    {
      id: 'currentOnly',
      title: 'Current Only',
      type: 'switch',
      condition: { field: 'operation', value: 'datadog_list_downtimes' },
      mode: 'advanced',
    },
    {
      id: 'downtimeLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '30',
      condition: { field: 'operation', value: 'datadog_list_downtimes' },
      mode: 'advanced',
    },
    {
      id: 'downtimeOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'datadog_list_downtimes' },
      mode: 'advanced',
    },

    // Cancel Downtime inputs
    {
      id: 'downtimeId',
      title: 'Downtime ID',
      type: 'short-input',
      placeholder: 'abc123',
      condition: { field: 'operation', value: 'datadog_cancel_downtime' },
      required: true,
    },

    // Incidents inputs
    {
      id: 'incidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: '00000000-0000-0000-1234-000000000000',
      condition: {
        field: 'operation',
        value: ['datadog_get_incident', 'datadog_update_incident', 'datadog_add_incident_todo'],
      },
      required: {
        field: 'operation',
        value: ['datadog_get_incident', 'datadog_update_incident', 'datadog_add_incident_todo'],
      },
    },
    {
      id: 'incidentTitle',
      title: 'Incident Title',
      type: 'short-input',
      placeholder: 'Checkout API returning 500s',
      condition: {
        field: 'operation',
        value: ['datadog_create_incident', 'datadog_update_incident'],
      },
      required: { field: 'operation', value: 'datadog_create_incident' },
    },
    {
      id: 'incidentCustomerImpacted',
      title: 'Customer Impacted',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['datadog_create_incident', 'datadog_update_incident'],
      },
    },
    {
      id: 'incidentSeverity',
      title: 'Severity',
      type: 'dropdown',
      options: [
        { label: 'SEV-0', id: 'SEV-0' },
        { label: 'SEV-1', id: 'SEV-1' },
        { label: 'SEV-2', id: 'SEV-2' },
        { label: 'SEV-3', id: 'SEV-3' },
        { label: 'SEV-4', id: 'SEV-4' },
        { label: 'SEV-5', id: 'SEV-5' },
        { label: 'Unknown', id: 'UNKNOWN' },
      ],
      condition: {
        field: 'operation',
        value: ['datadog_create_incident', 'datadog_update_incident'],
      },
    },
    {
      id: 'incidentCustomerImpactScope',
      title: 'Customer Impact Scope',
      type: 'long-input',
      placeholder: 'Checkout unavailable for EU customers',
      condition: {
        field: 'operation',
        value: ['datadog_create_incident', 'datadog_update_incident'],
      },
      mode: 'advanced',
    },
    {
      id: 'incidentTypeUuid',
      title: 'Incident Type UUID',
      type: 'short-input',
      placeholder: 'Leave empty to use the default incident type',
      condition: { field: 'operation', value: 'datadog_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'incidentIsTest',
      title: 'Test Incident',
      type: 'switch',
      condition: { field: 'operation', value: 'datadog_create_incident' },
      mode: 'advanced',
    },
    {
      id: 'incidentCustomerImpactStart',
      title: 'Customer Impact Start',
      type: 'short-input',
      placeholder: '2026-01-02T09:42:36Z',
      condition: { field: 'operation', value: 'datadog_update_incident' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp for when customer impact began. Return ONLY the timestamp string.',
        placeholder: 'Describe when customer impact started...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'incidentCustomerImpactEnd',
      title: 'Customer Impact End',
      type: 'short-input',
      placeholder: '2026-01-02T10:15:00Z',
      condition: { field: 'operation', value: 'datadog_update_incident' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp for when customer impact ended. Return ONLY the timestamp string.',
        placeholder: 'Describe when customer impact ended...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'incidentDetected',
      title: 'Detected At',
      type: 'short-input',
      placeholder: '2026-01-02T09:40:00Z',
      condition: { field: 'operation', value: 'datadog_update_incident' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp for when the incident was detected. Return ONLY the timestamp string.',
        placeholder: 'Describe when the incident was detected...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'incidentFields',
      title: 'Fields (JSON)',
      type: 'code',
      placeholder: '{"state": {"type": "dropdown", "value": "resolved"}}',
      condition: {
        field: 'operation',
        value: ['datadog_create_incident', 'datadog_update_incident'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog incident fields object based on the user's description.
Each key is a field name and each value is an object with "type" and "value".
Examples:
- {"severity": {"type": "dropdown", "value": "SEV-2"}}
- {"state": {"type": "dropdown", "value": "resolved"}}
- {"services": {"type": "multiselect", "value": ["checkout", "payments"]}}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the incident fields to set...',
        generationType: 'json-object',
      },
    },
    {
      id: 'incidentNotificationHandles',
      title: 'Notification Handles',
      type: 'short-input',
      placeholder: '@slack-incidents, @oncall@example.com',
      condition: {
        field: 'operation',
        value: ['datadog_create_incident', 'datadog_update_incident'],
      },
      mode: 'advanced',
    },
    {
      id: 'incidentInclude',
      title: 'Include Related Resources',
      type: 'short-input',
      placeholder: 'users, attachments',
      condition: {
        field: 'operation',
        value: ['datadog_list_incidents', 'datadog_get_incident'],
      },
      mode: 'advanced',
    },
    {
      id: 'incidentPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'datadog_list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'incidentPageOffset',
      title: 'Page Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'datadog_list_incidents' },
      mode: 'advanced',
    },
    {
      id: 'todoContent',
      title: 'Task Content',
      type: 'long-input',
      placeholder: 'Restore lost data',
      condition: { field: 'operation', value: 'datadog_add_incident_todo' },
      required: true,
    },
    {
      id: 'todoAssignees',
      title: 'Assignees',
      type: 'short-input',
      placeholder: '@jane@example.com, @oncall',
      condition: { field: 'operation', value: 'datadog_add_incident_todo' },
      required: true,
    },
    {
      id: 'todoDueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: '2026-01-10T05:00:00Z',
      condition: { field: 'operation', value: 'datadog_add_incident_todo' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp for when the task is due. Return ONLY the timestamp string.',
        placeholder: 'Describe when the task is due...',
        generationType: 'timestamp',
      },
    },

    // SLO inputs
    {
      id: 'sloId',
      title: 'SLO ID',
      type: 'short-input',
      placeholder: 'e6ce9c47b6c04d3d9dbfbb1cb4b7a8a3',
      condition: {
        field: 'operation',
        value: [
          'datadog_get_slo',
          'datadog_update_slo',
          'datadog_delete_slo',
          'datadog_get_slo_history',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'datadog_get_slo',
          'datadog_update_slo',
          'datadog_delete_slo',
          'datadog_get_slo_history',
        ],
      },
    },
    {
      id: 'sloName',
      title: 'SLO Name',
      type: 'short-input',
      placeholder: 'Checkout API availability',
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      required: { field: 'operation', value: ['datadog_create_slo'] },
    },
    {
      id: 'sloType',
      title: 'SLO Type',
      type: 'dropdown',
      options: [
        { label: 'Metric', id: 'metric' },
        { label: 'Monitor', id: 'monitor' },
      ],
      value: () => 'metric',
      condition: { field: 'operation', value: ['datadog_create_slo'] },
      required: { field: 'operation', value: ['datadog_create_slo'] },
    },
    {
      id: 'sloUpdateType',
      title: 'SLO Type',
      type: 'dropdown',
      options: [
        { label: 'Keep current', id: '' },
        { label: 'Metric', id: 'metric' },
        { label: 'Monitor', id: 'monitor' },
      ],
      condition: { field: 'operation', value: ['datadog_update_slo'] },
    },
    {
      id: 'sloThresholds',
      title: 'Thresholds (JSON)',
      type: 'code',
      placeholder: '[{"timeframe": "30d", "target": 99.9, "warning": 99.95}]',
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      required: { field: 'operation', value: ['datadog_create_slo'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Datadog SLO thresholds based on the user's description.
Each threshold object has:
- "timeframe": one of "7d", "30d", or "90d"
- "target": the target percentage (e.g., 99.9)
- "warning": optional warning percentage, must be greater than the target

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the SLO targets...',
        generationType: 'json-object',
      },
    },
    {
      id: 'sloMetricQuery',
      title: 'Metric Query (JSON)',
      type: 'code',
      placeholder:
        '{"numerator": "sum:requests{status:ok}.as_count()", "denominator": "sum:requests{*}.as_count()"}',
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog metric SLO query object based on the user's description.
The object has:
- "numerator": the query counting good events
- "denominator": the query counting all events

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the good events and total events...',
        generationType: 'json-object',
      },
    },
    {
      id: 'sloMonitorIds',
      title: 'Monitor IDs',
      type: 'short-input',
      placeholder: '12345678, 23456789',
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      mode: 'advanced',
    },
    {
      id: 'sloGroups',
      title: 'Monitor Groups',
      type: 'short-input',
      placeholder: 'env:prod, role:mysql',
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      mode: 'advanced',
    },
    {
      id: 'sloDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Availability of the checkout API',
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      mode: 'advanced',
    },
    {
      id: 'sloTags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'env:prod, team:core',
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      mode: 'advanced',
    },
    {
      id: 'sloTargetThreshold',
      title: 'Target Threshold',
      type: 'short-input',
      placeholder: '99.9',
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      mode: 'advanced',
    },
    {
      id: 'sloWarningThreshold',
      title: 'Warning Threshold',
      type: 'short-input',
      placeholder: '99.95',
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      mode: 'advanced',
    },
    {
      id: 'sloTimeframe',
      title: 'Timeframe',
      type: 'dropdown',
      options: [
        { label: '7 days', id: '7d' },
        { label: '30 days', id: '30d' },
        { label: '90 days', id: '90d' },
      ],
      condition: { field: 'operation', value: ['datadog_create_slo', 'datadog_update_slo'] },
      mode: 'advanced',
    },
    {
      id: 'sloIds',
      title: 'Filter by IDs',
      type: 'short-input',
      placeholder: 'id1, id2',
      condition: { field: 'operation', value: 'datadog_list_slos' },
      mode: 'advanced',
    },
    {
      id: 'sloQuery',
      title: 'Filter by Name',
      type: 'short-input',
      placeholder: 'checkout',
      condition: { field: 'operation', value: 'datadog_list_slos' },
      mode: 'advanced',
    },
    {
      id: 'sloTagsQuery',
      title: 'Filter by Tag',
      type: 'short-input',
      placeholder: 'env:prod',
      condition: { field: 'operation', value: 'datadog_list_slos' },
      mode: 'advanced',
    },
    {
      id: 'sloMetricsQuery',
      title: 'Filter by Metrics Query',
      type: 'short-input',
      placeholder: 'aws.elb.request_count',
      condition: { field: 'operation', value: 'datadog_list_slos' },
      mode: 'advanced',
    },
    {
      id: 'sloLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'datadog_list_slos' },
      mode: 'advanced',
    },
    {
      id: 'sloOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'datadog_list_slos' },
      mode: 'advanced',
    },
    {
      id: 'sloWithConfiguredAlertIds',
      title: 'Include SLO Monitor IDs',
      type: 'switch',
      condition: { field: 'operation', value: 'datadog_get_slo' },
      mode: 'advanced',
    },
    {
      id: 'sloForce',
      title: 'Force Delete',
      type: 'switch',
      condition: { field: 'operation', value: 'datadog_delete_slo' },
      mode: 'advanced',
    },
    {
      id: 'sloFromTs',
      title: 'From (Unix Timestamp)',
      type: 'short-input',
      placeholder: 'e.g., 1701360000',
      condition: { field: 'operation', value: 'datadog_get_slo_history' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Unix timestamp in seconds for the start of the window. Return ONLY the numeric timestamp.',
        placeholder: 'Describe the start time (e.g., "7 days ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'sloToTs',
      title: 'To (Unix Timestamp)',
      type: 'short-input',
      placeholder: 'e.g., 1701446400',
      condition: { field: 'operation', value: 'datadog_get_slo_history' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Unix timestamp in seconds for the end of the window. Return ONLY the numeric timestamp.',
        placeholder: 'Describe the end time (e.g., "now")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'sloTarget',
      title: 'Target',
      type: 'short-input',
      placeholder: '99.9',
      condition: { field: 'operation', value: 'datadog_get_slo_history' },
      mode: 'advanced',
    },
    {
      id: 'sloApplyCorrection',
      title: 'Apply Corrections',
      type: 'switch',
      value: () => 'true',
      condition: { field: 'operation', value: 'datadog_get_slo_history' },
      mode: 'advanced',
    },

    // Dashboard inputs
    {
      id: 'dashboardId',
      title: 'Dashboard ID',
      type: 'short-input',
      placeholder: 'abc-def-ghi',
      condition: {
        field: 'operation',
        value: ['datadog_get_dashboard', 'datadog_delete_dashboard'],
      },
      required: {
        field: 'operation',
        value: ['datadog_get_dashboard', 'datadog_delete_dashboard'],
      },
    },
    {
      id: 'dashboardTitle',
      title: 'Dashboard Title',
      type: 'short-input',
      placeholder: 'Checkout service overview',
      condition: { field: 'operation', value: 'datadog_create_dashboard' },
      required: true,
    },
    {
      id: 'dashboardLayoutType',
      title: 'Layout Type',
      type: 'dropdown',
      options: [
        { label: 'Ordered', id: 'ordered' },
        { label: 'Free', id: 'free' },
      ],
      value: () => 'ordered',
      condition: { field: 'operation', value: 'datadog_create_dashboard' },
      required: true,
    },
    {
      id: 'dashboardWidgets',
      title: 'Widgets (JSON)',
      type: 'code',
      placeholder:
        '[{"definition": {"type": "timeseries", "title": "CPU", "requests": [{"q": "avg:system.cpu.user{*}"}]}}]',
      condition: { field: 'operation', value: 'datadog_create_dashboard' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Datadog dashboard widgets based on the user's description.
Each widget has a "definition" object with at least a "type" (e.g., "timeseries", "query_value", "toplist"),
a "title", and the widget's "requests" array.

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the widgets you want on the dashboard...',
        generationType: 'json-object',
      },
    },
    {
      id: 'dashboardDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Latency, errors, and saturation for checkout',
      condition: { field: 'operation', value: 'datadog_create_dashboard' },
      mode: 'advanced',
    },
    {
      id: 'dashboardTags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'team:core',
      condition: { field: 'operation', value: 'datadog_create_dashboard' },
      mode: 'advanced',
    },
    {
      id: 'dashboardNotifyList',
      title: 'Notify List',
      type: 'short-input',
      placeholder: 'jane@example.com, john@example.com',
      condition: { field: 'operation', value: 'datadog_create_dashboard' },
      mode: 'advanced',
    },
    {
      id: 'dashboardTemplateVariables',
      title: 'Template Variables (JSON)',
      type: 'code',
      placeholder: '[{"name": "env", "prefix": "env", "available_values": ["prod", "staging"]}]',
      condition: { field: 'operation', value: 'datadog_create_dashboard' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Datadog dashboard template variables based on the user's description.
Each variable has a "name", an optional "prefix" (the tag key), and optional "available_values".

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the template variables...',
        generationType: 'json-object',
      },
    },
    {
      id: 'dashboardReflowType',
      title: 'Reflow Type',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Fixed', id: 'fixed' },
      ],
      condition: { field: 'operation', value: 'datadog_create_dashboard' },
      mode: 'advanced',
    },
    {
      id: 'dashboardFilterShared',
      title: 'Shared Only',
      type: 'switch',
      condition: { field: 'operation', value: 'datadog_list_dashboards' },
      mode: 'advanced',
    },
    {
      id: 'dashboardFilterDeleted',
      title: 'Deleted Only',
      type: 'switch',
      condition: { field: 'operation', value: 'datadog_list_dashboards' },
      mode: 'advanced',
    },
    {
      id: 'dashboardCount',
      title: 'Count',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'datadog_list_dashboards' },
      mode: 'advanced',
    },
    {
      id: 'dashboardStart',
      title: 'Start Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'datadog_list_dashboards' },
      mode: 'advanced',
    },

    // Synthetics inputs
    {
      id: 'syntheticsPublicId',
      title: 'Test Public ID',
      type: 'short-input',
      placeholder: 'abc-def-ghi',
      condition: {
        field: 'operation',
        value: [
          'datadog_get_synthetics_test',
          'datadog_get_synthetics_results',
          'datadog_get_browser_synthetics_results',
          'datadog_update_synthetics_status',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'datadog_get_synthetics_test',
          'datadog_get_synthetics_results',
          'datadog_get_browser_synthetics_results',
          'datadog_update_synthetics_status',
        ],
      },
    },
    {
      id: 'syntheticsNewStatus',
      title: 'New Status',
      type: 'dropdown',
      options: [
        { label: 'Live', id: 'live' },
        { label: 'Paused', id: 'paused' },
      ],
      value: () => 'live',
      condition: { field: 'operation', value: 'datadog_update_synthetics_status' },
      required: true,
    },
    {
      id: 'syntheticsPublicIds',
      title: 'Test Public IDs',
      type: 'short-input',
      placeholder: 'abc-def-ghi, jkl-mno-pqr',
      condition: { field: 'operation', value: 'datadog_trigger_synthetics_tests' },
      required: true,
    },
    {
      id: 'syntheticsFromTs',
      title: 'From (Unix Milliseconds)',
      type: 'short-input',
      placeholder: 'e.g., 1701360000000',
      condition: {
        field: 'operation',
        value: ['datadog_get_synthetics_results', 'datadog_get_browser_synthetics_results'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Unix timestamp in MILLISECONDS for the start of the window. Return ONLY the numeric timestamp.',
        placeholder: 'Describe the start time (e.g., "1 hour ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'syntheticsToTs',
      title: 'To (Unix Milliseconds)',
      type: 'short-input',
      placeholder: 'e.g., 1701446400000',
      condition: {
        field: 'operation',
        value: ['datadog_get_synthetics_results', 'datadog_get_browser_synthetics_results'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Unix timestamp in MILLISECONDS for the end of the window. Return ONLY the numeric timestamp.',
        placeholder: 'Describe the end time (e.g., "now")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'syntheticsProbeDc',
      title: 'Locations',
      type: 'short-input',
      placeholder: 'aws:eu-west-3, aws:us-east-1',
      condition: {
        field: 'operation',
        value: ['datadog_get_synthetics_results', 'datadog_get_browser_synthetics_results'],
      },
      mode: 'advanced',
    },
    {
      id: 'syntheticsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'datadog_list_synthetics_tests' },
      mode: 'advanced',
    },
    {
      id: 'syntheticsPageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'datadog_list_synthetics_tests' },
      mode: 'advanced',
    },

    // Security monitoring inputs
    {
      id: 'signalId',
      title: 'Signal ID',
      type: 'short-input',
      placeholder: 'AAAAAWgN8Xwgr1vKDQAAAABBV2dOOFh3ZzZobm1mWXJFYTR0OA',
      condition: {
        field: 'operation',
        value: [
          'datadog_get_security_signal',
          'datadog_update_security_signal_state',
          'datadog_update_security_signal_assignee',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'datadog_get_security_signal',
          'datadog_update_security_signal_state',
          'datadog_update_security_signal_assignee',
        ],
      },
    },
    {
      id: 'signalState',
      title: 'Triage State',
      type: 'dropdown',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Under Review', id: 'under_review' },
        { label: 'Archived', id: 'archived' },
      ],
      value: () => 'open',
      condition: { field: 'operation', value: 'datadog_update_security_signal_state' },
      required: true,
    },
    {
      id: 'signalArchiveReason',
      title: 'Archive Reason',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'none' },
        { label: 'False Positive', id: 'false_positive' },
        { label: 'Testing Or Maintenance', id: 'testing_or_maintenance' },
        { label: 'Remediated', id: 'remediated' },
        { label: 'Investigated, Case Opened', id: 'investigated_case_opened' },
        { label: 'True Positive - Benign', id: 'true_positive_benign' },
        { label: 'True Positive - Malicious', id: 'true_positive_malicious' },
        { label: 'Other', id: 'other' },
      ],
      condition: { field: 'operation', value: 'datadog_update_security_signal_state' },
      mode: 'advanced',
    },
    {
      id: 'signalArchiveComment',
      title: 'Archive Comment',
      type: 'long-input',
      placeholder: 'Known scanner traffic from the security team',
      condition: { field: 'operation', value: 'datadog_update_security_signal_state' },
      mode: 'advanced',
    },
    {
      id: 'signalAssigneeUuid',
      title: 'Assignee UUID',
      type: 'short-input',
      placeholder: '773b045d-ccf8-4808-bd3b-955ef6a8c940',
      condition: { field: 'operation', value: 'datadog_update_security_signal_assignee' },
      required: true,
    },
    {
      id: 'signalQuery',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'security:attack status:high',
      condition: { field: 'operation', value: 'datadog_list_security_signals' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog security signal search query based on the user's description.
The query uses facet syntax: facet:value
Examples:
- "security:attack status:high" - High severity attack signals
- "@workflow.rule.name:\"Brute Force\"" - Signals from a specific rule
- "source:cloudtrail status:critical" - Critical CloudTrail signals

Return ONLY the search query string - no explanations.`,
        placeholder: 'Describe the signals you want to find...',
      },
    },
    {
      id: 'signalFrom',
      title: 'From',
      type: 'short-input',
      placeholder: '2026-01-02T09:42:36.320Z',
      condition: { field: 'operation', value: 'datadog_list_security_signals' },
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the described start time into an absolute ISO-8601 UTC date-time, e.g. 2026-01-02T09:42:36.320Z. Datadog signal search rejects relative expressions such as "now-1h", so always resolve them against the current date. Return ONLY the timestamp.',
        placeholder: 'Describe the start time (e.g., "1 hour ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'signalTo',
      title: 'To',
      type: 'short-input',
      placeholder: '2026-01-03T09:42:36.320Z',
      condition: { field: 'operation', value: 'datadog_list_security_signals' },
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the described end time into an absolute ISO-8601 UTC date-time, e.g. 2026-01-03T09:42:36.320Z. Datadog signal search rejects relative expressions such as "now", so always resolve them against the current date. Return ONLY the timestamp.',
        placeholder: 'Describe the end time (e.g., "now")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'signalSort',
      title: 'Sort',
      type: 'dropdown',
      options: [
        { label: 'Newest First', id: '-timestamp' },
        { label: 'Oldest First', id: 'timestamp' },
      ],
      condition: { field: 'operation', value: 'datadog_list_security_signals' },
      mode: 'advanced',
    },
    {
      id: 'signalLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'datadog_list_security_signals' },
      mode: 'advanced',
    },
    {
      id: 'signalCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Cursor returned by a previous call',
      condition: { field: 'operation', value: 'datadog_list_security_signals' },
      mode: 'advanced',
    },
    {
      id: 'ruleQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'type:log_detection source:cloudtrail',
      condition: { field: 'operation', value: 'datadog_list_security_rules' },
      mode: 'advanced',
    },
    {
      id: 'ruleSort',
      title: 'Sort',
      type: 'dropdown',
      options: [
        { label: 'Name', id: 'name' },
        { label: 'Name (descending)', id: '-name' },
        { label: 'Creation Date', id: 'creation_date' },
        { label: 'Creation Date (descending)', id: '-creation_date' },
        { label: 'Update Date', id: 'update_date' },
        { label: 'Update Date (descending)', id: '-update_date' },
      ],
      condition: { field: 'operation', value: 'datadog_list_security_rules' },
      mode: 'advanced',
    },
    {
      id: 'rulePageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'datadog_list_security_rules' },
      mode: 'advanced',
    },
    {
      id: 'rulePageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'datadog_list_security_rules' },
      mode: 'advanced',
    },

    // APM inputs
    {
      id: 'spanQuery',
      title: 'Span Query',
      type: 'long-input',
      placeholder: 'service:checkout AND @http.status_code:[500 TO 599]',
      condition: { field: 'operation', value: 'datadog_search_spans' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Datadog span search query based on the user's description.
The query uses facet syntax: facet:value
Examples:
- "service:checkout AND @http.status_code:[500 TO 599]" - Server errors in checkout
- "env:prod resource_name:\"GET /cart\"" - Spans for a specific endpoint
- "@duration:>1000000000" - Spans slower than one second (duration is in nanoseconds)

Return ONLY the search query string - no explanations.`,
        placeholder: 'Describe the spans you want to find...',
      },
    },
    {
      id: 'spanFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'now-15m',
      condition: { field: 'operation', value: 'datadog_search_spans' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Datadog relative time string such as now-15m, now-1h, or now-1d. Return ONLY the string.',
        placeholder: 'Describe the start time (e.g., "15 minutes ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'spanTo',
      title: 'To',
      type: 'short-input',
      placeholder: 'now',
      condition: { field: 'operation', value: 'datadog_search_spans' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Datadog relative time string such as now or now-5m. Return ONLY the string.',
        placeholder: 'Describe the end time (e.g., "now")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'spanSort',
      title: 'Sort',
      type: 'dropdown',
      options: [
        { label: 'Newest First', id: '-timestamp' },
        { label: 'Oldest First', id: 'timestamp' },
      ],
      condition: { field: 'operation', value: 'datadog_search_spans' },
      mode: 'advanced',
    },
    {
      id: 'spanLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'datadog_search_spans' },
      mode: 'advanced',
    },
    {
      id: 'spanCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Cursor returned by a previous call',
      condition: { field: 'operation', value: 'datadog_search_spans' },
      mode: 'advanced',
    },
    {
      id: 'servicePageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'datadog_list_services' },
      mode: 'advanced',
    },
    {
      id: 'servicePageNumber',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'datadog_list_services' },
      mode: 'advanced',
    },
    {
      id: 'serviceSchemaVersion',
      title: 'Schema Version',
      type: 'dropdown',
      options: [
        { label: 'v2', id: 'v2' },
        { label: 'v2.1', id: 'v2.1' },
        { label: 'v2.2', id: 'v2.2' },
      ],
      condition: { field: 'operation', value: 'datadog_list_services' },
      mode: 'advanced',
    },

    // Authentication (common)
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
          'datadog_unmute_monitor',
          'datadog_query_logs',
          'datadog_create_downtime',
          'datadog_list_downtimes',
          'datadog_cancel_downtime',
          'datadog_list_incidents',
          'datadog_get_incident',
          'datadog_create_incident',
          'datadog_update_incident',
          'datadog_add_incident_todo',
          'datadog_list_slos',
          'datadog_get_slo',
          'datadog_create_slo',
          'datadog_update_slo',
          'datadog_delete_slo',
          'datadog_get_slo_history',
          'datadog_list_dashboards',
          'datadog_get_dashboard',
          'datadog_create_dashboard',
          'datadog_delete_dashboard',
          'datadog_list_synthetics_tests',
          'datadog_get_synthetics_test',
          'datadog_get_synthetics_results',
          'datadog_get_browser_synthetics_results',
          'datadog_trigger_synthetics_tests',
          'datadog_update_synthetics_status',
          'datadog_list_security_signals',
          'datadog_get_security_signal',
          'datadog_update_security_signal_state',
          'datadog_update_security_signal_assignee',
          'datadog_list_security_rules',
          'datadog_search_spans',
          'datadog_list_services',
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
        { label: 'AP2 (ap2.datadoghq.com)', id: 'ap2.datadoghq.com' },
        { label: 'UK1 (uk1.datadoghq.com)', id: 'uk1.datadoghq.com' },
        { label: 'US1-FED (ddog-gov.com)', id: 'ddog-gov.com' },
        { label: 'US2-FED (us2.ddog-gov.com)', id: 'us2.ddog-gov.com' },
      ],
      value: () => 'datadoghq.com',
      mode: 'advanced',
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
      'datadog_unmute_monitor',
      'datadog_query_logs',
      'datadog_send_logs',
      'datadog_create_downtime',
      'datadog_list_downtimes',
      'datadog_cancel_downtime',
      'datadog_list_incidents',
      'datadog_get_incident',
      'datadog_create_incident',
      'datadog_update_incident',
      'datadog_add_incident_todo',
      'datadog_list_slos',
      'datadog_get_slo',
      'datadog_create_slo',
      'datadog_update_slo',
      'datadog_delete_slo',
      'datadog_get_slo_history',
      'datadog_list_dashboards',
      'datadog_get_dashboard',
      'datadog_create_dashboard',
      'datadog_delete_dashboard',
      'datadog_list_synthetics_tests',
      'datadog_get_synthetics_test',
      'datadog_get_synthetics_results',
      'datadog_get_browser_synthetics_results',
      'datadog_trigger_synthetics_tests',
      'datadog_update_synthetics_status',
      'datadog_list_security_signals',
      'datadog_get_security_signal',
      'datadog_update_security_signal_state',
      'datadog_update_security_signal_assignee',
      'datadog_list_security_rules',
      'datadog_search_spans',
      'datadog_list_services',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const baseParams: { apiKey: string; applicationKey: string; site: string } = {
          apiKey: params.apiKey,
          applicationKey: params.applicationKey,
          site: params.site,
        }

        switch (params.operation) {
          case 'datadog_submit_metrics':
            return { ...baseParams, series: params.series }

          case 'datadog_query_timeseries':
            return {
              ...baseParams,
              query: params.query,
              from: datadogNumber(params.from),
              to: datadogNumber(params.to),
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
              priority: datadogNumber(params.monitorPriority),
              options: params.options,
            }

          case 'datadog_get_monitor':
            return { ...baseParams, monitorId: params.monitorId }

          case 'datadog_list_monitors':
            return {
              ...baseParams,
              name: params.listMonitorName || undefined,
              tags: params.listMonitorTags || undefined,
              /**
               * `monitorTags` belongs to Create Monitor but serializes for every operation, and
               * the block merges these params over the raw inputs. Without an explicit clear, a
               * leftover value would filter this list while presenting it as complete.
               */
              monitorTags: undefined,
              pageSize: datadogNumber(params.listMonitorPageSize),
              page: datadogNumber(params.listMonitorPage),
            }

          case 'datadog_mute_monitor':
            return {
              ...baseParams,
              monitorId: params.muteMonitorId,
              scope: params.scope || undefined,
              end: datadogNumber(params.end),
            }

          case 'datadog_unmute_monitor':
            return {
              ...baseParams,
              monitorId: params.muteMonitorId,
              scope: params.scope || undefined,
              allScopes: toSwitchBoolean(params.unmuteAllScopes),
            }

          case 'datadog_query_logs':
            return {
              ...baseParams,
              query: params.logQuery,
              from: params.logFrom,
              to: params.logTo,
              limit: datadogNumber(params.logLimit),
              cursor: params.logCursor || undefined,
            }

          case 'datadog_send_logs':
            return { ...baseParams, logs: params.logs }

          case 'datadog_create_downtime':
            return {
              ...baseParams,
              scope: params.downtimeScope,
              message: params.downtimeMessage,
              start: datadogNumber(params.downtimeStart),
              end: datadogNumber(params.downtimeEnd),
              monitorId: params.downtimeMonitorId,
              monitorTags: params.downtimeMonitorTags || undefined,
              timezone: params.downtimeTimezone || undefined,
              muteFirstRecoveryNotification: toSwitchBoolean(params.downtimeMuteFirstRecovery),
            }

          case 'datadog_list_downtimes':
            return {
              ...baseParams,
              currentOnly: toSwitchBoolean(params.currentOnly),
              limit: datadogNumber(params.downtimeLimit),
              offset: datadogNumber(params.downtimeOffset),
            }

          case 'datadog_cancel_downtime':
            return { ...baseParams, downtimeId: params.downtimeId }

          case 'datadog_list_incidents':
            return {
              ...baseParams,
              include: params.incidentInclude || undefined,
              pageSize: datadogNumber(params.incidentPageSize),
              pageOffset: datadogNumber(params.incidentPageOffset),
            }

          case 'datadog_get_incident':
            return {
              ...baseParams,
              incidentId: params.incidentId,
              include: params.incidentInclude || undefined,
            }

          case 'datadog_create_incident':
            return {
              ...baseParams,
              title: params.incidentTitle,
              customerImpacted: toSwitchBoolean(params.incidentCustomerImpacted) ?? false,
              severity: params.incidentSeverity || undefined,
              customerImpactScope: params.incidentCustomerImpactScope || undefined,
              incidentTypeUuid: params.incidentTypeUuid || undefined,
              isTest: toSwitchBoolean(params.incidentIsTest),
              fields: params.incidentFields || undefined,
              notificationHandles: params.incidentNotificationHandles || undefined,
            }

          case 'datadog_update_incident':
            return {
              ...baseParams,
              incidentId: params.incidentId,
              title: params.incidentTitle || undefined,
              severity: params.incidentSeverity || undefined,
              customerImpacted: toSwitchBoolean(params.incidentCustomerImpacted),
              customerImpactScope: params.incidentCustomerImpactScope || undefined,
              customerImpactStart: params.incidentCustomerImpactStart || undefined,
              customerImpactEnd: params.incidentCustomerImpactEnd || undefined,
              detected: params.incidentDetected || undefined,
              fields: params.incidentFields || undefined,
              notificationHandles: params.incidentNotificationHandles || undefined,
            }

          case 'datadog_add_incident_todo':
            return {
              ...baseParams,
              incidentId: params.incidentId,
              content: params.todoContent,
              assignees: params.todoAssignees,
              dueDate: params.todoDueDate || undefined,
            }

          case 'datadog_list_slos':
            return {
              ...baseParams,
              ids: params.sloIds || undefined,
              query: params.sloQuery || undefined,
              tagsQuery: params.sloTagsQuery || undefined,
              metricsQuery: params.sloMetricsQuery || undefined,
              limit: datadogNumber(params.sloLimit),
              offset: datadogNumber(params.sloOffset),
            }

          case 'datadog_get_slo':
            return {
              ...baseParams,
              sloId: params.sloId,
              withConfiguredAlertIds: toSwitchBoolean(params.sloWithConfiguredAlertIds),
            }

          case 'datadog_create_slo':
            return {
              ...baseParams,
              name: params.sloName,
              type: params.sloType,
              thresholds: params.sloThresholds,
              description: params.sloDescription || undefined,
              tags: params.sloTags || undefined,
              query: params.sloMetricQuery || undefined,
              monitorIds: params.sloMonitorIds || undefined,
              groups: params.sloGroups || undefined,
              targetThreshold: datadogNumber(params.sloTargetThreshold),
              warningThreshold: datadogNumber(params.sloWarningThreshold),
              timeframe: params.sloTimeframe || undefined,
            }

          case 'datadog_update_slo':
            return {
              ...baseParams,
              sloId: params.sloId,
              name: params.sloName || undefined,
              type: params.sloUpdateType || undefined,
              thresholds: params.sloThresholds || undefined,
              description: params.sloDescription || undefined,
              tags: params.sloTags || undefined,
              query: params.sloMetricQuery || undefined,
              monitorIds: params.sloMonitorIds || undefined,
              groups: params.sloGroups || undefined,
              targetThreshold: datadogNumber(params.sloTargetThreshold),
              warningThreshold: datadogNumber(params.sloWarningThreshold),
              timeframe: params.sloTimeframe || undefined,
            }

          case 'datadog_delete_slo':
            return {
              ...baseParams,
              sloId: params.sloId,
              force: toSwitchBoolean(params.sloForce),
            }

          case 'datadog_get_slo_history':
            return {
              ...baseParams,
              sloId: params.sloId,
              fromTs: datadogNumber(params.sloFromTs),
              toTs: datadogNumber(params.sloToTs),
              target: datadogNumber(params.sloTarget),
              applyCorrection: toSwitchBoolean(params.sloApplyCorrection),
            }

          case 'datadog_list_dashboards':
            return {
              ...baseParams,
              filterShared: toSwitchBoolean(params.dashboardFilterShared),
              filterDeleted: toSwitchBoolean(params.dashboardFilterDeleted),
              count: datadogNumber(params.dashboardCount),
              start: datadogNumber(params.dashboardStart),
            }

          case 'datadog_get_dashboard':
            return { ...baseParams, dashboardId: params.dashboardId }

          case 'datadog_create_dashboard':
            return {
              ...baseParams,
              title: params.dashboardTitle,
              layoutType: params.dashboardLayoutType,
              widgets: params.dashboardWidgets,
              description: params.dashboardDescription || undefined,
              notifyList: params.dashboardNotifyList || undefined,
              templateVariables: params.dashboardTemplateVariables || undefined,
              tags: params.dashboardTags || undefined,
              reflowType: params.dashboardReflowType || undefined,
            }

          case 'datadog_delete_dashboard':
            return { ...baseParams, dashboardId: params.dashboardId }

          case 'datadog_list_synthetics_tests':
            return {
              ...baseParams,
              pageSize: datadogNumber(params.syntheticsPageSize),
              pageNumber: datadogNumber(params.syntheticsPageNumber),
            }

          case 'datadog_get_synthetics_test':
            return { ...baseParams, publicId: params.syntheticsPublicId }

          case 'datadog_get_synthetics_results':
          case 'datadog_get_browser_synthetics_results':
            return {
              ...baseParams,
              publicId: params.syntheticsPublicId,
              fromTs: datadogNumber(params.syntheticsFromTs),
              toTs: datadogNumber(params.syntheticsToTs),
              probeDc: params.syntheticsProbeDc || undefined,
            }

          case 'datadog_trigger_synthetics_tests':
            return { ...baseParams, publicIds: params.syntheticsPublicIds }

          case 'datadog_update_synthetics_status':
            return {
              ...baseParams,
              publicId: params.syntheticsPublicId,
              newStatus: params.syntheticsNewStatus,
            }

          case 'datadog_list_security_signals':
            return {
              ...baseParams,
              query: params.signalQuery || undefined,
              from: params.signalFrom || undefined,
              to: params.signalTo || undefined,
              sort: params.signalSort || undefined,
              cursor: params.signalCursor || undefined,
              limit: datadogNumber(params.signalLimit),
            }

          case 'datadog_get_security_signal':
            return { ...baseParams, signalId: params.signalId }

          case 'datadog_update_security_signal_state':
            return {
              ...baseParams,
              signalId: params.signalId,
              state: params.signalState,
              archiveReason: params.signalArchiveReason || undefined,
              archiveComment: params.signalArchiveComment || undefined,
            }

          case 'datadog_update_security_signal_assignee':
            return {
              ...baseParams,
              signalId: params.signalId,
              assigneeUuid: params.signalAssigneeUuid,
            }

          case 'datadog_list_security_rules':
            return {
              ...baseParams,
              query: params.ruleQuery || undefined,
              sort: params.ruleSort || undefined,
              pageSize: datadogNumber(params.rulePageSize),
              pageNumber: datadogNumber(params.rulePageNumber),
            }

          case 'datadog_search_spans':
            return {
              ...baseParams,
              query: params.spanQuery || undefined,
              from: params.spanFrom || undefined,
              to: params.spanTo || undefined,
              sort: params.spanSort || undefined,
              cursor: params.spanCursor || undefined,
              limit: datadogNumber(params.spanLimit),
            }

          case 'datadog_list_services':
            return {
              ...baseParams,
              pageSize: datadogNumber(params.servicePageSize),
              pageNumber: datadogNumber(params.servicePageNumber),
              schemaVersion: params.serviceSchemaVersion || undefined,
            }

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
    // Logs
    muteMonitorId: { type: 'string', description: 'Monitor ID to mute or unmute' },
    scope: { type: 'string', description: 'Scope to mute or unmute' },
    end: { type: 'number', description: 'Unix timestamp when the mute ends' },
    unmuteAllScopes: { type: 'boolean', description: 'Clear mute settings for every scope' },
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
    downtimeMonitorTags: {
      type: 'string',
      description: 'Comma-separated monitor tags to target',
    },
    downtimeTimezone: { type: 'string', description: 'Display timezone for the downtime' },
    downtimeLimit: { type: 'number', description: 'Downtimes to return per page' },
    downtimeOffset: { type: 'number', description: 'Index of the first downtime to return' },
    downtimeMuteFirstRecovery: {
      type: 'boolean',
      description: 'Mute the first recovery notification',
    },
    currentOnly: { type: 'boolean', description: 'Filter to current downtimes' },
    downtimeId: { type: 'string', description: 'Downtime ID to cancel' },
    listMonitorName: { type: 'string', description: 'Filter monitors by name' },
    listMonitorTags: { type: 'string', description: 'Filter monitors by tags' },
    listMonitorPageSize: {
      type: 'number',
      description:
        'Monitors to return per page (max 1000). Datadog only applies this when a page number is sent, so setting it alone uses page 0.',
    },
    listMonitorPage: {
      type: 'number',
      description:
        'Monitor page number (0-indexed). With neither this nor the page size set, Datadog returns every monitor in the org without pagination.',
    },
    // Incidents
    incidentId: { type: 'string', description: 'Incident UUID' },
    incidentTitle: { type: 'string', description: 'Incident title' },
    incidentCustomerImpacted: { type: 'boolean', description: 'Whether customers were impacted' },
    incidentSeverity: { type: 'string', description: 'Incident severity' },
    incidentCustomerImpactScope: { type: 'string', description: 'Summary of the customer impact' },
    incidentCustomerImpactStart: { type: 'string', description: 'Customer impact start timestamp' },
    incidentCustomerImpactEnd: { type: 'string', description: 'Customer impact end timestamp' },
    incidentDetected: { type: 'string', description: 'Detection timestamp' },
    incidentTypeUuid: { type: 'string', description: 'Incident type UUID' },
    incidentIsTest: { type: 'boolean', description: 'Whether the incident is a test' },
    incidentFields: { type: 'json', description: 'User-defined incident fields' },
    incidentNotificationHandles: { type: 'string', description: 'Handles to notify' },
    incidentInclude: { type: 'string', description: 'Related resources to include' },
    incidentPageSize: { type: 'number', description: 'Incidents per page' },
    incidentPageOffset: { type: 'number', description: 'Incident page offset' },
    todoContent: { type: 'string', description: 'Follow-up task content' },
    todoAssignees: { type: 'string', description: 'Follow-up task assignees' },
    todoDueDate: { type: 'string', description: 'Follow-up task due date' },
    // SLOs
    sloId: { type: 'string', description: 'SLO ID' },
    sloName: { type: 'string', description: 'SLO name' },
    sloType: { type: 'string', description: 'SLO type' },
    sloUpdateType: {
      type: 'string',
      description: 'Replacement SLO type, or blank to keep current',
    },
    sloThresholds: { type: 'json', description: 'SLO thresholds' },
    sloDescription: { type: 'string', description: 'SLO description' },
    sloTags: { type: 'string', description: 'SLO tags' },
    sloMetricQuery: { type: 'json', description: 'Metric SLO numerator and denominator' },
    sloMonitorIds: { type: 'string', description: 'Monitor IDs for monitor SLOs' },
    sloGroups: { type: 'string', description: 'Monitor groups for monitor SLOs' },
    sloTargetThreshold: { type: 'number', description: 'Primary target threshold' },
    sloWarningThreshold: { type: 'number', description: 'Primary warning threshold' },
    sloTimeframe: { type: 'string', description: 'Primary timeframe' },
    sloIds: { type: 'string', description: 'Filter SLOs by IDs' },
    sloQuery: { type: 'string', description: 'Filter SLOs by name' },
    sloTagsQuery: { type: 'string', description: 'Filter SLOs by tag' },
    sloMetricsQuery: { type: 'string', description: 'Filter SLOs by metrics query' },
    sloLimit: { type: 'number', description: 'Max SLOs to return' },
    sloOffset: { type: 'number', description: 'SLO list offset' },
    sloWithConfiguredAlertIds: { type: 'boolean', description: 'Include SLO monitor IDs' },
    sloForce: { type: 'boolean', description: 'Force SLO deletion' },
    sloFromTs: { type: 'number', description: 'SLO history window start (Unix seconds)' },
    sloToTs: { type: 'number', description: 'SLO history window end (Unix seconds)' },
    sloTarget: { type: 'number', description: 'SLO target for history queries' },
    sloApplyCorrection: { type: 'boolean', description: 'Apply SLO corrections' },
    // Dashboards
    dashboardId: { type: 'string', description: 'Dashboard ID' },
    dashboardTitle: { type: 'string', description: 'Dashboard title' },
    dashboardLayoutType: { type: 'string', description: 'Dashboard layout type' },
    dashboardWidgets: { type: 'json', description: 'Dashboard widget definitions' },
    dashboardDescription: { type: 'string', description: 'Dashboard description' },
    dashboardTags: { type: 'string', description: 'Dashboard tags' },
    dashboardNotifyList: { type: 'string', description: 'Handles notified on changes' },
    dashboardTemplateVariables: { type: 'json', description: 'Template variable definitions' },
    dashboardReflowType: { type: 'string', description: 'Dashboard reflow type' },
    dashboardFilterShared: { type: 'boolean', description: 'Return only shared dashboards' },
    dashboardFilterDeleted: { type: 'boolean', description: 'Return only deleted dashboards' },
    dashboardCount: { type: 'number', description: 'Max dashboards to return' },
    dashboardStart: { type: 'number', description: 'Dashboard list offset' },
    // Synthetics
    syntheticsPublicId: { type: 'string', description: 'Synthetic test public ID' },
    syntheticsPublicIds: { type: 'string', description: 'Synthetic test public IDs to trigger' },
    syntheticsNewStatus: { type: 'string', description: 'New Synthetic test status' },
    syntheticsFromTs: { type: 'number', description: 'Results window start (Unix milliseconds)' },
    syntheticsToTs: { type: 'number', description: 'Results window end (Unix milliseconds)' },
    syntheticsProbeDc: { type: 'string', description: 'Locations to query results for' },
    syntheticsPageSize: { type: 'number', description: 'Synthetic tests per page' },
    syntheticsPageNumber: { type: 'number', description: 'Synthetic tests page number' },
    // Security monitoring
    signalId: { type: 'string', description: 'Security signal ID' },
    signalState: { type: 'string', description: 'Security signal triage state' },
    signalArchiveReason: { type: 'string', description: 'Archive reason' },
    signalArchiveComment: { type: 'string', description: 'Archive comment' },
    signalAssigneeUuid: { type: 'string', description: 'UUID of the assignee' },
    signalQuery: { type: 'string', description: 'Security signal search query' },
    signalFrom: { type: 'string', description: 'Signal search window start' },
    signalTo: { type: 'string', description: 'Signal search window end' },
    signalSort: { type: 'string', description: 'Signal sort order' },
    signalLimit: { type: 'number', description: 'Max signals to return' },
    signalCursor: { type: 'string', description: 'Signal pagination cursor' },
    ruleQuery: { type: 'string', description: 'Detection rule search query' },
    ruleSort: { type: 'string', description: 'Detection rule sort order' },
    rulePageSize: { type: 'number', description: 'Detection rules per page' },
    rulePageNumber: { type: 'number', description: 'Detection rules page number' },
    // APM
    spanQuery: { type: 'string', description: 'Span search query' },
    spanFrom: { type: 'string', description: 'Span search window start' },
    spanTo: { type: 'string', description: 'Span search window end' },
    spanSort: { type: 'string', description: 'Span sort order' },
    spanLimit: { type: 'number', description: 'Max spans to return' },
    spanCursor: { type: 'string', description: 'Span pagination cursor' },
    logCursor: { type: 'string', description: 'Log search pagination cursor' },
    servicePageSize: { type: 'number', description: 'Service definitions per page' },
    servicePageNumber: { type: 'number', description: 'Service definitions page number' },
    serviceSchemaVersion: { type: 'string', description: 'Service definition schema version' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    // Metrics
    series: { type: 'json', description: 'Timeseries data' },
    status: { type: 'string', description: 'Query status' },
    errors: { type: 'json', description: 'Metric series rejected during submission' },
    // Events
    event: { type: 'json', description: 'Event data' },
    // Monitors
    monitor: { type: 'json', description: 'Monitor data' },
    monitors: { type: 'json', description: 'List of monitors' },
    monitorId: { type: 'number', description: 'ID of the muted or unmuted monitor' },
    name: { type: 'string', description: 'Name of the muted or unmuted monitor' },
    overallState: { type: 'string', description: 'Monitor state after muting or unmuting' },
    // Logs
    logs: { type: 'json', description: 'Log entries' },
    nextLogId: { type: 'string', description: 'Pagination cursor for logs' },
    // Downtimes
    downtime: { type: 'json', description: 'Downtime data' },
    downtimes: { type: 'json', description: 'List of downtimes' },
    totalCount: { type: 'number', description: 'Total downtimes matching the filter' },
    // Incidents
    incident: { type: 'json', description: 'Incident data' },
    incidents: { type: 'json', description: 'List of incidents' },
    nextOffset: { type: 'number', description: 'Offset for the next page of incidents' },
    todo: { type: 'json', description: 'Incident follow-up task' },
    // SLOs
    slo: { type: 'json', description: 'Service level objective' },
    slos: { type: 'json', description: 'List of service level objectives' },
    history: { type: 'json', description: 'SLO history for the requested window' },
    sliValue: { type: 'number', description: 'Overall SLI value over the window' },
    deletedIds: { type: 'json', description: 'IDs of deleted service level objectives' },
    // Dashboards
    dashboard: { type: 'json', description: 'Dashboard definition' },
    dashboards: { type: 'json', description: 'List of dashboard summaries' },
    deletedDashboardId: { type: 'string', description: 'ID of the deleted dashboard' },
    // Synthetics
    test: { type: 'json', description: 'Synthetic test configuration' },
    tests: { type: 'json', description: 'List of Synthetic tests' },
    results: { type: 'json', description: 'Synthetic test run results' },
    lastTimestampFetched: { type: 'number', description: 'Timestamp of the latest test run' },
    batchId: { type: 'string', description: 'Public ID of the triggered batch' },
    triggeredCheckIds: { type: 'json', description: 'Public IDs of triggered tests' },
    locations: { type: 'json', description: 'Locations the tests ran from' },
    // Security monitoring
    signal: { type: 'json', description: 'Security signal' },
    signals: { type: 'json', description: 'List of security signals' },
    rules: { type: 'json', description: 'List of detection rules' },
    nextCursor: { type: 'string', description: 'Cursor for the next page of results' },
    // APM
    spans: { type: 'json', description: 'List of APM spans' },
    elapsed: { type: 'number', description: 'Query time in milliseconds' },
    services: { type: 'json', description: 'List of service definitions' },
  },
}

export const DatadogBlockMeta = {
  tags: ['monitoring', 'incident-management', 'error-tracking'],
  url: 'https://www.datadoghq.com',
  templates: [
    {
      icon: DatadogIcon,
      title: 'Datadog infra health report',
      prompt:
        'Create a scheduled daily workflow that queries Datadog for key infrastructure metrics — error rates, latency percentiles, CPU and memory usage — logs them to a table for trend tracking, and sends a morning Slack report highlighting any anomalies or degradations.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'infrastructure', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog alert-to-Linear bridge',
      prompt:
        'Build a scheduled workflow that polls Datadog monitors for any in an alerting state, classifies severity, creates a Linear ticket for non-paging issues with full context, and posts a Slack notification linking both.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog SLO weekly review',
      prompt:
        'Create a scheduled weekly workflow that queries Datadog timeseries for the key reliability metrics behind each service SLO, computes error budget burn, and writes a narrative review file for the SRE team to discuss in the weekly meeting.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog cost optimizer',
      prompt:
        'Build a scheduled workflow that queries Datadog estimated-usage timeseries for the top custom metrics by volume, writes optimization recommendations to a finance review file, and pings the platform team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog monitor config backup',
      prompt:
        'Create a scheduled workflow that lists every Datadog monitor nightly, fetches each monitor’s full configuration, exports the definitions as JSON to S3 with version history, and writes a manifest to a tracking table for restore drills.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog deploy guardrail',
      prompt:
        'Build a workflow triggered after a deploy that creates a Datadog event marker, queries error-rate and latency timeseries over the next few minutes, and pages the team via PagerDuty if the metrics breach the rollback threshold.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog SLO weekly report',
      prompt:
        'Create a scheduled weekly workflow that queries Datadog timeseries for key service SLOs, lists which monitors fired during the week, writes the SLO compliance numbers to a table, and emails an availability summary to the on-call leads.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'reporting', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'triage-firing-monitors',
      description:
        'List Datadog monitors, surface those in alert or warn state, and summarize what is firing and why.',
      content:
        '# Triage Firing Datadog Monitors\n\nGet a clear picture of what is alerting right now.\n\n## Steps\n1. List monitors and filter to those in Alert or Warn states.\n2. For each, get the monitor details: query, threshold, and current value.\n3. Group by service or tag to find common root causes.\n\n## Output\nA prioritized list of firing monitors with the metric, threshold, and likely affected service.',
    },
    {
      name: 'investigate-logs',
      description:
        'Query Datadog logs for a service and time window to find errors and summarize patterns.',
      content:
        '# Investigate Datadog Logs\n\nSearch logs to diagnose an issue.\n\n## Steps\n1. Confirm the service, environment, and time window.\n2. Query logs filtering for error/critical status and the relevant service tag.\n3. Aggregate by error message or type to find the dominant patterns.\n4. Pull sample log lines for the top patterns.\n\n## Output\nA summary of the top error patterns with counts and sample log lines.',
    },
    {
      name: 'analyze-metric-trend',
      description:
        'Query a Datadog timeseries metric over a window and report the trend, anomalies, and current value.',
      content:
        '# Analyze a Datadog Metric Trend\n\nUnderstand how a metric is behaving over time.\n\n## Steps\n1. Confirm the metric query and the time window.\n2. Query the timeseries and compute the trend (rising, flat, falling).\n3. Identify spikes, dips, or anomalies and when they occurred.\n\n## Output\nA short analysis with the current value, overall trend, and any notable anomalies with timestamps.',
    },
    {
      name: 'schedule-maintenance-downtime',
      description:
        'Create a Datadog downtime to mute monitors during a maintenance window, then confirm the scope and timing.',
      content:
        '# Schedule Datadog Maintenance Downtime\n\nSuppress alerts during planned maintenance.\n\n## Steps\n1. Confirm the scope (tags/monitors) and the start and end times.\n2. Create the downtime with that scope and window.\n3. Verify it was created by listing active downtimes.\n\n## Output\nA confirmation of the downtime with its scope, start/end time, and id.',
    },
  ],
} as const satisfies BlockMeta
