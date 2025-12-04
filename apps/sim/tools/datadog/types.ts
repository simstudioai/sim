// Common types for Datadog tools
import type { ToolResponse } from '@/tools/types'

// Datadog Site/Region options
export type DatadogSite =
  | 'datadoghq.com'
  | 'us3.datadoghq.com'
  | 'us5.datadoghq.com'
  | 'datadoghq.eu'
  | 'ap1.datadoghq.com'
  | 'ddog-gov.com'

// Base parameters for write-only operations (only need API key)
export interface DatadogWriteOnlyParams {
  apiKey: string
  site?: DatadogSite
}

// Base parameters for read/manage operations (need both API key and Application key)
export interface DatadogBaseParams extends DatadogWriteOnlyParams {
  applicationKey: string
}

// ========================
// METRICS TYPES
// ========================

export type MetricType = 'gauge' | 'rate' | 'count' | 'distribution'

export interface MetricPoint {
  timestamp: number
  value: number
}

export interface MetricSeries {
  metric: string
  type?: MetricType
  points: MetricPoint[]
  tags?: string[]
  unit?: string
  resources?: { name: string; type: string }[]
}

export interface SubmitMetricsParams extends DatadogWriteOnlyParams {
  series: string // JSON string of MetricSeries[]
}

export interface SubmitMetricsOutput {
  success: boolean
  errors?: string[]
}

export interface SubmitMetricsResponse extends ToolResponse {
  output: SubmitMetricsOutput
}

export interface QueryTimeseriesParams extends DatadogBaseParams {
  query: string
  from: number // Unix timestamp in seconds
  to: number // Unix timestamp in seconds
}

export interface TimeseriesPoint {
  timestamp: number
  value: number
}

export interface TimeseriesResult {
  metric: string
  tags: string[]
  points: TimeseriesPoint[]
}

export interface QueryTimeseriesOutput {
  series: TimeseriesResult[]
  status: string
}

export interface QueryTimeseriesResponse extends ToolResponse {
  output: QueryTimeseriesOutput
}

export interface ListMetricsParams extends DatadogBaseParams {
  from?: number // Unix timestamp - only return metrics active since this time
  host?: string // Filter by host name
  tags?: string // Filter by tags (comma-separated)
}

export interface ListMetricsOutput {
  metrics: string[]
}

export interface ListMetricsResponse extends ToolResponse {
  output: ListMetricsOutput
}

export interface GetMetricMetadataParams extends DatadogBaseParams {
  metricName: string
}

export interface MetricMetadata {
  description?: string
  short_name?: string
  unit?: string
  per_unit?: string
  type?: string
  integration?: string
}

export interface GetMetricMetadataOutput {
  metadata: MetricMetadata
}

export interface GetMetricMetadataResponse extends ToolResponse {
  output: GetMetricMetadataOutput
}

// ========================
// EVENTS TYPES
// ========================

export type EventAlertType =
  | 'error'
  | 'warning'
  | 'info'
  | 'success'
  | 'user_update'
  | 'recommendation'
  | 'snapshot'
export type EventPriority = 'normal' | 'low'

export interface CreateEventParams extends DatadogWriteOnlyParams {
  title: string
  text: string
  alertType?: EventAlertType
  priority?: EventPriority
  host?: string
  tags?: string // Comma-separated tags
  aggregationKey?: string
  sourceTypeName?: string
  dateHappened?: number // Unix timestamp
}

export interface EventData {
  id: number
  title: string
  text: string
  date_happened: number
  priority: string
  alert_type: string
  host?: string
  tags?: string[]
  url?: string
}

export interface CreateEventOutput {
  event: EventData
}

export interface CreateEventResponse extends ToolResponse {
  output: CreateEventOutput
}

export interface GetEventParams extends DatadogBaseParams {
  eventId: string
}

export interface GetEventOutput {
  event: EventData
}

export interface GetEventResponse extends ToolResponse {
  output: GetEventOutput
}

export interface QueryEventsParams extends DatadogBaseParams {
  start: number // Unix timestamp
  end: number // Unix timestamp
  priority?: EventPriority
  sources?: string // Comma-separated source names
  tags?: string // Comma-separated tags
  unaggregated?: boolean
  excludeAggregate?: boolean
  page?: number
}

export interface QueryEventsOutput {
  events: EventData[]
}

export interface QueryEventsResponse extends ToolResponse {
  output: QueryEventsOutput
}

// ========================
// MONITORS TYPES
// ========================

