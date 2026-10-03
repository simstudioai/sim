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

/** Outcome of one entry in a batch mute/unmute call. */
export interface DynatraceMuteSummaryEntry {
  securityProblemId: string | null
  muteStateChangeTriggered: boolean | null
  reason: string | null
}

/** A remediation item of a third-party vulnerability. */
export interface DynatraceRemediationItem {
  id: string | null
  name: string | null
  entityIds: string[]
  firstAffectedTimestamp: number | null
  resolvedTimestamp: number | null
  vulnerabilityState: string | null
  assessment: Record<string, unknown> | null
  muteState: Record<string, unknown> | null
  remediationProgress: Record<string, unknown> | null
  trackingLink: Record<string, unknown> | null
  vulnerableComponents: Array<Record<string, unknown>>
}

/** An Application Security attack. */
export interface DynatraceAttack {
  attackId: string | null
  displayId: string | null
  displayName: string | null
  attackType: string | null
  state: string | null
  technology: string | null
  timestamp: number | null
  attackTarget: Record<string, unknown> | null
  attacker: Record<string, unknown> | null
  affectedEntities: Record<string, unknown> | null
  entrypoint: Record<string, unknown> | null
  request: Record<string, unknown> | null
  securityProblem: Record<string, unknown> | null
  vulnerability: Record<string, unknown> | null
  managementZones: DynatraceManagementZone[]
}

/** A settings schema descriptor. */
export interface DynatraceSettingsSchema {
  schemaId: string | null
  displayName: string | null
  latestSchemaVersion: string | null
  maturity: string | null
  multiObject: boolean | null
  ordered: boolean | null
  ownerBasedAccessControl: boolean | null
}

/** A settings object. */
export interface DynatraceSettingsObject {
  objectId: string | null
  schemaId: string | null
  schemaVersion: string | null
  scope: string | null
  value: Record<string, unknown> | null
  author: string | null
  created: number | null
  modified: number | null
  updateToken: string | null
  externalId: string | null
  summary: string | null
  searchSummary: string | null
}

/** Result of a settings object write. */
export interface DynatraceSettingsWriteResult {
  code: number | null
  objectId: string | null
  writeError: Record<string, unknown> | null
  invalidValue: unknown
}

/** Short representation of a synthetic monitor. */
export interface DynatraceSyntheticMonitor {
  entityId: string | null
  name: string | null
  type: string | null
  enabled: boolean | null
}

export interface DynatraceMuteSecurityProblemParams extends DynatraceBaseParams {
  securityProblemId: string
  reason: string
  comment?: string
}

export interface DynatraceMuteSecurityProblemResponse extends ToolResponse {
  output: {
    securityProblemId: string
    reason: string | null
    comment: string | null
    alreadyInState: boolean
  }
}

export interface DynatraceMuteSecurityProblemsParams extends DynatraceBaseParams {
  securityProblemIds: string | string[]
  reason: string
  comment?: string
}

export interface DynatraceMuteSecurityProblemsResponse extends ToolResponse {
  output: {
    summary: DynatraceMuteSummaryEntry[]
    changedCount: number
  }
}

export interface DynatraceListRemediationItemsParams extends DynatraceBaseParams {
  securityProblemId: string
  remediationItemSelector?: string
}

export interface DynatraceListRemediationItemsResponse extends ToolResponse {
  output: {
    remediationItems: DynatraceRemediationItem[]
  }
}

