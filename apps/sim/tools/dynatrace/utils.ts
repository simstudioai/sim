import { toRecord, toRecordOrNull } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type {
  DynatraceAttack,
  DynatraceAuditLog,
  DynatraceComment,
  DynatraceEntity,
  DynatraceEntityStub,
  DynatraceEntityType,
  DynatraceEvent,
  DynatraceLogRecord,
  DynatraceManagementZone,
  DynatraceMetricDescriptor,
  DynatraceMetricResult,
  DynatraceMuteSummaryEntry,
  DynatraceProblem,
  DynatraceProblemFilter,
  DynatraceRemediationItem,
  DynatraceSecurityProblem,
  DynatraceSecurityProblemDetails,
  DynatraceSettingsObject,
  DynatraceSettingsSchema,
  DynatraceSettingsWriteResult,
  DynatraceSlo,
  DynatraceSloWriteFields,
  DynatraceSyntheticMonitor,
  DynatraceTag,
} from '@/tools/dynatrace/types'

type QueryScalar = string | number | boolean | undefined | null
type QueryValue = QueryScalar | QueryScalar[]

/** Strips a trailing slash and a trailing `/api/v1` or `/api/v2` from the environment URL. */
function normalizeEnvironmentUrl(environmentUrl: string): string {
  return environmentUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v[12]$/, '')
}

function buildUrl(
  environmentUrl: string,
  apiPrefix: string,
  path: string,
  query?: Record<string, QueryValue>
): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(query ?? {})) {
    // Repeatable params (e.g. Synthetic's `tag`) append once per entry.
    const values = Array.isArray(value) ? value : [value]
    for (const entry of values) {
      if (entry === undefined || entry === null || entry === '') continue
      search.append(key, String(entry))
    }
  }

  const queryString = search.toString()
  return `${normalizeEnvironmentUrl(environmentUrl)}${apiPrefix}${path}${
    queryString ? `?${queryString}` : ''
  }`
}

/**
 * Builds an absolute Environment API v2 URL. Tolerates a trailing slash and a
 * trailing `/api/v2` segment on the user-supplied environment URL, and omits
 * query parameters that are unset or empty.
 */
export function buildDynatraceUrl(
  environmentUrl: string,
  path: string,
  query?: Record<string, QueryValue>
): string {
  return buildUrl(environmentUrl, '/api/v2', path, query)
}

/**
 * Builds an absolute Environment API **v1** URL. Only the Synthetic monitors
 * endpoints still live on v1 — everything else in this integration is v2.
 */
export function buildDynatraceV1Url(
  environmentUrl: string,
  path: string,
  query?: Record<string, QueryValue>
): string {
  return buildUrl(environmentUrl, '/api/v1', path, query)
}

/**
 * Encodes a metric key for a URL path. In Dynatrace a `:` is structural — it
 * separates the metric key from its transformation operators
 * (`builtin:host.cpu.usage:avg`) — so each colon-delimited part is encoded and
 * the separators are rejoined verbatim, matching the unencoded form the API
 * reference uses in its own examples.
 */
export function encodeDynatracePathSegment(value: string): string {
  return value
    .trim()
    .split(':')
    .map((part) => encodeURIComponent(part))
    .join(':')
}

/** Encodes an identifier for use in a URL path, tolerating copy-pasted whitespace. */
export function encodeDynatraceId(value: string): string {
  return encodeURIComponent(value.trim())
}

/**
 * Normalizes a `json` param that may arrive already parsed (from a block input or
 * an upstream block reference) or as a JSON string (from an LLM tool call or a
 * long-input field). Returns `undefined` when there is nothing to send, so callers
 * can omit the field rather than transmit `"undefined"`.
 */
export function parseJsonParam(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(`Expected valid JSON but received: ${truncate(trimmed, 100)}`)
  }
}

/** Builds the Dynatrace authorization headers. */
export function dynatraceHeaders(
  apiToken: string,
  contentType = 'application/json'
): Record<string, string> {
  return {
    Authorization: `Api-Token ${apiToken.trim()}`,
    'Content-Type': contentType,
    Accept: 'application/json',
  }
}

