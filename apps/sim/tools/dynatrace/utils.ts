import { truncate } from '@sim/utils/string'
import type {
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
  DynatraceProblem,
  DynatraceProblemFilter,
  DynatraceSecurityProblem,
  DynatraceSecurityProblemDetails,
  DynatraceSlo,
  DynatraceTag,
} from '@/tools/dynatrace/types'

type QueryValue = string | number | boolean | undefined | null

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
  const base = environmentUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v2$/, '')
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }

  const queryString = search.toString()
  return `${base}/api/v2${path}${queryString ? `?${queryString}` : ''}`
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

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
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

/** Normalizes the `warnings` array Dynatrace list endpoints return. */
export function mapWarnings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((warning) => String(warning))
  if (typeof value === 'string') return [value]
  return []
}
