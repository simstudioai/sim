import type { ToolResponse } from '@/tools/types'

/** Credentials every Dynatrace Environment API v2 call needs. */
export interface DynatraceBaseParams {
  environmentUrl: string
  apiToken: string
}

/** Short representation of a monitored entity (`EntityStub`), flattened. */
export interface DynatraceEntityStub {
  id: string | null
  type: string | null
  name: string | null
}

/** Tag of a monitored entity (`METag`). */
export interface DynatraceTag {
  context: string | null
  key: string | null
  value: string | null
  stringRepresentation: string | null
}

/** Short representation of a management zone. */
export interface DynatraceManagementZone {
  id: string | null
  name: string | null
}

/** Short representation of an alerting profile (`AlertingProfileStub`). */
export interface DynatraceProblemFilter {
  id: string | null
  name: string | null
}

/** A comment on a problem. */
export interface DynatraceComment {
  id: string | null
  authorName: string | null
  content: string | null
  context: string | null
  createdAtTimestamp: number | null
}

/** A problem as returned by the Problems API v2. */
export interface DynatraceProblem {
  problemId: string | null
  displayId: string | null
  title: string | null
  status: string | null
  severityLevel: string | null
  impactLevel: string | null
  startTime: number | null
  endTime: number | null
  rootCauseEntity: DynatraceEntityStub | null
  affectedEntities: DynatraceEntityStub[]
  impactedEntities: DynatraceEntityStub[]
  managementZones: DynatraceManagementZone[]
  entityTags: DynatraceTag[]
  problemFilters: DynatraceProblemFilter[]
  linkedProblemInfo: { problemId: string | null; displayId: string | null } | null
  evidenceDetails: Record<string, unknown> | null
  impactAnalysis: Record<string, unknown> | null
  recentComments: Record<string, unknown> | null
}

/** A monitored entity as returned by the Monitored entities API v2. */
export interface DynatraceEntity {
  entityId: string | null
  type: string | null
  displayName: string | null
  firstSeenTms: number | null
  lastSeenTms: number | null
  properties: Record<string, unknown>
  tags: DynatraceTag[]
  managementZones: DynatraceManagementZone[]
  icon: Record<string, unknown> | null
  fromRelationships: Record<string, unknown>
  toRelationships: Record<string, unknown>
}

/** An entity type descriptor. */
export interface DynatraceEntityType {
  type: string | null
  displayName: string | null
  dimensionKey: string | null
  entityLimitExceeded: boolean | null
  properties: Array<{ id: string | null; displayName: string | null; type: string | null }>
  fromRelationships: Array<{ id: string | null; toTypes: string[] }>
  toRelationships: Array<{ id: string | null; fromTypes: string[] }>
}

/** An event as returned by the Events API v2. */
export interface DynatraceEvent {
  eventId: string | null
  eventType: string | null
  title: string | null
  startTime: number | null
  endTime: number | null
  status: string | null
  correlationId: string | null
  frequentEvent: boolean | null
  underMaintenance: boolean | null
  suppressAlert: boolean | null
  suppressProblem: boolean | null
  entityId: DynatraceEntityStub | null
  properties: Array<{ key: string | null; value: string | null }>
  managementZones: DynatraceManagementZone[]
  entityTags: DynatraceTag[]
}

/** One series of a metric query result. */
export interface DynatraceMetricSeries {
  dimensions: string[]
  dimensionMap: Record<string, string>
  timestamps: number[]
  values: Array<number | null>
}

/** One metric of a metric query result. */
export interface DynatraceMetricResult {
  metricId: string | null
  dataPointCountRatio: number | null
  dimensionCountRatio: number | null
  appliedOptionalFilters: unknown[]
  dql: Record<string, unknown> | null
  warnings: string[]
  data: DynatraceMetricSeries[]
}