/**
 * Reads a JSON response body, tolerating the empty bodies Dynatrace returns for
 * 201 (comment created) and 204 (logs accepted).
 *
 * A non-empty body that will not parse is an error, not an empty result — a
 * gateway HTML page or a truncated payload would otherwise map to `{}` and
 * surface as "no results", which is indistinguishable from a genuinely empty
 * environment.
 */
export async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(
      `Dynatrace returned a non-JSON body (HTTP ${response.status}): ${truncate(text.trim(), 200)}`
    )
  }
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : []
}

/** Flattens an `EntityStub` (`{ entityId: { id, type }, name }`) into a single object. */
export function mapEntityStub(stub: unknown): DynatraceEntityStub | null {
  const record = toRecordOrNull(stub)
  if (!record) return null
  const entityId = toRecord(record.entityId)
  return {
    id: (entityId.id as string) ?? null,
    type: (entityId.type as string) ?? null,
    name: (record.name as string) ?? null,
  }
}

function mapEntityStubs(value: unknown): DynatraceEntityStub[] {
  return toRecordArray(value)
    .map(mapEntityStub)
    .filter((stub): stub is DynatraceEntityStub => stub !== null)
}

/** Maps a `METag` list. */
export function mapTags(value: unknown): DynatraceTag[] {
  return toRecordArray(value).map((tag) => ({
    context: (tag.context as string) ?? null,
    key: (tag.key as string) ?? null,
    value: (tag.value as string) ?? null,
    stringRepresentation: (tag.stringRepresentation as string) ?? null,
  }))
}

/** Maps a management zone list. */
export function mapManagementZones(value: unknown): DynatraceManagementZone[] {
  return toRecordArray(value).map((zone) => ({
    id: (zone.id as string) ?? null,
    name: (zone.name as string) ?? null,
  }))
}

function mapProblemFilters(value: unknown): DynatraceProblemFilter[] {
  return toRecordArray(value).map((filter) => ({
    id: (filter.id as string) ?? null,
    name: (filter.name as string) ?? null,
  }))
}

/** Maps a single problem comment. */
export function mapComment(value: unknown): DynatraceComment | null {
  const comment = toRecordOrNull(value)
  if (!comment) return null
  return {
    id: (comment.id as string) ?? null,
    authorName: (comment.authorName as string) ?? null,
    content: (comment.content as string) ?? null,
    context: (comment.context as string) ?? null,
    createdAtTimestamp: (comment.createdAtTimestamp as number) ?? null,
  }
}

/** Maps a problem from the Problems API v2. */
export function mapProblem(value: Record<string, unknown>): DynatraceProblem {
  const linkedProblem = toRecordOrNull(value.linkedProblemInfo)
  return {
    problemId: (value.problemId as string) ?? null,
    displayId: (value.displayId as string) ?? null,
    title: (value.title as string) ?? null,
    status: (value.status as string) ?? null,
    severityLevel: (value.severityLevel as string) ?? null,
    impactLevel: (value.impactLevel as string) ?? null,
    startTime: (value.startTime as number) ?? null,
    endTime: (value.endTime as number) ?? null,
    rootCauseEntity: mapEntityStub(value.rootCauseEntity),
    affectedEntities: mapEntityStubs(value.affectedEntities),
    impactedEntities: mapEntityStubs(value.impactedEntities),
    managementZones: mapManagementZones(value.managementZones),
    entityTags: mapTags(value.entityTags),
    problemFilters: mapProblemFilters(value.problemFilters),
    linkedProblemInfo: linkedProblem
      ? {
          problemId: (linkedProblem.problemId as string) ?? null,
          displayId: (linkedProblem.displayId as string) ?? null,
        }
      : null,
    evidenceDetails: toRecordOrNull(value.evidenceDetails),
    impactAnalysis: toRecordOrNull(value.impactAnalysis),
    recentComments: toRecordOrNull(value.recentComments),
  }
}