export type MonitorType =
  | 'metric alert'
  | 'service check'
  | 'event alert'
  | 'process alert'
  | 'log alert'
  | 'query alert'
  | 'composite'
  | 'synthetics alert'
  | 'trace-analytics alert'
  | 'slo alert'

export interface MonitorThresholds {
  critical?: number
  critical_recovery?: number
  warning?: number
  warning_recovery?: number
  ok?: number
}

export interface MonitorOptions {
  notify_no_data?: boolean
  no_data_timeframe?: number
  notify_audit?: boolean
  renotify_interval?: number
  escalation_message?: string
  thresholds?: MonitorThresholds
  include_tags?: boolean
  require_full_window?: boolean
  timeout_h?: number
  evaluation_delay?: number
  new_group_delay?: number
  min_location_failed?: number
}

export interface CreateMonitorParams extends DatadogBaseParams {
  name: string
  type: MonitorType
  query: string
  message?: string
  tags?: string // Comma-separated tags
  priority?: number // 1-5
  options?: string // JSON string of MonitorOptions
}

export interface MonitorData {
  id: number
  name: string
  type: string
  query: string
  message?: string
  tags?: string[]
  priority?: number
  options?: MonitorOptions
  overall_state?: string
  created?: string
  modified?: string
  creator?: { email: string; handle: string; name: string }
}

export interface CreateMonitorOutput {
  monitor: MonitorData
}

export interface CreateMonitorResponse extends ToolResponse {
  output: CreateMonitorOutput
}

export interface GetMonitorParams extends DatadogBaseParams {
  monitorId: string
  groupStates?: string // Comma-separated states: alert, warn, no data
  withDowntimes?: boolean
}

export interface GetMonitorOutput {
  monitor: MonitorData
}

export interface GetMonitorResponse extends ToolResponse {
  output: GetMonitorOutput
}

export interface UpdateMonitorParams extends DatadogBaseParams {
  monitorId: string
  name?: string
  query?: string
  message?: string
  tags?: string // Comma-separated tags
  priority?: number
  options?: string // JSON string of MonitorOptions
}

export interface UpdateMonitorOutput {
  monitor: MonitorData
}

export interface UpdateMonitorResponse extends ToolResponse {
  output: UpdateMonitorOutput
}

export interface DeleteMonitorParams extends DatadogBaseParams {
  monitorId: string
  force?: boolean
}

export interface DeleteMonitorOutput {
  deleted_monitor_id: number
}

export interface DeleteMonitorResponse extends ToolResponse {
  output: DeleteMonitorOutput
}

export interface ListMonitorsParams extends DatadogBaseParams {
  groupStates?: string // Comma-separated states
  name?: string // Filter by name
  tags?: string // Filter by tags (comma-separated)
  monitorTags?: string // Filter by monitor tags
  withDowntimes?: boolean
  idOffset?: number
  page?: number
  pageSize?: number
}

export interface ListMonitorsOutput {
  monitors: MonitorData[]
}

export interface ListMonitorsResponse extends ToolResponse {
  output: ListMonitorsOutput
}

export interface MuteMonitorParams extends DatadogBaseParams {
  monitorId: string
  scope?: string // Scope to mute (e.g., "host:myhost")
  end?: number // Unix timestamp when mute ends
}

export interface MuteMonitorOutput {
  success: boolean
}

export interface MuteMonitorResponse extends ToolResponse {
  output: MuteMonitorOutput
}

export interface UnmuteMonitorParams extends DatadogBaseParams {
  monitorId: string
  scope?: string
  allScopes?: boolean
}

export interface UnmuteMonitorOutput {
  success: boolean
}

export interface UnmuteMonitorResponse extends ToolResponse {
  output: UnmuteMonitorOutput
}

// ========================
// LOGS TYPES
// ========================

export interface LogEntry {
  ddsource?: string
  ddtags?: string
  hostname?: string
  message: string
  service?: string
}

export interface SendLogsParams extends DatadogWriteOnlyParams {
  logs: string // JSON string of LogEntry[]
}

export interface SendLogsOutput {
  success: boolean
}

export interface SendLogsResponse extends ToolResponse {
  output: SendLogsOutput
}

export interface QueryLogsParams extends DatadogBaseParams {
  query: string
  from: string // ISO-8601 or relative (now-1h)
  to: string // ISO-8601 or relative (now)
  limit?: number
  sort?: 'timestamp' | '-timestamp'
  indexes?: string // Comma-separated index names
}

export interface LogData {
  id: string
  content: {
    timestamp: string
    host?: string
    service?: string
    message: string
    status?: string
    attributes?: Record<string, any>
    tags?: string[]
  }
}