/** A metric descriptor. */
export interface DynatraceMetricDescriptor {
  metricId: string | null
  displayName: string | null
  description: string | null
  unit: string | null
  unitDisplayFormat: string | null
  tags: string[]
  billable: boolean | null
  dduBillable: boolean | null
  created: number | null
  lastWritten: number | null
  aggregationTypes: string[]
  defaultAggregation: Record<string, unknown> | null
  dimensionDefinitions: Array<Record<string, unknown>>
  dimensionCardinalities: Array<Record<string, unknown>>
  transformations: string[]
  entityType: string[]
  minimumValue: number | null
  maximumValue: number | null
  rootCauseRelevant: boolean | null
  impactRelevant: boolean | null
  metricValueType: Record<string, unknown> | null
  latency: number | null
  metricSelector: string | null
  scalar: boolean | null
  resolutionInfSupported: boolean | null
  warnings: string[]
}

/** A service-level objective. */
export interface DynatraceSlo {
  id: string | null
  name: string | null
  description: string | null
  enabled: boolean | null
  target: number | null
  warning: number | null
  timeframe: string | null
  filter: string | null
  evaluationType: string | null
  evaluatedPercentage: number | null
  status: string | null
  error: string | null
  errorBudget: number | null
  errorBudgetBurnRate: Record<string, unknown> | null
  metricKey: string | null
  metricName: string | null
  metricExpression: string | null
  relatedOpenProblems: number | null
  relatedTotalProblems: number | null
}

/** A security problem (vulnerability). */
export interface DynatraceSecurityProblem {
  securityProblemId: string | null
  displayId: string | null
  status: string | null
  muted: boolean | null
  title: string | null
  technology: string | null
  vulnerabilityType: string | null
  packageName: string | null
  externalVulnerabilityId: string | null
  cveIds: string[]
  url: string | null
  firstSeenTimestamp: number | null
  lastUpdatedTimestamp: number | null
  lastOpenedTimestamp: number | null
  lastResolvedTimestamp: number | null
  riskAssessment: Record<string, unknown> | null
  managementZones: DynatraceManagementZone[]
  globalCounts: Record<string, unknown> | null
  codeLevelVulnerabilityDetails: Record<string, unknown> | null
}

/** A security problem with the detail-only fields the single-problem endpoint adds. */
export interface DynatraceSecurityProblemDetails extends DynatraceSecurityProblem {
  description: string | null
  remediationDescription: string | null
  muteStateChangeInProgress: boolean | null
  affectedEntities: string[]
  exposedEntities: string[]
  reachableDataAssets: string[]
  vulnerableComponents: Array<Record<string, unknown>>
  filteredCounts: Record<string, unknown> | null
  events: Array<Record<string, unknown>>
  entryPoints: Record<string, unknown> | null
  relatedEntities: Record<string, unknown> | null
  relatedAttacks: Record<string, unknown> | null
  relatedContainerImages: Record<string, unknown> | null
}

/** An audit log entry. */
export interface DynatraceAuditLog {
  logId: string | null
  eventType: string | null
  category: string | null
  entityId: string | null
  environmentId: string | null
  user: string | null
  userType: string | null
  userOrigin: string | null
  timestamp: number | null
  success: boolean | null
  message: string | null
  patch: Record<string, unknown> | null
  settingsSchemaId: string | null
  settingsScopeId: string | null
  settingsKey: string | null
  settingsObjectId: string | null
  settingsObjectSummary: string | null
  settingsScopeName: string | null
}

/** A log record returned by the Log Monitoring API v2 search endpoint. */
export interface DynatraceLogRecord {
  timestamp: number | null
  status: string | null
  content: string | null
  eventType: string | null
  additionalColumns: Record<string, unknown>
}