/** Maps a monitored entity. */
export function mapEntity(value: Record<string, unknown>): DynatraceEntity {
  return {
    entityId: (value.entityId as string) ?? null,
    type: (value.type as string) ?? null,
    displayName: (value.displayName as string) ?? null,
    firstSeenTms: (value.firstSeenTms as number) ?? null,
    lastSeenTms: (value.lastSeenTms as number) ?? null,
    properties: toRecord(value.properties),
    tags: mapTags(value.tags),
    managementZones: mapManagementZones(value.managementZones),
    icon: toRecordOrNull(value.icon),
    fromRelationships: toRecord(value.fromRelationships),
    toRelationships: toRecord(value.toRelationships),
  }
}

/** Maps an entity type descriptor. */
export function mapEntityType(value: Record<string, unknown>): DynatraceEntityType {
  return {
    type: (value.type as string) ?? null,
    displayName: (value.displayName as string) ?? null,
    dimensionKey: (value.dimensionKey as string) ?? null,
    entityLimitExceeded: (value.entityLimitExceeded as boolean) ?? null,
    properties: toRecordArray(value.properties).map((property) => ({
      id: (property.id as string) ?? null,
      displayName: (property.displayName as string) ?? null,
      type: (property.type as string) ?? null,
    })),
    fromRelationships: toRecordArray(value.fromRelationships).map((relationship) => ({
      id: (relationship.id as string) ?? null,
      toTypes: toStringArray(relationship.toTypes),
    })),
    toRelationships: toRecordArray(value.toRelationships).map((relationship) => ({
      id: (relationship.id as string) ?? null,
      fromTypes: toStringArray(relationship.fromTypes),
    })),
  }
}

/** Maps an event from the Events API v2. */
export function mapEvent(value: Record<string, unknown>): DynatraceEvent {
  return {
    eventId: (value.eventId as string) ?? null,
    eventType: (value.eventType as string) ?? null,
    title: (value.title as string) ?? null,
    startTime: (value.startTime as number) ?? null,
    endTime: (value.endTime as number) ?? null,
    status: (value.status as string) ?? null,
    correlationId: (value.correlationId as string) ?? null,
    frequentEvent: (value.frequentEvent as boolean) ?? null,
    underMaintenance: (value.underMaintenance as boolean) ?? null,
    suppressAlert: (value.suppressAlert as boolean) ?? null,
    suppressProblem: (value.suppressProblem as boolean) ?? null,
    entityId: mapEntityStub(value.entityId),
    properties: toRecordArray(value.properties).map((property) => ({
      key: (property.key as string) ?? null,
      value: (property.value as string) ?? null,
    })),
    managementZones: mapManagementZones(value.managementZones),
    entityTags: mapTags(value.entityTags),
  }
}

/** Maps one metric of a `/metrics/query` result. */
export function mapMetricResult(value: Record<string, unknown>): DynatraceMetricResult {
  return {
    metricId: (value.metricId as string) ?? null,
    dataPointCountRatio: (value.dataPointCountRatio as number) ?? null,
    dimensionCountRatio: (value.dimensionCountRatio as number) ?? null,
    appliedOptionalFilters: Array.isArray(value.appliedOptionalFilters)
      ? value.appliedOptionalFilters
      : [],
    dql: toRecordOrNull(value.dql),
    warnings: toStringArray(value.warnings),
    data: toRecordArray(value.data).map((series) => ({
      dimensions: toStringArray(series.dimensions),
      dimensionMap: toRecord(series.dimensionMap) as Record<string, string>,
      timestamps: Array.isArray(series.timestamps) ? (series.timestamps as number[]) : [],
      values: Array.isArray(series.values) ? (series.values as Array<number | null>) : [],
    })),
  }
}

