import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  FivetranCondition,
  FivetranConnection,
  FivetranConnectorType,
  FivetranDestination,
  FivetranGroup,
  FivetranMessageResponse,
  FivetranSchemaConfig,
  FivetranSetupTest,
  FivetranTransformation,
  FivetranUser,
} from '@/tools/fivetran/types'
import type { OAuthConfig, ParameterVisibility } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const FIVETRAN_API_BASE_URL = 'https://api.fivetran.com/v1'

/** Fivetran reports failures as `{ "code": "...", "message": "..." }`. */
export const FIVETRAN_ERROR_EXTRACTOR = 'standard-message'

/** Fivetran tools authenticate with a saved Fivetran API key credential. */
export const FIVETRAN_OAUTH = {
  required: true,
  provider: 'fivetran',
  credentialKind: 'service-account',
} as const satisfies OAuthConfig

export const FIVETRAN_AUTH_PARAMS = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Basic credential supplied by the saved Fivetran API key',
  },
} as const

export const FIVETRAN_PAGINATION_PARAMS = {
  cursor: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Paging cursor from the nextCursor of a previous page',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Number of records per page, from 1 to 1000 (default 100)',
  },
}

export const FIVETRAN_CONNECTION_ID_PARAM = {
  connectionId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'ID of the connection',
  },
}

export const FIVETRAN_DESTINATION_ID_PARAM = {
  destinationId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'ID of the destination (the same as its group ID)',
  },
}

export const FIVETRAN_TRANSFORMATION_ID_PARAM = {
  transformationId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'ID of the transformation',
  },
}

export const FIVETRAN_TRUST_PARAMS = {
  trustCertificates: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Automatically trust the source certificate during setup tests (default false)',
  },
  trustFingerprints: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Automatically trust the SSH fingerprint during setup tests (default false)',
  },
}

/**
 * Fivetran authenticates with HTTP Basic auth. The saved credential resolves to
 * the base64 `apiKey:apiSecret` pair, so it is sent as-is.
 */
export function fivetranHeaders(params: { accessToken: string }): Record<string, string> {
  return {
    Authorization: `Basic ${params.accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

type QueryValue = string | number | boolean | null | undefined

/**
 * Builds a Fivetran API URL from already-encoded path segments and an optional
 * query. Empty query values are dropped so optional filters stay off the wire.
 */
export function fivetranUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${FIVETRAN_API_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) url.searchParams.set(key, text)
  }
  return url.toString()
}

/** Encodes a resource ID for a Fivetran path, rejecting traversal and separators. */
export function fivetranId(value: string | undefined, paramName: string): string {
  return safeUrlPathSegment(value ?? '', paramName)
}

/** Validates Fivetran's documented page size (1–1000) and passes the cursor through. */
export function fivetranPaginationQuery(params: {
  cursor?: string
  limit?: number
}): Record<string, QueryValue> {
  let limit: number | undefined
  if (params.limit !== undefined && params.limit !== null && String(params.limit).trim() !== '') {
    limit = Number(params.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Invalid limit: expected an integer from 1 to 1000.')
    }
  }
  return { cursor: trimmed(params.cursor), limit }
}

/** Reads an optional boolean that may arrive as a string from a block input. */
export function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

/** Reads an optional integer, rejecting non-integer input instead of sending it to Fivetran. */
export function optionalInteger(value: unknown, paramName: string): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`Invalid ${paramName}: expected an integer.`)
  return parsed
}

/** Trims a string input and returns undefined when it is empty. */
export function trimmed(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

/**
 * Accepts a JSON object supplied either as structured data (agent calls) or as a
 * JSON string (block inputs). Empty input returns undefined.
 */
export function parseJsonObject(
  value: unknown,
  label: string
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return undefined
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Invalid ${label}: expected a JSON object.`)
    }
  }
  if (!isRecordLike(parsed)) throw new Error(`Invalid ${label}: expected a JSON object.`)
  return parsed
}

/**
 * Parses a `{ "schema": ["table", ...] }` map, the shape Fivetran's re-sync endpoints take.
 * Fivetran rejects an empty map or an empty table list, so both are refused here.
 */
export function parseSchemaTableMap(
  value: unknown,
  label: string
): Record<string, string[]> | undefined {
  const parsed = parseJsonObject(value, label)
  if (!parsed) return undefined
  const entries = Object.entries(parsed)
  if (entries.length === 0) throw new Error(`Invalid ${label}: list at least one schema.`)
  const result: Record<string, string[]> = {}
  for (const [schema, tables] of entries) {
    const names = Array.isArray(tables)
      ? tables.map((table) => String(table).trim()).filter(Boolean)
      : []
    if (names.length === 0) {
      throw new Error(
        `Invalid ${label}: schema "${schema}" needs a non-empty array of table names.`
      )
    }
    result[schema] = names
  }
  return result
}