export interface QueryLogsOutput {
  logs: LogData[]
  nextLogId?: string
}

export interface QueryLogsResponse extends ToolResponse {
  output: QueryLogsOutput
}

// ========================
// DOWNTIME TYPES
// ========================

export interface CreateDowntimeParams extends DatadogBaseParams {
  scope: string // Scope to apply downtime (e.g., "host:myhost" or "*")
  message?: string
  start?: number // Unix timestamp, defaults to now
  end?: number // Unix timestamp
  timezone?: string
  monitorId?: string // Monitor ID to mute
  monitorTags?: string // Comma-separated tags to match monitors
  muteFirstRecoveryNotification?: boolean
  notifyEndTypes?: string // Comma-separated: "canceled", "expired"
  recurrence?: string // JSON string of recurrence config
}

export interface DowntimeData {
  id: number
  scope: string[]
  message?: string
  start?: number
  end?: number
  timezone?: string
  monitor_id?: number
  monitor_tags?: string[]
  mute_first_recovery_notification?: boolean
  disabled?: boolean
  created?: number
  modified?: number
  creator_id?: number
  canceled?: number
  active?: boolean
}

export interface CreateDowntimeOutput {
  downtime: DowntimeData
}

export interface CreateDowntimeResponse extends ToolResponse {
  output: CreateDowntimeOutput
}

export interface ListDowntimesParams extends DatadogBaseParams {
  currentOnly?: boolean
  withCreator?: boolean
  monitorId?: string
}

export interface ListDowntimesOutput {
  downtimes: DowntimeData[]
}

export interface ListDowntimesResponse extends ToolResponse {
  output: ListDowntimesOutput
}

export interface CancelDowntimeParams extends DatadogBaseParams {
  downtimeId: string
}

export interface CancelDowntimeOutput {
  success: boolean
}

export interface CancelDowntimeResponse extends ToolResponse {
  output: CancelDowntimeOutput
}

// ========================
// SLO TYPES
// ========================

export type SloType = 'metric' | 'monitor' | 'time_slice'

export interface SloThreshold {
  timeframe: '7d' | '30d' | '90d' | 'custom'
  target: number // Target percentage (e.g., 99.9)
  target_display?: string
  warning?: number
  warning_display?: string
}

export interface CreateSloParams extends DatadogBaseParams {
  name: string
  type: SloType
  description?: string
  tags?: string // Comma-separated tags
  thresholds: string // JSON string of SloThreshold[]
  // For metric-based SLO
  query?: string // JSON string of { numerator: string, denominator: string }
  // For monitor-based SLO
  monitorIds?: string // Comma-separated monitor IDs
  groups?: string // Comma-separated group names
}

export interface SloData {
  id: string
  name: string
  type: string
  description?: string
  tags?: string[]
  thresholds: SloThreshold[]
  creator?: { email: string; handle: string; name: string }
  created_at?: number
  modified_at?: number
}

export interface CreateSloOutput {
  slo: SloData
}

export interface CreateSloResponse extends ToolResponse {
  output: CreateSloOutput
}

export interface GetSloHistoryParams extends DatadogBaseParams {
  sloId: string
  fromTs: number // Unix timestamp
  toTs: number // Unix timestamp
  target?: number // Target SLO percentage
}

export interface SloHistoryData {
  from_ts: number
  to_ts: number
  type: string
  type_id: number
  sli_value?: number
  overall: {
    name: string
    sli_value: number
    span_precision: number
    precision: { [key: string]: number }
  }
  series?: {
    times: number[]
    values: number[]
  }
}

export interface GetSloHistoryOutput {
  history: SloHistoryData
}

export interface GetSloHistoryResponse extends ToolResponse {
  output: GetSloHistoryOutput
}

// ========================
// DASHBOARD TYPES
// ========================

export type DashboardLayoutType = 'ordered' | 'free'

export interface CreateDashboardParams extends DatadogBaseParams {
  title: string
  layoutType: DashboardLayoutType
  description?: string
  widgets?: string // JSON string of widget definitions
  isReadOnly?: boolean
  notifyList?: string // Comma-separated user handles to notify
  templateVariables?: string // JSON string of template variable definitions
  tags?: string // Comma-separated tags
}

export interface DashboardData {
  id: string
  title: string
  layout_type: string
  description?: string
  url?: string
  author_handle?: string
  created_at?: string
  modified_at?: string
  is_read_only?: boolean
  tags?: string[]
}