export interface DynatraceListAttacksParams extends DynatraceBaseParams {
  attackSelector?: string
  from?: string
  to?: string
  fields?: string
  sort?: string
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListAttacksResponse extends ToolResponse {
  output: {
    attacks: DynatraceAttack[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
  }
}

export interface DynatraceGetAttackParams extends DynatraceBaseParams {
  attackId: string
  fields?: string
}

export interface DynatraceGetAttackResponse extends ToolResponse {
  output: {
    attack: DynatraceAttack
  }
}

export interface DynatraceListTagsParams extends DynatraceBaseParams {
  entitySelector: string
  from?: string
  to?: string
}

export interface DynatraceListTagsResponse extends ToolResponse {
  output: {
    tags: DynatraceTag[]
    totalCount: number | null
  }
}

export interface DynatraceAddTagsParams extends DynatraceBaseParams {
  entitySelector: string
  tags: Array<{ key: string; value?: string }> | string
  from?: string
  to?: string
}

export interface DynatraceAddTagsResponse extends ToolResponse {
  output: {
    appliedTags: DynatraceTag[]
    matchedEntitiesCount: number | null
  }
}

export interface DynatraceDeleteTagParams extends DynatraceBaseParams {
  entitySelector: string
  key: string
  value?: string
  deleteAllWithKey?: boolean
  from?: string
  to?: string
}

export interface DynatraceDeleteTagResponse extends ToolResponse {
  output: {
    matchedEntitiesCount: number | null
  }
}

export interface DynatraceListSettingsSchemasParams extends DynatraceBaseParams {
  fields?: string
}

export interface DynatraceListSettingsSchemasResponse extends ToolResponse {
  output: {
    schemas: DynatraceSettingsSchema[]
    totalCount: number | null
  }
}

export interface DynatraceListSettingsObjectsParams extends DynatraceBaseParams {
  schemaIds?: string
  scopes?: string
  externalIds?: string
  fields?: string
  filter?: string
  sort?: string
  pageSize?: number
  nextPageKey?: string
}

export interface DynatraceListSettingsObjectsResponse extends ToolResponse {
  output: {
    items: DynatraceSettingsObject[]
    totalCount: number | null
    pageSize: number | null
    nextPageKey: string | null
  }
}

export interface DynatraceGetSettingsObjectParams extends DynatraceBaseParams {
  objectId: string
}

export interface DynatraceGetSettingsObjectResponse extends ToolResponse {
  output: {
    object: DynatraceSettingsObject
  }
}

export interface DynatraceCreateSettingsObjectParams extends DynatraceBaseParams {
  schemaId: string
  scope: string
  value: Record<string, unknown> | string
  schemaVersion?: string
  externalId?: string
  validateOnly?: boolean
}

export interface DynatraceCreateSettingsObjectResponse extends ToolResponse {
  output: {
    results: DynatraceSettingsWriteResult[]
    objectId: string | null
  }
}

export interface DynatraceUpdateSettingsObjectParams extends DynatraceBaseParams {
  objectId: string
  value: Record<string, unknown> | string
  schemaVersion?: string
  updateToken?: string
  validateOnly?: boolean
}

export interface DynatraceUpdateSettingsObjectResponse extends ToolResponse {
  output: {
    objectId: string | null
    code: number | null
  }
}

export interface DynatraceDeleteSettingsObjectParams extends DynatraceBaseParams {
  objectId: string
  updateToken?: string
}

export interface DynatraceDeleteSettingsObjectResponse extends ToolResponse {
  output: {
    objectId: string
    deleted: boolean
  }
}

export interface DynatraceListSyntheticMonitorsParams extends DynatraceBaseParams {
  type?: string
  enabled?: boolean
  location?: string
  tag?: string
  managementZone?: number
}

export interface DynatraceListSyntheticMonitorsResponse extends ToolResponse {
  output: {
    monitors: DynatraceSyntheticMonitor[]
  }
}

export interface DynatraceExecuteSyntheticMonitorsParams extends DynatraceBaseParams {
  monitors: Array<Record<string, unknown>> | string
  processingMode?: string
  failOnPerformanceIssue?: boolean
  stopOnProblem?: boolean
  takeScreenshotsOnSuccess?: boolean
  metadata?: Record<string, string> | string
}

export interface DynatraceExecuteSyntheticMonitorsResponse extends ToolResponse {
  output: {
    batchId: string | null
    triggeredCount: number | null
    triggeringProblemsCount: number | null
    triggered: Array<Record<string, unknown>>
    triggeringProblemsDetails: Array<Record<string, unknown>>
  }
}

export interface DynatraceGetSyntheticBatchParams extends DynatraceBaseParams {
  batchId: string
}

export interface DynatraceGetSyntheticBatchResponse extends ToolResponse {
  output: {
    batchId: string | null
    batchStatus: string | null
    executedCount: number | null
    failedCount: number | null
    failedToExecuteCount: number | null
    triggeredCount: number | null
    triggeringProblemsCount: number | null
    failedExecutions: Array<Record<string, unknown>>
    failedToExecute: Array<Record<string, unknown>>
    triggeringProblems: Array<Record<string, unknown>>
    metadata: Record<string, unknown>
    userId: string | null
  }
}

export interface DynatraceGetProblemCommentParams extends DynatraceBaseParams {
  problemId: string
  commentId: string
}

export interface DynatraceGetProblemCommentResponse extends ToolResponse {
  output: {
    comment: DynatraceComment
  }
}

export interface DynatraceUpdateProblemCommentParams extends DynatraceBaseParams {
  problemId: string
  commentId: string
  message: string
  context?: string
}

export interface DynatraceUpdateProblemCommentResponse extends ToolResponse {
  output: {
    problemId: string
    commentId: string
    message: string
    context: string | null
  }
}

export interface DynatraceDeleteProblemCommentParams extends DynatraceBaseParams {
  problemId: string
  commentId: string
}

export interface DynatraceDeleteProblemCommentResponse extends ToolResponse {
  output: {
    problemId: string
    commentId: string
    deleted: boolean
  }
}

/** Fields shared by the SLO create and update payloads. */
export interface DynatraceSloWriteFields {
  name: string
  target: number
  warning: number
  timeframe: string
  evaluationType: string
  description?: string
  enabled?: boolean
  filter?: string
  metricExpression?: string
  metricName?: string
  burnRateVisualizationEnabled?: boolean
  fastBurnThreshold?: number
}

export interface DynatraceCreateSloParams extends DynatraceBaseParams, DynatraceSloWriteFields {}

export interface DynatraceCreateSloResponse extends ToolResponse {
  output: {
    sloId: string | null
    name: string
  }
}

export interface DynatraceUpdateSloParams extends DynatraceBaseParams, DynatraceSloWriteFields {
  sloId: string
}

export interface DynatraceUpdateSloResponse extends ToolResponse {
  output: {
    sloId: string
    name: string
  }
}

export interface DynatraceDeleteSloParams extends DynatraceBaseParams {
  sloId: string
}

export interface DynatraceDeleteSloResponse extends ToolResponse {
  output: {
    sloId: string
    deleted: boolean
  }
}

/** Union of every Dynatrace tool response, used as the block's response type. */
export type DynatraceResponse =
  | DynatraceAddProblemCommentResponse
  | DynatraceAddTagsResponse
  | DynatraceCloseProblemResponse
  | DynatraceCreateSettingsObjectResponse
  | DynatraceCreateSloResponse
  | DynatraceDeleteProblemCommentResponse
  | DynatraceDeleteSettingsObjectResponse
  | DynatraceDeleteSloResponse
  | DynatraceDeleteTagResponse
  | DynatraceExecuteSyntheticMonitorsResponse
  | DynatraceGetAttackResponse
  | DynatraceGetAuditLogsResponse
  | DynatraceGetEntityResponse
  | DynatraceGetEventResponse
  | DynatraceGetMetricResponse
  | DynatraceGetProblemCommentResponse
  | DynatraceGetProblemResponse
  | DynatraceGetSecurityProblemResponse
  | DynatraceGetSettingsObjectResponse
  | DynatraceGetSloResponse
  | DynatraceGetSyntheticBatchResponse
  | DynatraceIngestEventResponse
  | DynatraceIngestLogsResponse
  | DynatraceIngestMetricsResponse
  | DynatraceListAttacksResponse
  | DynatraceListEntitiesResponse
  | DynatraceListEntityTypesResponse
  | DynatraceListEventsResponse
  | DynatraceListMetricsResponse
  | DynatraceListProblemCommentsResponse
  | DynatraceListProblemsResponse
  | DynatraceListRemediationItemsResponse
  | DynatraceListSecurityProblemsResponse
  | DynatraceListSettingsObjectsResponse
  | DynatraceListSettingsSchemasResponse
  | DynatraceListSlosResponse
  | DynatraceListSyntheticMonitorsResponse
  | DynatraceListTagsResponse
  | DynatraceMuteSecurityProblemResponse
  | DynatraceMuteSecurityProblemsResponse
  | DynatraceQueryMetricsResponse
  | DynatraceSearchLogsResponse
  | DynatraceUpdateProblemCommentResponse
  | DynatraceUpdateSettingsObjectResponse
  | DynatraceUpdateSloResponse
