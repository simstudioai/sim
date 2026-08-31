// Common types for Datadog tools
import type { ToolResponse } from '@/tools/types'

// Datadog Site/Region options
/**
 * Regional sites Datadog serves the API from, per the `site` server variable enum.
 *
 * A runtime array rather than a bare type union: `site` is interpolated into the
 * request host, and a type union is erased at runtime, so it cannot keep a value
 * that arrived from a stored workflow out of the URL. {@link DatadogSite} is
 * derived from this list so the two can never drift.
 */
export const DATADOG_SITES = [
  'datadoghq.com',
  'us3.datadoghq.com',
  'us5.datadoghq.com',
  'datadoghq.eu',
  'ap1.datadoghq.com',
  'ap2.datadoghq.com',
  'uk1.datadoghq.com',
  'ddog-gov.com',
  'us2.ddog-gov.com',
] as const

export type DatadogSite = (typeof DATADOG_SITES)[number]

// Base parameters for write-only operations (only need API key)
interface DatadogWriteOnlyParams {
  apiKey: string
  site?: DatadogSite
}

// Base parameters for read/manage operations (need both API key and Application key)
interface DatadogBaseParams extends DatadogWriteOnlyParams {
  applicationKey: string
}

/**
 * A JSON:API resource object as returned by Datadog v2 endpoints. v1 endpoints
 * return flat objects instead, so this wrapper is only used for v2 payloads.
 */
export interface DatadogV2Resource<TAttributes> {
  id?: string
  type?: string
  attributes?: TAttributes
}

// METRICS TYPES

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
  /** Required by Datadog when `type` is `rate` or `count`, in seconds. */
  interval?: number
  sourceTypeName?: string
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

/**
 * One series of a v1 metrics query response (`MetricsQueryMetadata`). Datadog
 * returns the metric under `metric` for plain queries and `expression` for
 * arithmetic/function queries.
 */
export interface MetricsQuerySeries {
  metric?: string
  expression?: string
  tag_set?: string[]
  pointlist?: [number, number][]
}

interface TimeseriesResult {
  metric: string
  tags: string[]
  points: TimeseriesPoint[]
}

interface QueryTimeseriesOutput {
  series: TimeseriesResult[]
  status?: string
}