export interface CreateDashboardOutput {
  dashboard: DashboardData
}

export interface CreateDashboardResponse extends ToolResponse {
  output: CreateDashboardOutput
}

export interface GetDashboardParams extends DatadogBaseParams {
  dashboardId: string
}

export interface GetDashboardOutput {
  dashboard: DashboardData
}

export interface GetDashboardResponse extends ToolResponse {
  output: GetDashboardOutput
}

export interface ListDashboardsParams extends DatadogBaseParams {
  filterShared?: boolean
  filterDeleted?: boolean
  count?: number
  start?: number
}

export interface DashboardSummary {
  id: string
  title: string
  description?: string
  layout_type: string
  url?: string
  author_handle?: string
  created_at?: string
  modified_at?: string
  is_read_only?: boolean
  popularity?: number
}

export interface ListDashboardsOutput {
  dashboards: DashboardSummary[]
  total?: number
}

export interface ListDashboardsResponse extends ToolResponse {
  output: ListDashboardsOutput
}

// ========================
// HOSTS TYPES
// ========================

export interface ListHostsParams extends DatadogBaseParams {
  filter?: string // Filter hosts by name, alias, or tag
  sortField?: string // Field to sort by
  sortDir?: 'asc' | 'desc'
  start?: number // Starting offset
  count?: number // Max hosts to return
  from?: number // Unix timestamp - hosts seen in last N seconds
  includeMutedHostsData?: boolean
  includeHostsMetadata?: boolean
}

export interface HostData {
  name: string
  id: number
  aliases?: string[]
  apps?: string[]
  aws_name?: string
  host_name?: string
  is_muted?: boolean
  last_reported_time?: number
  meta?: {
    agent_version?: string
    cpu_cores?: number
    gohai?: string
    machine?: string
    platform?: string
  }
  metrics?: {
    cpu?: number
    iowait?: number
    load?: number
  }
  mute_timeout?: number
  sources?: string[]
  tags_by_source?: Record<string, string[]>
  up?: boolean
}

export interface ListHostsOutput {
  hosts: HostData[]
  total_matching?: number
  total_returned?: number
}

export interface ListHostsResponse extends ToolResponse {
  output: ListHostsOutput
}

// ========================
// INCIDENTS TYPES
// ========================

export type IncidentSeverity = 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4' | 'SEV-5' | 'UNKNOWN'
export type IncidentState = 'active' | 'stable' | 'resolved'

export interface CreateIncidentParams extends DatadogBaseParams {
  title: string
  customerImpacted: boolean
  severity?: IncidentSeverity
  fields?: string // JSON string of additional fields
}

export interface IncidentData {
  id: string
  type: string
  attributes: {
    title: string
    customer_impacted: boolean
    severity?: IncidentSeverity
    state?: IncidentState
    created?: string
    modified?: string
    resolved?: string
    detected?: string
    customer_impact_scope?: string
    customer_impact_start?: string
    customer_impact_end?: string
    public_id?: number
    time_to_detect?: number
    time_to_internal_response?: number
    time_to_repair?: number
    time_to_resolve?: number
  }
}

export interface CreateIncidentOutput {
  incident: IncidentData
}

export interface CreateIncidentResponse extends ToolResponse {
  output: CreateIncidentOutput
}

export interface ListIncidentsParams extends DatadogBaseParams {
  query?: string
  pageSize?: number
  pageOffset?: number
  include?: string // Comma-separated: users, attachments
}

export interface ListIncidentsOutput {
  incidents: IncidentData[]
}

export interface ListIncidentsResponse extends ToolResponse {
  output: ListIncidentsOutput
}

// Union type for all Datadog responses
export type DatadogResponse =
  | SubmitMetricsResponse
  | QueryTimeseriesResponse
  | ListMetricsResponse
  | GetMetricMetadataResponse
  | CreateEventResponse
  | GetEventResponse
  | QueryEventsResponse
  | CreateMonitorResponse
  | GetMonitorResponse
  | UpdateMonitorResponse
  | DeleteMonitorResponse
  | ListMonitorsResponse
  | MuteMonitorResponse
  | UnmuteMonitorResponse
  | SendLogsResponse
  | QueryLogsResponse
  | CreateDowntimeResponse
  | ListDowntimesResponse
  | CancelDowntimeResponse
  | CreateSloResponse
  | GetSloHistoryResponse
  | CreateDashboardResponse
  | GetDashboardResponse
  | ListDashboardsResponse
  | ListHostsResponse
  | CreateIncidentResponse
  | ListIncidentsResponse