/** Maps a metric descriptor. */
export function mapMetricDescriptor(value: Record<string, unknown>): DynatraceMetricDescriptor {
  return {
    metricId: (value.metricId as string) ?? null,
    displayName: (value.displayName as string) ?? null,
    description: (value.description as string) ?? null,
    unit: (value.unit as string) ?? null,
    unitDisplayFormat: (value.unitDisplayFormat as string) ?? null,
    tags: toStringArray(value.tags),
    billable: (value.billable as boolean) ?? null,
    dduBillable: (value.dduBillable as boolean) ?? null,
    created: (value.created as number) ?? null,
    lastWritten: (value.lastWritten as number) ?? null,
    aggregationTypes: toStringArray(value.aggregationTypes),
    defaultAggregation: toRecordOrNull(value.defaultAggregation),
    dimensionDefinitions: toRecordArray(value.dimensionDefinitions),
    dimensionCardinalities: toRecordArray(value.dimensionCardinalities),
    transformations: toStringArray(value.transformations),
    entityType: toStringArray(value.entityType),
    minimumValue: (value.minimumValue as number) ?? null,
    maximumValue: (value.maximumValue as number) ?? null,
    rootCauseRelevant: (value.rootCauseRelevant as boolean) ?? null,
    impactRelevant: (value.impactRelevant as boolean) ?? null,
    metricValueType: toRecordOrNull(value.metricValueType),
    latency: (value.latency as number) ?? null,
    metricSelector: (value.metricSelector as string) ?? null,
    scalar: (value.scalar as boolean) ?? null,
    resolutionInfSupported: (value.resolutionInfSupported as boolean) ?? null,
    warnings: toStringArray(value.warnings),
  }
}

/** Maps a service-level objective. */
export function mapSlo(value: Record<string, unknown>): DynatraceSlo {
  return {
    id: (value.id as string) ?? null,
    name: (value.name as string) ?? null,
    description: (value.description as string) ?? null,
    enabled: (value.enabled as boolean) ?? null,
    target: (value.target as number) ?? null,
    warning: (value.warning as number) ?? null,
    timeframe: (value.timeframe as string) ?? null,
    filter: (value.filter as string) ?? null,
    evaluationType: (value.evaluationType as string) ?? null,
    evaluatedPercentage: (value.evaluatedPercentage as number) ?? null,
    status: (value.status as string) ?? null,
    error: (value.error as string) ?? null,
    errorBudget: (value.errorBudget as number) ?? null,
    errorBudgetBurnRate: toRecordOrNull(value.errorBudgetBurnRate),
    metricKey: (value.metricKey as string) ?? null,
    metricName: (value.metricName as string) ?? null,
    metricExpression: (value.metricExpression as string) ?? null,
    relatedOpenProblems: (value.relatedOpenProblems as number) ?? null,
    relatedTotalProblems: (value.relatedTotalProblems as number) ?? null,
  }
}

/** Maps a security problem (vulnerability). */
export function mapSecurityProblem(value: Record<string, unknown>): DynatraceSecurityProblem {
  return {
    securityProblemId: (value.securityProblemId as string) ?? null,
    displayId: (value.displayId as string) ?? null,
    status: (value.status as string) ?? null,
    muted: (value.muted as boolean) ?? null,
    title: (value.title as string) ?? null,
    technology: (value.technology as string) ?? null,
    vulnerabilityType: (value.vulnerabilityType as string) ?? null,
    packageName: (value.packageName as string) ?? null,
    externalVulnerabilityId: (value.externalVulnerabilityId as string) ?? null,
    cveIds: toStringArray(value.cveIds),
    url: (value.url as string) ?? null,
    firstSeenTimestamp: (value.firstSeenTimestamp as number) ?? null,
    lastUpdatedTimestamp: (value.lastUpdatedTimestamp as number) ?? null,
    lastOpenedTimestamp: (value.lastOpenedTimestamp as number) ?? null,
    lastResolvedTimestamp: (value.lastResolvedTimestamp as number) ?? null,
    riskAssessment: toRecordOrNull(value.riskAssessment),
    managementZones: mapManagementZones(value.managementZones),
    globalCounts: toRecordOrNull(value.globalCounts),
    codeLevelVulnerabilityDetails: toRecordOrNull(value.codeLevelVulnerabilityDetails),
  }
}

/** Maps a security problem including the detail-only fields. */
export function mapSecurityProblemDetails(
  value: Record<string, unknown>
): DynatraceSecurityProblemDetails {
  return {
    ...mapSecurityProblem(value),
    description: (value.description as string) ?? null,
    remediationDescription: (value.remediationDescription as string) ?? null,
    muteStateChangeInProgress: (value.muteStateChangeInProgress as boolean) ?? null,
    affectedEntities: toStringArray(value.affectedEntities),
    exposedEntities: toStringArray(value.exposedEntities),
    reachableDataAssets: toStringArray(value.reachableDataAssets),
    vulnerableComponents: toRecordArray(value.vulnerableComponents),
    filteredCounts: toRecordOrNull(value.filteredCounts),
    events: toRecordArray(value.events),
    entryPoints: toRecordOrNull(value.entryPoints),
    relatedEntities: toRecordOrNull(value.relatedEntities),
    relatedAttacks: toRecordOrNull(value.relatedAttacks),
    relatedContainerImages: toRecordOrNull(value.relatedContainerImages),
  }
}