export interface DynatraceListProblemsParams extends DynatraceBaseParams {
  from?: string
  to?: string
  problemSelector?: string
  entitySelector?: string
  sort?: string
  fields?: string
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListProblemsResponse extends ToolResponse {
  output: {
    problems: DynatraceProblem[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
    warnings: string[]
  }
}

export interface DynatraceGetProblemParams extends DynatraceBaseParams {
  problemId: string
  fields?: string
}

export interface DynatraceGetProblemResponse extends ToolResponse {
  output: {
    problem: DynatraceProblem
  }
}

export interface DynatraceCloseProblemParams extends DynatraceBaseParams {
  problemId: string
  message: string
}

export interface DynatraceCloseProblemResponse extends ToolResponse {
  output: {
    problemId: string | null
    closeTimestamp: number | null
    closing: boolean | null
    comment: DynatraceComment | null
  }
}

export interface DynatraceListProblemCommentsParams extends DynatraceBaseParams {
  problemId: string
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListProblemCommentsResponse extends ToolResponse {
  output: {
    comments: DynatraceComment[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
  }
}

export interface DynatraceAddProblemCommentParams extends DynatraceBaseParams {
  problemId: string
  message: string
  context?: string
}

export interface DynatraceAddProblemCommentResponse extends ToolResponse {
  output: {
    problemId: string
    message: string
    context: string | null
  }
}

export interface DynatraceQueryMetricsParams extends DynatraceBaseParams {
  metricSelector: string
  from?: string
  to?: string
  resolution?: string
  entitySelector?: string
  mzSelector?: string
}

export interface DynatraceQueryMetricsResponse extends ToolResponse {
  output: {
    result: DynatraceMetricResult[]
    resolution: string | null
    totalCount: number | null
    nextPageKey: string | null
    warnings: string[]
  }
}

export interface DynatraceListMetricsParams extends DynatraceBaseParams {
  metricSelector?: string
  text?: string
  fields?: string
  writtenSince?: string
  writtenSinceMode?: string
  metadataSelector?: string
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListMetricsResponse extends ToolResponse {
  output: {
    metrics: DynatraceMetricDescriptor[]
    totalCount: number | null
    nextPageKey: string | null
    warnings: string[]
  }
}

export interface DynatraceGetMetricParams extends DynatraceBaseParams {
  metricKey: string
}

export interface DynatraceGetMetricResponse extends ToolResponse {
  output: {
    metric: DynatraceMetricDescriptor
  }
}

export interface DynatraceIngestMetricsParams extends DynatraceBaseParams {
  payload: string
}

export interface DynatraceIngestMetricsResponse extends ToolResponse {
  output: {
    linesOk: number | null
    linesInvalid: number | null
    ingestError: Record<string, unknown> | null
    warnings: Record<string, unknown> | null
  }
}

export interface DynatraceListEntitiesParams extends DynatraceBaseParams {
  entitySelector: string
  from?: string
  to?: string
  fields?: string
  sort?: string
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListEntitiesResponse extends ToolResponse {
  output: {
    entities: DynatraceEntity[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
  }
}

export interface DynatraceGetEntityParams extends DynatraceBaseParams {
  entityId: string
  from?: string
  to?: string
  fields?: string
}

export interface DynatraceGetEntityResponse extends ToolResponse {
  output: {
    entity: DynatraceEntity
  }
}

export interface DynatraceListEntityTypesParams extends DynatraceBaseParams {
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListEntityTypesResponse extends ToolResponse {
  output: {
    types: DynatraceEntityType[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
  }
}

export interface DynatraceListEventsParams extends DynatraceBaseParams {
  from?: string
  to?: string
  eventSelector?: string
  entitySelector?: string
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListEventsResponse extends ToolResponse {
  output: {
    events: DynatraceEvent[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
    warnings: string[]
  }
}

export interface DynatraceGetEventParams extends DynatraceBaseParams {
  eventId: string
}

export interface DynatraceGetEventResponse extends ToolResponse {
  output: {
    event: DynatraceEvent
  }
}

export interface DynatraceIngestEventParams extends DynatraceBaseParams {
  eventType: string
  title: string
  entitySelector?: string
  startTime?: number
  endTime?: number
  /**
   * Dynatrace's event timeout in minutes. Deliberately not named `timeout` —
   * the tool transport reserves that param name for the HTTP request timeout.
   */
  eventTimeout?: number
  /** Accepts a parsed object or a JSON string; normalized by `parseJsonParam`. */
  properties?: Record<string, string> | string
}

export interface DynatraceIngestEventResponse extends ToolResponse {
  output: {
    reportCount: number | null
    eventIngestResults: Array<{ correlationId: string | null; status: string | null }>
  }
}

export interface DynatraceSearchLogsParams extends DynatraceBaseParams {
  query?: string
  from?: string
  to?: string
  sort?: string
  limit?: number
  nextSliceKey?: string
}

export interface DynatraceSearchLogsResponse extends ToolResponse {
  output: {
    results: DynatraceLogRecord[]
    sliceSize: number | null
    nextSliceKey: string | null
    warnings: string | null
  }
}

export interface DynatraceIngestLogsParams extends DynatraceBaseParams {
  /** Accepts a parsed object/array or a JSON string; normalized by `parseJsonParam`. */
  logs: Record<string, unknown> | Array<Record<string, unknown>> | string
}

export interface DynatraceIngestLogsResponse extends ToolResponse {
  output: {
    accepted: boolean
    statusCode: number
    details: Record<string, unknown> | null
  }
}

export interface DynatraceListSlosParams extends DynatraceBaseParams {
  sloSelector?: string
  from?: string
  to?: string
  timeFrame?: string
  sort?: string
  enabledSlos?: string
  evaluate?: boolean
  showGlobalSlos?: boolean
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListSlosResponse extends ToolResponse {
  output: {
    slos: DynatraceSlo[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
  }
}

export interface DynatraceGetSloParams extends DynatraceBaseParams {
  sloId: string
  from?: string
  to?: string
  timeFrame?: string
}

export interface DynatraceGetSloResponse extends ToolResponse {
  output: {
    slo: DynatraceSlo
  }
}

export interface DynatraceListSecurityProblemsParams extends DynatraceBaseParams {
  securityProblemSelector?: string
  from?: string
  to?: string
  fields?: string
  sort?: string
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListSecurityProblemsResponse extends ToolResponse {
  output: {
    securityProblems: DynatraceSecurityProblem[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
  }
}

export interface DynatraceGetSecurityProblemParams extends DynatraceBaseParams {
  securityProblemId: string
  fields?: string
  managementZoneFilter?: string
  from?: string
}

export interface DynatraceGetSecurityProblemResponse extends ToolResponse {
  output: {
    securityProblem: DynatraceSecurityProblemDetails
  }
}

export interface DynatraceGetAuditLogsParams extends DynatraceBaseParams {
  filter?: string
  from?: string
  to?: string
  sort?: string
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceGetAuditLogsResponse extends ToolResponse {
  output: {
    auditLogs: DynatraceAuditLog[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
  }
}

/** Union of every Dynatrace tool response, used as the block's response type. */
export type DynatraceResponse =
  | DynatraceListProblemsResponse
  | DynatraceGetProblemResponse
  | DynatraceCloseProblemResponse
  | DynatraceListProblemCommentsResponse
  | DynatraceAddProblemCommentResponse
  | DynatraceQueryMetricsResponse
  | DynatraceListMetricsResponse
  | DynatraceGetMetricResponse
  | DynatraceIngestMetricsResponse
  | DynatraceListEntitiesResponse
  | DynatraceGetEntityResponse
  | DynatraceListEntityTypesResponse
  | DynatraceListEventsResponse
  | DynatraceGetEventResponse
  | DynatraceIngestEventResponse
  | DynatraceSearchLogsResponse
  | DynatraceIngestLogsResponse
  | DynatraceListSlosResponse
  | DynatraceGetSloResponse
  | DynatraceListSecurityProblemsResponse
  | DynatraceGetSecurityProblemResponse
  | DynatraceGetAuditLogsResponse