/** Reads `data` from a Fivetran `{ code, message, data }` envelope. */
export function envelopeData(body: unknown): Record<string, unknown> {
  return toRecord(toRecord(body).data)
}

/** Transforms a Fivetran action that responds with only `{ code, message }`. */
export async function transformMessageResponse(
  response: Response
): Promise<FivetranMessageResponse> {
  const body = toRecord(await response.json())
  return {
    success: true,
    output: { code: toStringOrNull(body.code), message: toStringOrNull(body.message) },
  }
}

/** Reads the items and next cursor from a paginated Fivetran envelope. */
export function envelopePage(body: unknown): { items: unknown[]; nextCursor: string | null } {
  const data = envelopeData(body)
  return { items: toArray(data.items), nextCursor: toStringOrNull(data.next_cursor) }
}

function stringList(value: unknown): string[] {
  return toArray(value).filter((item): item is string => typeof item === 'string')
}

function mapCondition(value: unknown): FivetranCondition {
  const condition = toRecord(value)
  return {
    code: toStringOrNull(condition.code),
    message: toStringOrNull(condition.message),
    details: toStringOrNull(condition.details),
  }
}

function mapSetupTests(value: unknown): FivetranSetupTest[] {
  return toArray(value).map((entry) => {
    const test = toRecord(entry)
    return {
      title: toStringOrNull(test.title),
      status: toStringOrNull(test.status),
      message: toStringOrNull(test.message),
      details: toRecordOrNull(test.details),
    }
  })
}

export function mapConnection(value: unknown): FivetranConnection {
  const connection = toRecord(value)
  const status = toRecord(connection.status)
  const schedule = toRecordOrNull(connection.schedule)
  return {
    id: toStringOrNull(connection.id) ?? '',
    groupId: toStringOrNull(connection.group_id),
    service: toStringOrNull(connection.service),
    serviceVersion: toNumberOrNull(connection.service_version),
    schema: toStringOrNull(connection.schema),
    paused: toBooleanOrNull(connection.paused),
    pauseAfterTrial: toBooleanOrNull(connection.pause_after_trial),
    connectedBy: toStringOrNull(connection.connected_by),
    createdAt: toStringOrNull(connection.created_at),
    succeededAt: toStringOrNull(connection.succeeded_at),
    failedAt: toStringOrNull(connection.failed_at),
    syncFrequency: toNumberOrNull(connection.sync_frequency),
    scheduleType: toStringOrNull(connection.schedule_type),
    dailySyncTime: toStringOrNull(connection.daily_sync_time),
    dataDelaySensitivity: toStringOrNull(connection.data_delay_sensitivity),
    dataDelayThreshold: toNumberOrNull(connection.data_delay_threshold),
    networkingMethod: toStringOrNull(connection.networking_method),
    privateLinkId: toStringOrNull(connection.private_link_id),
    proxyAgentId: toStringOrNull(connection.proxy_agent_id),
    hybridDeploymentAgentId: toStringOrNull(connection.hybrid_deployment_agent_id),
    dataChecks: toBooleanOrNull(connection.data_checks),
    destinationSchemaNames: toStringOrNull(connection.destination_schema_names),
    status: {
      setupState: toStringOrNull(status.setup_state),
      syncState: toStringOrNull(status.sync_state),
      updateState: toStringOrNull(status.update_state),
      isHistoricalSync: toBooleanOrNull(status.is_historical_sync),
      schemaStatus: toStringOrNull(status.schema_status),
      rescheduledFor: toStringOrNull(status.rescheduled_for),
      tasks: toArray(status.tasks).map(mapCondition),
      warnings: toArray(status.warnings).map(mapCondition),
    },
    schedule: schedule
      ? {
          scheduleType: toStringOrNull(schedule.schedule_type),
          interval: toNumberOrNull(schedule.interval),
          cron: toStringOrNull(schedule.cron),
          daysOfWeek: stringList(schedule.days_of_week),
          timeOfDay: toStringOrNull(schedule.time_of_day),
        }
      : null,
    setupTests: mapSetupTests(connection.setup_tests),
    config: toRecordOrNull(connection.config),
  }
}