/** Maps an audit log entry, lifting the dotted `dt.settings.*` keys into camelCase. */
export function mapAuditLog(value: Record<string, unknown>): DynatraceAuditLog {
  return {
    logId: (value.logId as string) ?? null,
    eventType: (value.eventType as string) ?? null,
    category: (value.category as string) ?? null,
    entityId: (value.entityId as string) ?? null,
    environmentId: (value.environmentId as string) ?? null,
    user: (value.user as string) ?? null,
    userType: (value.userType as string) ?? null,
    userOrigin: (value.userOrigin as string) ?? null,
    timestamp: (value.timestamp as number) ?? null,
    success: (value.success as boolean) ?? null,
    message: (value.message as string) ?? null,
    patch: toRecordOrNull(value.patch),
    settingsSchemaId: (value['dt.settings.schema_id'] as string) ?? null,
    settingsScopeId: (value['dt.settings.scope_id'] as string) ?? null,
    settingsKey: (value['dt.settings.key'] as string) ?? null,
    settingsObjectId: (value['dt.settings.object_id'] as string) ?? null,
    settingsObjectSummary: (value['dt.settings.object_summary'] as string) ?? null,
    settingsScopeName: (value['dt.settings.scope_name'] as string) ?? null,
  }
}

/** Maps a log record from the Log Monitoring API v2 search endpoint. */
export function mapLogRecord(value: Record<string, unknown>): DynatraceLogRecord {
  return {
    timestamp: (value.timestamp as number) ?? null,
    status: (value.status as string) ?? null,
    content: (value.content as string) ?? null,
    eventType: (value.eventType as string) ?? null,
    additionalColumns: toRecord(value.additionalColumns),
  }
}

/**
 * Normalizes a list param that may arrive as a real array, a JSON array string,
 * or a comma-separated string.
 */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    const parsed = parseJsonParam(trimmed)
    if (Array.isArray(parsed)) return parsed.map((entry) => String(entry).trim()).filter(Boolean)
  }
  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Maps the per-problem summary a batch mute/unmute returns. */
export function mapMuteSummary(value: unknown): DynatraceMuteSummaryEntry[] {
  return toRecordArray(value).map((entry) => ({
    securityProblemId: (entry.securityProblemId as string) ?? null,
    muteStateChangeTriggered: (entry.muteStateChangeTriggered as boolean) ?? null,
    reason: (entry.reason as string) ?? null,
  }))
}

/** Maps a remediation item of a third-party vulnerability. */
export function mapRemediationItem(value: Record<string, unknown>): DynatraceRemediationItem {
  return {
    id: (value.id as string) ?? null,
    name: (value.name as string) ?? null,
    entityIds: toStringArray(value.entityIds),
    firstAffectedTimestamp: (value.firstAffectedTimestamp as number) ?? null,
    resolvedTimestamp: (value.resolvedTimestamp as number) ?? null,
    vulnerabilityState: (value.vulnerabilityState as string) ?? null,
    assessment: toRecordOrNull(value.assessment),
    muteState: toRecordOrNull(value.muteState),
    remediationProgress: toRecordOrNull(value.remediationProgress),
    trackingLink: toRecordOrNull(value.trackingLink),
    vulnerableComponents: toRecordArray(value.vulnerableComponents),
  }
}

