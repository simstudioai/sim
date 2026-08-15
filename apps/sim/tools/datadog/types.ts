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
interface DatadogWriteOnlyParams {
  apiKey: string
  site?: DatadogSite
}

// Base parameters for read/manage operations (need both API key and Application key)
interface DatadogBaseParams extends DatadogWriteOnlyParams {
  applicationKey: string
}

// METRICS TYPES

export type MetricType = 'gauge' | 'rate' | 'count' | 'distribution'

interface MetricPoint {
  timestamp: number
  value: number
}

interface MetricSeries {
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

interface SubmitMetricsOutput {
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

interface TimeseriesPoint {
  timestamp: number
  value: number
}

interface TimeseriesResult {
  metric: string
  tags: string[]
  points: TimeseriesPoint[]
}

interface QueryTimeseriesOutput {
  series: TimeseriesResult[]
  status: string
}

export interface QueryTimeseriesResponse extends ToolResponse {
  output: QueryTimeseriesOutput
}

interface ListMetricsParams extends DatadogBaseParams {
  from?: number // Unix timestamp - only return metrics active since this time
  host?: string // Filter by host name
  tags?: string // Filter by tags (comma-separated)
}

interface ListMetricsOutput {
  metrics: string[]
}

interface ListMetricsResponse extends ToolResponse {
  output: ListMetricsOutput
}

interface GetMetricMetadataParams extends DatadogBaseParams {
  metricName: string
}

interface MetricMetadata {
  description?: string
  short_name?: string
  unit?: string
  per_unit?: string
  type?: string
  integration?: string
}

interface GetMetricMetadataOutput {
  metadata: MetricMetadata
}

interface GetMetricMetadataResponse extends ToolResponse {
  output: GetMetricMetadataOutput
}

// EVENTS TYPES

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

interface EventData {
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

interface CreateEventOutput {
  event: EventData
}

export interface CreateEventResponse extends ToolResponse {
  output: CreateEventOutput
}

interface GetEventParams extends DatadogBaseParams {
  eventId: string
}

interface GetEventOutput {
  event: EventData
}

interface GetEventResponse extends ToolResponse {
  output: GetEventOutput
}

interface QueryEventsParams extends DatadogBaseParams {
  start: number // Unix timestamp
  end: number // Unix timestamp
  priority?: EventPriority
  sources?: string // Comma-separated source names
  tags?: string // Comma-separated tags
  unaggregated?: boolean
  excludeAggregate?: boolean
  page?: number
}

interface QueryEventsOutput {
  events: EventData[]
}

interface QueryEventsResponse extends ToolResponse {
  output: QueryEventsOutput
}

// MONITORS TYPES

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

interface MonitorThresholds {
  critical?: number
  critical_recovery?: number
  warning?: number
  warning_recovery?: number
  ok?: number
}

interface MonitorOptions {
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

interface MonitorData {
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

interface CreateMonitorOutput {
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

interface GetMonitorOutput {
  monitor: MonitorData
}

export interface GetMonitorResponse extends ToolResponse {
  output: GetMonitorOutput
}

interface UpdateMonitorParams extends DatadogBaseParams {
  monitorId: string
  name?: string
  query?: string
  message?: string
  tags?: string // Comma-separated tags
  priority?: number
  options?: string // JSON string of MonitorOptions
}

interface UpdateMonitorOutput {
  monitor: MonitorData
}

interface UpdateMonitorResponse extends ToolResponse {
  output: UpdateMonitorOutput
}

interface DeleteMonitorParams extends DatadogBaseParams {
  monitorId: string
  force?: boolean
}

interface DeleteMonitorOutput {
  deleted_monitor_id: number
}

interface DeleteMonitorResponse extends ToolResponse {
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

interface ListMonitorsOutput {
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

interface MuteMonitorOutput {
  success: boolean
}

export interface MuteMonitorResponse extends ToolResponse {
  output: MuteMonitorOutput
}

interface UnmuteMonitorParams extends DatadogBaseParams {
  monitorId: string
  scope?: string
  allScopes?: boolean
}

interface UnmuteMonitorOutput {
  success: boolean
}

interface UnmuteMonitorResponse extends ToolResponse {
  output: UnmuteMonitorOutput
}

// LOGS TYPES

interface LogEntry {
  ddsource?: string
  ddtags?: string
  hostname?: string
  message: string
  service?: string
}

export interface SendLogsParams extends DatadogWriteOnlyParams {
  logs: string // JSON string of LogEntry[]
}

interface SendLogsOutput {
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

interface LogData {
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

interface QueryLogsOutput {
  logs: LogData[]
  nextLogId?: string
}

export interface QueryLogsResponse extends ToolResponse {
  output: QueryLogsOutput
}

// DOWNTIME TYPES

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

interface DowntimeData {
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

interface CreateDowntimeOutput {
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

interface ListDowntimesOutput {
  downtimes: DowntimeData[]
}

export interface ListDowntimesResponse extends ToolResponse {
  output: ListDowntimesOutput
}

export interface CancelDowntimeParams extends DatadogBaseParams {
  downtimeId: string
}

interface CancelDowntimeOutput {
  success: boolean
}

export interface CancelDowntimeResponse extends ToolResponse {
  output: CancelDowntimeOutput
}
// SLO TYPES

export type SloType = 'metric' | 'monitor' | 'time_slice'

export type SloTimeframe = '7d' | '30d' | '90d' | 'custom'

interface SloThreshold {
  timeframe: SloTimeframe
  target: number
  target_display?: string
  warning?: number
  warning_display?: string
}

interface SloData {
  id: string
  name: string
  type: string
  description?: string | null
  tags?: string[]
  thresholds?: SloThreshold[]
  target_threshold?: number
  warning_threshold?: number
  timeframe?: string
  monitor_ids?: number[]
  monitor_tags?: string[]
  groups?: string[]
  query?: { numerator: string; denominator: string } | null
  creator?: { email?: string; handle?: string; name?: string | null } | null
  created_at?: number
  modified_at?: number
  configured_alert_ids?: number[]
}

export interface ListSlosParams extends DatadogBaseParams {
  ids?: string
  query?: string
  tagsQuery?: string
  metricsQuery?: string
  limit?: number
  offset?: number
  isDeleted?: boolean
}

interface ListSlosOutput {
  slos: SloData[]
}

export interface ListSlosResponse extends ToolResponse {
  output: ListSlosOutput
}

export interface GetSloParams extends DatadogBaseParams {
  sloId: string
  withConfiguredAlertIds?: boolean
}

interface GetSloOutput {
  slo: SloData
}

export interface GetSloResponse extends ToolResponse {
  output: GetSloOutput
}

export interface CreateSloParams extends DatadogBaseParams {
  name: string
  type: SloType
  description?: string
  tags?: string
  thresholds: string
  query?: string
  monitorIds?: string
  groups?: string
  targetThreshold?: number
  warningThreshold?: number
  timeframe?: SloTimeframe
}

interface CreateSloOutput {
  slo: SloData
}

export interface CreateSloResponse extends ToolResponse {
  output: CreateSloOutput
}

export interface UpdateSloParams extends CreateSloParams {
  sloId: string
}

interface UpdateSloOutput {
  slo: SloData
}

export interface UpdateSloResponse extends ToolResponse {
  output: UpdateSloOutput
}

export interface DeleteSloParams extends DatadogBaseParams {
  sloId: string
  force?: boolean
}

interface DeleteSloOutput {
  success: boolean
  deletedIds: string[]
}

export interface DeleteSloResponse extends ToolResponse {
  output: DeleteSloOutput
}

export interface GetSloHistoryParams extends DatadogBaseParams {
  sloId: string
  fromTs: number
  toTs: number
  target?: number
  applyCorrection?: boolean
}

interface SloHistorySliData {
  name?: string
  group?: string
  sli_value?: number | null
  span_precision?: number
  precision?: Record<string, number>
  error_budget_remaining?: Record<string, number>
  monitor_type?: string
  monitor_modified?: number
  preview?: boolean
  history?: number[][]
}

interface SloHistoryData {
  from_ts?: number
  to_ts?: number
  type?: string
  type_id?: number
  group_by?: string[]
  overall?: SloHistorySliData
  groups?: SloHistorySliData[]
  monitors?: SloHistorySliData[]
  thresholds?: Record<string, SloThreshold>
}

interface GetSloHistoryOutput {
  history: SloHistoryData
  sliValue?: number | null
}

export interface GetSloHistoryResponse extends ToolResponse {
  output: GetSloHistoryOutput
}

// DASHBOARD TYPES

export type DashboardLayoutType = 'ordered' | 'free'

interface DashboardData {
  id?: string
  title?: string
  layout_type?: string
  description?: string | null
  url?: string
  author_handle?: string
  author_name?: string | null
  created_at?: string
  modified_at?: string
  is_read_only?: boolean
  reflow_type?: string
  tags?: string[] | null
  notify_list?: string[] | null
  restricted_roles?: string[]
  template_variables?: unknown[] | null
  widgets?: unknown[]
}

interface DashboardSummaryData {
  id?: string
  title?: string
  description?: string | null
  layout_type?: string
  url?: string
  author_handle?: string
  created_at?: string
  modified_at?: string
  is_read_only?: boolean
}

export interface ListDashboardsParams extends DatadogBaseParams {
  filterShared?: boolean
  filterDeleted?: boolean
  count?: number
  start?: number
}

interface ListDashboardsOutput {
  dashboards: DashboardSummaryData[]
}

export interface ListDashboardsResponse extends ToolResponse {
  output: ListDashboardsOutput
}

export interface GetDashboardParams extends DatadogBaseParams {
  dashboardId: string
}

interface GetDashboardOutput {
  dashboard: DashboardData
}

export interface GetDashboardResponse extends ToolResponse {
  output: GetDashboardOutput
}

export interface CreateDashboardParams extends DatadogBaseParams {
  title: string
  layoutType: DashboardLayoutType
  widgets: string
  description?: string
  notifyList?: string
  templateVariables?: string
  tags?: string
  reflowType?: 'auto' | 'fixed'
}

interface CreateDashboardOutput {
  dashboard: DashboardData
}

export interface CreateDashboardResponse extends ToolResponse {
  output: CreateDashboardOutput
}

export interface DeleteDashboardParams extends DatadogBaseParams {
  dashboardId: string
}

interface DeleteDashboardOutput {
  success: boolean
  deletedDashboardId?: string
}

export interface DeleteDashboardResponse extends ToolResponse {
  output: DeleteDashboardOutput
}

// SYNTHETICS TYPES

export type SyntheticsTestPauseStatus = 'live' | 'paused'

interface SyntheticsTestData {
  public_id?: string
  name?: string
  status?: string
  type?: string
  subtype?: string
  message?: string
  monitor_id?: number
  tags?: string[]
  locations?: string[]
  config?: unknown
  options?: unknown
  creator?: { email?: string; handle?: string; name?: string | null } | null
}

export interface ListSyntheticsTestsParams extends DatadogBaseParams {
  pageSize?: number
  pageNumber?: number
}

interface ListSyntheticsTestsOutput {
  tests: SyntheticsTestData[]
}

export interface ListSyntheticsTestsResponse extends ToolResponse {
  output: ListSyntheticsTestsOutput
}

export interface GetSyntheticsTestParams extends DatadogBaseParams {
  publicId: string
}

interface GetSyntheticsTestOutput {
  test: SyntheticsTestData
}

export interface GetSyntheticsTestResponse extends ToolResponse {
  output: GetSyntheticsTestOutput
}

export interface GetSyntheticsResultsParams extends DatadogBaseParams {
  publicId: string
  fromTs?: number
  toTs?: number
  probeDc?: string
}

interface SyntheticsResultData {
  result_id?: string
  check_time?: number
  probe_dc?: string
  status?: number
  result?: { passed?: boolean; timings?: Record<string, number> }
}

interface GetSyntheticsResultsOutput {
  results: SyntheticsResultData[]
  lastTimestampFetched?: number
}

export interface GetSyntheticsResultsResponse extends ToolResponse {
  output: GetSyntheticsResultsOutput
}

export interface TriggerSyntheticsTestsParams extends DatadogBaseParams {
  publicIds: string
}

interface TriggerSyntheticsTestsOutput {
  batchId?: string | null
  triggeredCheckIds: string[]
  results: {
    public_id?: string
    result_id?: string
    location?: number
    device?: string
  }[]
  locations: { id?: number; name?: string }[]
}

export interface TriggerSyntheticsTestsResponse extends ToolResponse {
  output: TriggerSyntheticsTestsOutput
}

export interface UpdateSyntheticsStatusParams extends DatadogBaseParams {
  publicId: string
  newStatus: SyntheticsTestPauseStatus
}

interface UpdateSyntheticsStatusOutput {
  success: boolean
  status: SyntheticsTestPauseStatus
}

export interface UpdateSyntheticsStatusResponse extends ToolResponse {
  output: UpdateSyntheticsStatusOutput
}

// SECURITY MONITORING TYPES

export type SecuritySignalState = 'open' | 'archived' | 'under_review'

export type SecuritySignalArchiveReason =
  | 'none'
  | 'false_positive'
  | 'testing_or_maintenance'
  | 'remediated'
  | 'investigated_case_opened'
  | 'true_positive_benign'
  | 'true_positive_malicious'
  | 'other'

interface SecuritySignalData {
  id?: string
  type?: string
  attributes: {
    message?: string
    timestamp?: string
    tags?: string[]
    custom?: Record<string, unknown>
  }
}

export interface ListSecuritySignalsParams extends DatadogBaseParams {
  query?: string
  from?: string
  to?: string
  sort?: 'timestamp' | '-timestamp'
  cursor?: string
  limit?: number
}

interface ListSecuritySignalsOutput {
  signals: SecuritySignalData[]
  nextCursor?: string
}

export interface ListSecuritySignalsResponse extends ToolResponse {
  output: ListSecuritySignalsOutput
}

export interface GetSecuritySignalParams extends DatadogBaseParams {
  signalId: string
}

interface GetSecuritySignalOutput {
  signal: SecuritySignalData
}

export interface GetSecuritySignalResponse extends ToolResponse {
  output: GetSecuritySignalOutput
}

export interface SecuritySignalTriageData {
  id?: string
  type?: string
  state?: string
  assignee?: { uuid?: string; handle?: string; name?: string | null; id?: number }
  incidentIds?: number[]
  archiveReason?: string
  archiveComment?: string
  stateUpdateTimestamp?: number
}

export interface UpdateSecuritySignalStateParams extends DatadogBaseParams {
  signalId: string
  state: SecuritySignalState
  archiveReason?: SecuritySignalArchiveReason
  archiveComment?: string
}

interface UpdateSecuritySignalStateOutput {
  signal: SecuritySignalTriageData
}

export interface UpdateSecuritySignalStateResponse extends ToolResponse {
  output: UpdateSecuritySignalStateOutput
}

export interface UpdateSecuritySignalAssigneeParams extends DatadogBaseParams {
  signalId: string
  assigneeUuid: string
}

interface UpdateSecuritySignalAssigneeOutput {
  signal: SecuritySignalTriageData
}

export interface UpdateSecuritySignalAssigneeResponse extends ToolResponse {
  output: UpdateSecuritySignalAssigneeOutput
}

export interface ListSecurityRulesParams extends DatadogBaseParams {
  query?: string
  sort?: string
  pageSize?: number
  pageNumber?: number
}

interface SecurityRuleData {
  id?: string
  name?: string
  type?: string
  message?: string
  tags?: string[]
  isEnabled?: boolean
  isDefault?: boolean
  createdAt?: number
  version?: number
}

interface ListSecurityRulesOutput {
  rules: SecurityRuleData[]
}

export interface ListSecurityRulesResponse extends ToolResponse {
  output: ListSecurityRulesOutput
}

// APM / SPANS TYPES

export interface SearchSpansParams extends DatadogBaseParams {
  query?: string
  from?: string
  to?: string
  sort?: 'timestamp' | '-timestamp'
  cursor?: string
  limit?: number
}

interface SpanData {
  id?: string
  type?: string
  attributes: {
    service?: string
    resource_name?: string
    env?: string
    host?: string
    type?: string
    trace_id?: string
    span_id?: string
    parent_id?: string
    start_timestamp?: string
    end_timestamp?: string
    ingestion_reason?: string
    retained_by?: string
    single_span?: boolean
    tags?: string[]
    custom?: Record<string, unknown>
    attributes?: Record<string, unknown>
  }
}

interface SearchSpansOutput {
  spans: SpanData[]
  nextCursor?: string
  elapsed?: number
}

export interface SearchSpansResponse extends ToolResponse {
  output: SearchSpansOutput
}

export interface ListServicesParams extends DatadogBaseParams {
  pageSize?: number
  pageNumber?: number
  schemaVersion?: string
}

interface ServiceDefinitionData {
  id?: string
  type?: string
  schema?: Record<string, unknown>
  meta?: Record<string, unknown>
}

interface ListServicesOutput {
  services: ServiceDefinitionData[]
}

export interface ListServicesResponse extends ToolResponse {
  output: ListServicesOutput
}

// HOSTS TYPES

interface ListHostsParams extends DatadogBaseParams {
  filter?: string
  sortField?: string
  sortDir?: 'asc' | 'desc'
  start?: number
  count?: number
  from?: number
  includeMutedHostsData?: boolean
  includeHostsMetadata?: boolean
}

interface HostData {
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

interface ListHostsOutput {
  hosts: HostData[]
  total_matching?: number
  total_returned?: number
}

interface ListHostsResponse extends ToolResponse {
  output: ListHostsOutput
}

// INCIDENTS TYPES

export type IncidentSeverity = 'UNKNOWN' | 'SEV-0' | 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4' | 'SEV-5'

interface IncidentFieldValue {
  type?: string
  value?: string | string[] | null
}

interface IncidentData {
  id: string
  type?: string
  attributes: {
    title?: string
    state?: string | null
    severity?: string
    visibility?: string | null
    customer_impacted?: boolean
    customer_impact_scope?: string | null
    customer_impact_start?: string | null
    customer_impact_end?: string | null
    customer_impact_duration?: number
    fields?: Record<string, IncidentFieldValue>
    incident_type_uuid?: string
    is_test?: boolean
    public_id?: number
    created?: string
    modified?: string
    declared?: string
    detected?: string | null
    resolved?: string | null
    archived?: string | null
    time_to_detect?: number
    time_to_internal_response?: number
    time_to_repair?: number
    time_to_resolve?: number
  }
}

export interface ListIncidentsParams extends DatadogBaseParams {
  include?: string
  pageSize?: number
  pageOffset?: number
}

interface ListIncidentsOutput {
  incidents: IncidentData[]
  nextOffset?: number
}

export interface ListIncidentsResponse extends ToolResponse {
  output: ListIncidentsOutput
}

export interface GetIncidentParams extends DatadogBaseParams {
  incidentId: string
  include?: string
}

interface GetIncidentOutput {
  incident: IncidentData
}

export interface GetIncidentResponse extends ToolResponse {
  output: GetIncidentOutput
}

export interface CreateIncidentParams extends DatadogBaseParams {
  title: string
  customerImpacted: boolean
  severity?: IncidentSeverity
  customerImpactScope?: string
  incidentTypeUuid?: string
  isTest?: boolean
  fields?: string
  notificationHandles?: string
}

interface CreateIncidentOutput {
  incident: IncidentData
}

export interface CreateIncidentResponse extends ToolResponse {
  output: CreateIncidentOutput
}

export interface UpdateIncidentParams extends DatadogBaseParams {
  incidentId: string
  title?: string
  severity?: IncidentSeverity
  customerImpacted?: boolean
  customerImpactScope?: string
  customerImpactStart?: string
  customerImpactEnd?: string
  detected?: string
  fields?: string
  notificationHandles?: string
}

interface UpdateIncidentOutput {
  incident: IncidentData
}

export interface UpdateIncidentResponse extends ToolResponse {
  output: UpdateIncidentOutput
}

export interface AddIncidentTodoParams extends DatadogBaseParams {
  incidentId: string
  content: string
  assignees: string
  dueDate?: string
}

interface IncidentTodoData {
  id?: string
  type?: string
  attributes: {
    content?: string
    assignees?: string[]
    completed?: string | null
    due_date?: string | null
    incident_id?: string
    created?: string
    modified?: string
  }
}

interface AddIncidentTodoOutput {
  todo: IncidentTodoData
}

export interface AddIncidentTodoResponse extends ToolResponse {
  output: AddIncidentTodoOutput
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
  | ListSlosResponse
  | GetSloResponse
  | CreateSloResponse
  | UpdateSloResponse
  | DeleteSloResponse
  | GetSloHistoryResponse
  | ListDashboardsResponse
  | GetDashboardResponse
  | CreateDashboardResponse
  | DeleteDashboardResponse
  | ListSyntheticsTestsResponse
  | GetSyntheticsTestResponse
  | GetSyntheticsResultsResponse
  | TriggerSyntheticsTestsResponse
  | UpdateSyntheticsStatusResponse
  | ListSecuritySignalsResponse
  | GetSecuritySignalResponse
  | UpdateSecuritySignalStateResponse
  | UpdateSecuritySignalAssigneeResponse
  | ListSecurityRulesResponse
  | SearchSpansResponse
  | ListServicesResponse
  | ListHostsResponse
  | ListIncidentsResponse
  | GetIncidentResponse
  | CreateIncidentResponse
  | UpdateIncidentResponse
  | AddIncidentTodoResponse