export function mapGroup(value: unknown): FivetranGroup {
  const group = toRecord(value)
  return {
    id: toStringOrNull(group.id) ?? '',
    name: toStringOrNull(group.name),
    createdAt: toStringOrNull(group.created_at),
  }
}

export function mapDestination(value: unknown): FivetranDestination {
  const destination = toRecord(value)
  return {
    id: toStringOrNull(destination.id) ?? '',
    groupId: toStringOrNull(destination.group_id),
    service: toStringOrNull(destination.service),
    region: toStringOrNull(destination.region),
    timeZoneOffset: toStringOrNull(destination.time_zone_offset),
    setupStatus: toStringOrNull(destination.setup_status),
    daylightSavingTimeEnabled: toBooleanOrNull(destination.daylight_saving_time_enabled),
    networkingMethod: toStringOrNull(destination.networking_method),
    privateLinkId: toStringOrNull(destination.private_link_id),
    hybridDeploymentAgentId: toStringOrNull(destination.hybrid_deployment_agent_id),
    proxyAgentId: toStringOrNull(destination.proxy_agent_id),
    setupTests: mapSetupTests(destination.setup_tests),
  }
}

export function mapTransformation(value: unknown): FivetranTransformation {
  const transformation = toRecord(value)
  const schedule = toRecordOrNull(transformation.schedule)
  return {
    id: toStringOrNull(transformation.id) ?? '',
    type: toStringOrNull(transformation.type),
    status: toStringOrNull(transformation.status),
    paused: toBooleanOrNull(transformation.paused),
    createdAt: toStringOrNull(transformation.created_at),
    createdById: toStringOrNull(transformation.created_by_id),
    lastStartedAt: toStringOrNull(transformation.last_started_at),
    lastEndedAt: toStringOrNull(transformation.last_ended_at),
    outputModelNames: stringList(transformation.output_model_names),
    schedule: schedule
      ? {
          scheduleType: toStringOrNull(schedule.schedule_type),
          interval: toNumberOrNull(schedule.interval),
          cron: stringList(schedule.cron),
          daysOfWeek: stringList(schedule.days_of_week),
          timeOfDay: toStringOrNull(schedule.time_of_day),
          connectionIds: stringList(schedule.connection_ids),
          transformationIds: stringList(schedule.transformation_ids),
          smartSyncing: toBooleanOrNull(schedule.smart_syncing),
        }
      : null,
  }
}

export function mapUser(value: unknown): FivetranUser {
  const user = toRecord(value)
  return {
    id: toStringOrNull(user.id) ?? '',
    email: toStringOrNull(user.email),
    givenName: toStringOrNull(user.given_name),
    familyName: toStringOrNull(user.family_name),
    role: toStringOrNull(user.role),
    active: toBooleanOrNull(user.active),
    verified: toBooleanOrNull(user.verified),
    invited: toBooleanOrNull(user.invited),
    userType: toStringOrNull(user.user_type),
    hasApiKey: toBooleanOrNull(user.has_api_key),
    phone: toStringOrNull(user.phone),
    loggedInAt: toStringOrNull(user.logged_in_at),
    createdAt: toStringOrNull(user.created_at),
  }
}

export function mapConnectorType(value: unknown): FivetranConnectorType {
  const connectorType = toRecord(value)
  return {
    id: toStringOrNull(connectorType.id) ?? '',
    name: toStringOrNull(connectorType.name),
    type: toStringOrNull(connectorType.type),
    description: toStringOrNull(connectorType.description),
    connectorClass: toStringOrNull(connectorType.connector_class),
    serviceStatus: toStringOrNull(connectorType.service_status),
    iconUrl: toStringOrNull(connectorType.icon_url),
    linkToDocs: toStringOrNull(connectorType.link_to_docs),
    linkToErd: toStringOrNull(connectorType.link_to_erd),
    supportsSchemaReload: toBooleanOrNull(connectorType.supports_schema_reload),
    supportedFeatures: toArray(connectorType.supported_features)
      .map((feature) => toStringOrNull(toRecord(feature).id))
      .filter((id): id is string => id !== null),
  }
}

export function mapSchemaConfig(value: unknown): FivetranSchemaConfig {
  const config = toRecord(value)
  return {
    schemas: toRecord(config.schemas),
    enableNewByDefault: toBooleanOrNull(config.enable_new_by_default),
    schemaChangeHandling: toStringOrNull(config.schema_change_handling),
    rowFilteringSupported: toBooleanOrNull(config.row_filtering_supported),
  }
}