/** Maps an Application Security attack. */
export function mapAttack(value: Record<string, unknown>): DynatraceAttack {
  return {
    attackId: (value.attackId as string) ?? null,
    displayId: (value.displayId as string) ?? null,
    displayName: (value.displayName as string) ?? null,
    attackType: (value.attackType as string) ?? null,
    state: (value.state as string) ?? null,
    technology: (value.technology as string) ?? null,
    timestamp: (value.timestamp as number) ?? null,
    attackTarget: toRecordOrNull(value.attackTarget),
    attacker: toRecordOrNull(value.attacker),
    affectedEntities: toRecordOrNull(value.affectedEntities),
    entrypoint: toRecordOrNull(value.entrypoint),
    request: toRecordOrNull(value.request),
    securityProblem: toRecordOrNull(value.securityProblem),
    vulnerability: toRecordOrNull(value.vulnerability),
    managementZones: mapManagementZones(value.managementZones),
  }
}

/** Maps a settings schema descriptor. */
export function mapSettingsSchema(value: Record<string, unknown>): DynatraceSettingsSchema {
  return {
    schemaId: (value.schemaId as string) ?? null,
    displayName: (value.displayName as string) ?? null,
    latestSchemaVersion: (value.latestSchemaVersion as string) ?? null,
    maturity: (value.maturity as string) ?? null,
    multiObject: (value.multiObject as boolean) ?? null,
    ordered: (value.ordered as boolean) ?? null,
    ownerBasedAccessControl: (value.ownerBasedAccessControl as boolean) ?? null,
  }
}

/** Maps a settings object. */
export function mapSettingsObject(value: Record<string, unknown>): DynatraceSettingsObject {
  return {
    objectId: (value.objectId as string) ?? null,
    schemaId: (value.schemaId as string) ?? null,
    schemaVersion: (value.schemaVersion as string) ?? null,
    scope: (value.scope as string) ?? null,
    value: toRecordOrNull(value.value),
    author: (value.author as string) ?? null,
    created: (value.created as number) ?? null,
    modified: (value.modified as number) ?? null,
    updateToken: (value.updateToken as string) ?? null,
    externalId: (value.externalId as string) ?? null,
    summary: (value.summary as string) ?? null,
    searchSummary: (value.searchSummary as string) ?? null,
  }
}

/** Maps the per-object result a settings write returns. */
export function mapSettingsWriteResult(
  value: Record<string, unknown>
): DynatraceSettingsWriteResult {
  return {
    code: (value.code as number) ?? null,
    objectId: (value.objectId as string) ?? null,
    writeError: toRecordOrNull(value.error),
    invalidValue: value.invalidValue,
  }
}

/** Maps a short synthetic monitor representation. */
export function mapSyntheticMonitor(value: Record<string, unknown>): DynatraceSyntheticMonitor {
  return {
    entityId: (value.entityId as string) ?? null,
    name: (value.name as string) ?? null,
    type: (value.type as string) ?? null,
    enabled: (value.enabled as boolean) ?? null,
  }
}

/**
 * Builds the SLO payload shared by create and update. Both endpoints take the
 * same `SloConfigItemDto`, so keeping one builder stops them drifting apart.
 */
export function buildSloBody(params: DynatraceSloWriteFields): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: params.name,
    target: params.target,
    warning: params.warning,
    timeframe: params.timeframe,
    evaluationType: params.evaluationType || 'AGGREGATE',
  }
  if (params.description) body.description = params.description
  if (params.enabled !== undefined) body.enabled = params.enabled
  if (params.filter) body.filter = params.filter
  if (params.metricExpression) body.metricExpression = params.metricExpression
  if (params.metricName) body.metricName = params.metricName

  const burnRate: Record<string, unknown> = {}
  if (params.burnRateVisualizationEnabled !== undefined) {
    burnRate.burnRateVisualizationEnabled = params.burnRateVisualizationEnabled
  }
  if (params.fastBurnThreshold !== undefined) burnRate.fastBurnThreshold = params.fastBurnThreshold
  if (Object.keys(burnRate).length > 0) body.errorBudgetBurnRate = burnRate

  return body
}

/**
 * Extracts the trailing identifier from a `Location` response header. Dynatrace
 * returns a created SLO's ID there rather than in a body.
 */
export function idFromLocationHeader(response: Response): string | null {
  const location = response.headers.get('location')
  if (!location) return null
  const id = location.split('/').filter(Boolean).pop()
  return id ?? null
}

/** Normalizes the `warnings` array Dynatrace list endpoints return. */
export function mapWarnings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((warning) => String(warning))
  if (typeof value === 'string') return [value]
  return []
}