export interface QueryTimeseriesResponse extends ToolResponse {
  output: QueryTimeseriesOutput
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

export interface EventData {
  id?: number
  title?: string
  text?: string
  date_happened?: number
  priority?: string
  alert_type?: string
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

export interface MonitorData {
  id?: number
  name?: string
  type?: string
  query?: string
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

/**
 * Mute/unmute monitor are served by `POST /api/v1/monitor/{monitor_id}/mute` and
 * `/unmute`. They are absent from the datadog-api-client-go generator spec but are
 * still implemented by Datadog's official Python client (`datadogpy` Monitor.mute /
 * Monitor.unmute), which is the source for these request shapes.
 */
export interface MuteMonitorParams extends DatadogBaseParams {
  monitorId: string
  scope?: string
  end?: number
}

export interface UnmuteMonitorParams extends DatadogBaseParams {
  monitorId: string
  scope?: string
  allScopes?: boolean
}

interface MonitorMuteOutput {
  success: boolean
  monitorId?: number
  name?: string
  overallState?: string
}

export interface MuteMonitorResponse extends ToolResponse {
  output: MonitorMuteOutput
}

export interface UnmuteMonitorResponse extends ToolResponse {
  output: MonitorMuteOutput
}

// LOGS TYPES

/**
 * One entry for the Datadog log intake. Datadog treats any key beyond the reserved
 * ones as a structured log attribute, so extra properties are carried through.
 */
export interface LogEntry {
  ddsource?: string
  ddtags?: string
  hostname?: string
  message: string
  service?: string
  [attribute: string]: unknown
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
  cursor?: string
  sort?: 'timestamp' | '-timestamp'
  indexes?: string // Comma-separated index names
}

/** Attributes of a v2 log event (`LogAttributes` in the Datadog v2 schema). */
export interface LogAttributes {
  timestamp?: string
  host?: string
  service?: string
  message?: string
  status?: string
  attributes?: Record<string, unknown>
  tags?: string[]
}

interface LogData {
  id?: string
  content: LogAttributes
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
}

/**
 * Attributes of a v2 downtime (`DowntimeResponseAttributes`). `scope` is a single
 * query string, and every timestamp is an ISO-8601 string rather than epoch seconds.
 */
export interface DowntimeAttributes {
  scope?: string
  message?: string
  schedule?: { start?: string | null; end?: string | null; timezone?: string }
  status?: string
  display_timezone?: string | null
  created?: string
  modified?: string
  canceled?: string | null
}

interface DowntimeData {
  id?: string
  scope: string[]
  message?: string
  start?: number
  end?: number
  timezone?: string
  created?: number
  modified?: number
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
  limit?: number
  offset?: number
}

interface ListDowntimesOutput {
  downtimes: DowntimeData[]
  totalCount?: number
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

/**
 * `PUT /api/v1/slo/{slo_id}` is a full replacement that Sim fills from the stored SLO,
 * so every identifying field is optional here: an omitted `type` means "keep the stored
 * type" rather than "rewrite this SLO as a metric SLO".
 */
export interface UpdateSloParams extends Omit<CreateSloParams, 'name' | 'type' | 'thresholds'> {
  sloId: string
  name?: string
  type?: SloType
  thresholds?: string
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

export interface SyntheticsTestData {
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

export interface GetBrowserSyntheticsResultsParams extends DatadogBaseParams {
  publicId: string
  fromTs?: number
  toTs?: number
  probeDc?: string
}

/**
 * Result of a single browser test run (`SyntheticsBrowserTestResultShortResult`).
 * Unlike the API-test result shape, these fields are camelCase.
 */
interface SyntheticsBrowserResultData {
  result_id?: string
  check_time?: number
  probe_dc?: string
  status?: number
  result?: {
    duration?: number
    errorCount?: number
    stepCountCompleted?: number
    stepCountTotal?: number
    device?: Record<string, unknown>
  }
}

interface GetBrowserSyntheticsResultsOutput {
  results: SyntheticsBrowserResultData[]
  lastTimestampFetched?: number
}

export interface GetBrowserSyntheticsResultsResponse extends ToolResponse {
  output: GetBrowserSyntheticsResultsOutput
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
  status?: SyntheticsTestPauseStatus
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

/** Attributes of a Cloud SIEM signal (`SecurityMonitoringSignalAttributes`). */
export interface SecuritySignalAttributes {
  message?: string
  timestamp?: string
  tags?: string[]
  custom?: Record<string, unknown>
}

interface SecuritySignalData {
  id?: string
  type?: string
  attributes: SecuritySignalAttributes
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

export interface SecurityRuleData {
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

/** Attributes of an indexed APM span (`SpansAttributes`). */
export interface SpanAttributes {
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

interface SpanData {
  id?: string
  type?: string
  attributes: SpanAttributes
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

/**
 * Attributes of a service definition (`ServiceDefinitionDataAttributes`). `schema`
 * is a union of the v2, v2.1 and v2.2 schema versions, so it stays opaque.
 */
export interface ServiceDefinitionAttributes {
  schema?: unknown
  meta?: Record<string, unknown>
}

interface ServiceDefinitionData {
  id?: string
  type?: string
  schema?: unknown
  meta?: Record<string, unknown>
}

interface ListServicesOutput {
  services: ServiceDefinitionData[]
}

export interface ListServicesResponse extends ToolResponse {
  output: ListServicesOutput
}

// INCIDENTS TYPES

export type IncidentSeverity = 'UNKNOWN' | 'SEV-0' | 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4' | 'SEV-5'

interface IncidentFieldValue {
  type?: string
  value?: string | string[] | null
}

/** Attributes of an incident (`IncidentResponseAttributes`). */
export interface IncidentAttributes {
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

interface IncidentData {
  id?: string
  type?: string
  attributes: IncidentAttributes
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
  | CreateEventResponse
  | CreateMonitorResponse
  | GetMonitorResponse
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
  | GetBrowserSyntheticsResultsResponse
  | TriggerSyntheticsTestsResponse
  | UpdateSyntheticsStatusResponse
  | ListSecuritySignalsResponse
  | GetSecuritySignalResponse
  | UpdateSecuritySignalStateResponse
  | UpdateSecuritySignalAssigneeResponse
  | ListSecurityRulesResponse
  | SearchSpansResponse
  | ListServicesResponse
  | ListIncidentsResponse
  | GetIncidentResponse
  | CreateIncidentResponse
  | UpdateIncidentResponse
  | AddIncidentTodoResponse
