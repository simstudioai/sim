import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { CrowdstrikeQueryBody } from '@/lib/api/contracts/tools/crowdstrike'
import {
  buildUrl,
  type CrowdStrikeCallResult,
  callCrowdStrike,
  getAccessToken,
  getBoolean,
  getCloudBaseUrl,
  getCursorPagination,
  getEnvelopeErrors,
  getFalconErrorMessage,
  getFirstRecordResource,
  getNumber,
  getPagination,
  getRecordArray,
  getRecordResources,
  getResourcesArray,
  getSpotlightPagination,
  getString,
  getStringArray,
  getStringResources,
} from '@/lib/internal/crowdstrike/client'
import {
  normalizeAffectedEntity,
  normalizeAlert,
  normalizeCase,
  normalizeHostGroup,
  normalizeIndicator,
  normalizeVulnerability,
} from '@/lib/internal/crowdstrike/normalizers'
import type {
  CrowdStrikeActionParameter,
  CrowdStrikeQuerySensorsParams,
  CrowdStrikeSensorAggregateBucket,
  CrowdStrikeSensorAggregateResult,
} from '@/tools/crowdstrike/types'

const logger = createLogger('CrowdStrikeOperations')

type ExtendedOperation = Exclude<
  CrowdstrikeQueryBody['operation'],
  | 'crowdstrike_query_sensors'
  | 'crowdstrike_get_sensor_details'
  | 'crowdstrike_get_sensor_aggregates'
>

type ExtendedBody = Extract<CrowdstrikeQueryBody, { operation: ExtendedOperation }>

type SensorBody = Exclude<CrowdstrikeQueryBody, ExtendedBody>

export interface OperationFailure {
  ok: false
  status: number
  error: string
}

export interface OperationSuccess {
  ok: true
  output: Record<string, unknown>
}

export type OperationResult = OperationSuccess | OperationFailure

/**
 * CrowdStrike can answer 200 while the envelope carries only errors. Reporting
 * that as HTTP 200 would read as a success, so fall back to the per-item error
 * code the envelope supplies, and to 502 when it supplies none.
 */
export function failureStatus(result: CrowdStrikeCallResult): number {
  if (!result.ok) {
    return result.status
  }

  const envelopeCode = getEnvelopeErrors(result.data)[0]?.code
  if (envelopeCode != null && envelopeCode >= 400 && envelopeCode <= 599) {
    return envelopeCode
  }

  return 502
}

function fail(result: CrowdStrikeCallResult, fallback: string): OperationFailure {
  return {
    ok: false,
    status: failureStatus(result),
    error: getFalconErrorMessage(result.data, fallback),
  }
}

/**
 * CrowdStrike answers 200 with a populated `errors` array when only some IDs
 * fail. Treat that as an outright failure only when nothing came back at all.
 */
export function failedWithoutResources(
  result: CrowdStrikeCallResult,
  resourceCount: number
): boolean {
  return resourceCount === 0 && getEnvelopeErrors(result.data).length > 0
}

function normalizeSensor(resource: Record<string, unknown>) {
  return {
    agentVersion: getString(resource.agent_version),
    cid: getString(resource.cid),
    deviceId: getString(resource.device_id),
    heartbeatTime: getNumber(resource.heartbeat_time),
    hostname: getString(resource.hostname),
    idpPolicyId: getString(resource.idp_policy_id),
    idpPolicyName: getString(resource.idp_policy_name),
    ipAddress: getString(resource.local_ip),
    kerberosConfig: getString(resource.kerberos_config),
    ldapConfig: getString(resource.ldap_config),
    ldapsConfig: getString(resource.ldaps_config),
    machineDomain: getString(resource.machine_domain),
    ntlmConfig: getString(resource.ntlm_config),
    osVersion: getString(resource.os_version),
    rdpToDcConfig: getString(resource.rdp_to_dc_config),
    smbToDcConfig: getString(resource.smb_to_dc_config),
    status: getString(resource.status),
    statusCauses: getStringArray(resource.status_causes),
    tiEnabled: getString(resource.ti_enabled),
  }
}

function normalizeSensorsOutput(data: unknown, paginationData?: unknown) {
  const sensors = getRecordResources(data).map(normalizeSensor)

  return {
    count: sensors.length,
    errors: getEnvelopeErrors(data),
    pagination: paginationData == null ? null : getPagination(paginationData),
    sensors,
  }
}

function normalizeAggregationResult(
  resource: Record<string, unknown>
): CrowdStrikeSensorAggregateResult {
  return {
    buckets: getRecordArray(resource.buckets).map(normalizeAggregationBucket),
    docCountErrorUpperBound: getNumber(resource.doc_count_error_upper_bound),
    name: getString(resource.name),
    sumOtherDocCount: getNumber(resource.sum_other_doc_count),
  }
}

function normalizeAggregationBucket(
  resource: Record<string, unknown>
): CrowdStrikeSensorAggregateBucket {
  return {
    count: getNumber(resource.count),
    from: getNumber(resource.from),
    keyAsString: getString(resource.key_as_string),
    label: resource.label ?? null,
    stringFrom: getString(resource.string_from),
    stringTo: getString(resource.string_to),
    subAggregates: getRecordArray(resource.sub_aggregates).map(normalizeAggregationResult),
    to: getNumber(resource.to),
    value: getNumber(resource.value),
    valueAsString: getString(resource.value_as_string),
  }
}

function normalizeAggregatesOutput(data: unknown) {
  const aggregates = getRecordResources(data).map(normalizeAggregationResult)

  return {
    aggregates,
    count: aggregates.length,
    errors: getEnvelopeErrors(data),
  }
}

function sensorQuery(params: CrowdStrikeQuerySensorsParams) {
  return {
    filter: params.filter,
    limit: params.limit,
    offset: params.offset,
    sort: params.sort,
  }
}

async function executeSensorOperation(
  body: SensorBody,
  baseUrl: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<OperationResult> {
  const request = (options: Parameters<typeof callCrowdStrike>[2]) =>
    callCrowdStrike(baseUrl, accessToken, options, signal)

  if (body.operation === 'crowdstrike_query_sensors') {
    const queryResult = await request({
      method: 'GET',
      path: '/identity-protection/queries/devices/v1',
      query: sensorQuery(body),
    })
    if (!queryResult.ok) return fail(queryResult, 'CrowdStrike request failed')

    const ids = getStringResources(queryResult.data)
    if (failedWithoutResources(queryResult, ids.length)) {
      return fail(queryResult, 'Failed to query CrowdStrike sensors')
    }

    if (ids.length === 0) {
      return {
        ok: true,
        output: normalizeSensorsOutput({ resources: [] }, queryResult.data),
      }
    }

    const detailResult = await request({
      method: 'POST',
      path: '/identity-protection/entities/devices/GET/v1',
      body: { ids },
    })
    if (!detailResult.ok) {
      return fail(detailResult, 'Failed to fetch CrowdStrike sensor details')
    }
    if (failedWithoutResources(detailResult, getRecordResources(detailResult.data).length)) {
      return fail(detailResult, 'Failed to fetch CrowdStrike sensor details')
    }

    return {
      ok: true,
      output: normalizeSensorsOutput(detailResult.data, queryResult.data),
    }
  }

  if (body.operation === 'crowdstrike_get_sensor_details') {
    const detailResult = await request({
      method: 'POST',
      path: '/identity-protection/entities/devices/GET/v1',
      body: { ids: body.ids },
    })
    if (!detailResult.ok) {
      return fail(detailResult, 'Failed to fetch CrowdStrike sensor details')
    }
    if (failedWithoutResources(detailResult, getRecordResources(detailResult.data).length)) {
      return fail(detailResult, 'Failed to fetch CrowdStrike sensor details')
    }

    return { ok: true, output: normalizeSensorsOutput(detailResult.data) }
  }

  const aggregateResult = await request({
    method: 'POST',
    path: '/identity-protection/aggregates/devices/GET/v1',
    body: body.aggregateQuery,
  })
  if (!aggregateResult.ok) {
    return fail(aggregateResult, 'Failed to fetch CrowdStrike sensor aggregates')
  }
  if (failedWithoutResources(aggregateResult, getRecordResources(aggregateResult.data).length)) {
    return fail(aggregateResult, 'Failed to fetch CrowdStrike sensor aggregates')
  }

  return { ok: true, output: normalizeAggregatesOutput(aggregateResult.data) }
}

/**
 * Falcon's by-ids lookups carry every ID in the query string, so a request at the
 * contract maxima (1000 indicator IDs at ~68 bytes each) would generate a ~68 KB
 * URL. Proxies and load balancers commonly cap the request line plus headers at
 * 8 KB, so batches are sized to keep each generated URL at or under half of that,
 * leaving the rest of the budget for headers.
 */
export const MAX_ID_URL_BYTES = 4096

/**
 * Batches by cumulative encoded length rather than by a fixed count: Falcon IDs
 * range from 32-character AIDs to long composite alert IDs, so a count-based cap
 * would either waste the budget or blow past it. A single ID longer than the
 * budget still gets its own batch — truncating the list would silently drop it.
 */
export function chunkIdsByUrlBudget(ids: string[], budget: number): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let used = 0

  for (const id of ids) {
    const cost = `&ids=${encodeURIComponent(id)}`.length
    if (current.length > 0 && used + cost > budget) {
      chunks.push(current)
      current = []
      used = 0
    }
    current.push(id)
    used += cost
  }

  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}

/**
 * Caps how much of the already-committed ID list is spelled out in a partial-failure
 * message. A by-ids delete can carry 1000 IDs at ~68 bytes each, so the full list
 * would bury the actual failure under ~68 KB of text.
 */
const MAX_COMMITTED_IDS_IN_MESSAGE = 400

/**
 * Rewrites a failed batch's envelope so the reported error names the deletions the
 * earlier batches already committed.
 *
 * Batches run sequentially and Falcon has no way to roll back a deletion it already
 * performed. Short-circuiting on a later batch would therefore report a bare failure
 * over work that already happened, and a blind retry would target IDs that no longer
 * exist. Only the message survives to the caller ({@link fail} keeps `status` and the
 * message, not `data`), so the committed list is written onto `errors[0].message`,
 * which is the first thing {@link getFalconErrorMessage} reads.
 *
 * `committed` holds the IDs Falcon echoed in `resources`, never the IDs that were
 * requested, so an ID that failed inside an otherwise-200 batch is not reported as
 * deleted.
 */
function withCommittedIds(
  result: CrowdStrikeCallResult,
  committed: string[]
): CrowdStrikeCallResult {
  if (committed.length === 0) return result

  const envelope = isRecordLike(result.data) ? result.data : {}
  const existing = getRecordArray(envelope.errors)
  const reason = getFalconErrorMessage(result.data, 'CrowdStrike rejected a later batch.')
  const message =
    `${reason} This request was split into batches and ${committed.length} ID(s) were already deleted ` +
    `before the failing batch; they were not rolled back, so retry only the remainder. ` +
    `Deleted: ${truncate(committed.join(', '), MAX_COMMITTED_IDS_IN_MESSAGE)}`

  return {
    ...result,
    data: { ...envelope, errors: [{ ...(existing[0] ?? {}), message }, ...existing.slice(1)] },
  }
}

interface ByIdsRequestOptions {
  method: 'GET' | 'DELETE'
  path: string
  ids: string[] | undefined
  query?: Record<string, string | number | boolean | undefined>
}

/**
 * Issues a by-ids lookup as however many requests it takes to stay under
 * `MAX_ID_URL_BYTES`, then presents the batches as one `{ meta, resources, errors }`
 * envelope so callers read the same shape a single request returns.
 *
 * Batches run sequentially: resource order matches the caller's ID order, the
 * endpoint's rate limit only ever sees one request at a time, and a failing batch
 * short-circuits with its own status instead of being merged away. A `DELETE` that
 * fails partway also carries the IDs its earlier batches already removed — see
 * {@link withCommittedIds}. `meta` comes
 * from the first batch — pagination is meaningless for a lookup that names every
 * ID it wants, and no by-ids operation here reads it.
 */
async function callCrowdStrikeByIds(
  baseUrl: string,
  accessToken: string,
  options: ByIdsRequestOptions,
  signal?: AbortSignal
): Promise<CrowdStrikeCallResult> {
  const prefix = buildUrl(baseUrl, {
    method: options.method,
    path: options.path,
    query: options.query,
  })
  const chunks = chunkIdsByUrlBudget(
    options.ids ?? [],
    Math.max(MAX_ID_URL_BYTES - prefix.length, 1)
  )

  if (chunks.length <= 1) {
    return callCrowdStrike(
      baseUrl,
      accessToken,
      {
        method: options.method,
        path: options.path,
        query: options.query,
        repeatedQuery: { ids: options.ids },
      },
      signal
    )
  }

  const resources: unknown[] = []
  const errors: unknown[] = []
  const committed: string[] = []
  let meta: unknown
  let status = 200

  for (const [index, chunk] of chunks.entries()) {
    const result = await callCrowdStrike(
      baseUrl,
      accessToken,
      {
        method: options.method,
        path: options.path,
        query: options.query,
        repeatedQuery: { ids: chunk },
      },
      signal
    )

    if (!result.ok) {
      return options.method === 'DELETE' ? withCommittedIds(result, committed) : result
    }

    /**
     * Only the IDs Falcon echoed in `resources` were actually deleted. A batch can
     * answer 200 while reporting per-ID failures in `errors`, so recording the
     * requested chunk would name indicators that are still live and tell the
     * caller to drop them from the retry.
     */
    if (options.method === 'DELETE') {
      committed.push(...getStringResources(result.data))
    }

    if (index === 0) {
      status = result.status
      meta = isRecordLike(result.data) ? result.data.meta : undefined
    }

    resources.push(...getResourcesArray(result.data))
    errors.push(...getRecordArray(isRecordLike(result.data) ? result.data.errors : undefined))
  }

  return { ok: true, status, data: { meta, resources, errors } }
}

function buildAlertActionParameters(
  body: Extract<ExtendedBody, { operation: 'crowdstrike_update_alerts' }>
) {
  const parameters: CrowdStrikeActionParameter[] = []

  const push = (name: string, value: string | undefined) => {
    if (value !== undefined) {
      parameters.push({ name, value })
    }
  }

  push('update_status', body.updateStatus)
  push('assign_to_uuid', body.assignToUuid)
  push('assign_to_user_id', body.assignToUserId)
  push('assign_to_name', body.assignToName)
  push('append_comment', body.appendComment)
  push('add_tag', body.addTag)
  push('remove_tag', body.removeTag)
  push('remove_tags_by_prefix', body.removeTagsByPrefix)

  if (body.unassign === true) {
    parameters.push({ name: 'unassign', value: '' })
  }

  if (body.showInUi !== undefined) {
    parameters.push({ name: 'show_in_ui', value: String(body.showInUi) })
  }

  for (const parameter of body.actionParameters ?? []) {
    parameters.push({ name: parameter.name, value: parameter.value })
  }

  return parameters
}

/**
 * CrowdStrike's host-group action endpoint selects the hosts to add or remove
 * with an FQL `device_id` filter rather than an ID list.
 */
function buildDeviceIdFilter(deviceIds: string[]): string {
  const values = deviceIds.map((id) => `'${id.replaceAll("'", "\\'")}'`).join(',')
  return `(device_id:[${values}])`
}

export async function executeCrowdStrikeOperation(
  body: ExtendedBody,
  baseUrl: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<OperationResult> {
  const request = (options: Parameters<typeof callCrowdStrike>[2]) =>
    callCrowdStrike(baseUrl, accessToken, options, signal)

  switch (body.operation) {
    case 'crowdstrike_query_alerts': {
      const result = await request({
        method: 'GET',
        path: '/alerts/queries/alerts/v2',
        query: {
          filter: body.filter,
          include_hidden: body.includeHidden,
          limit: body.limit,
          offset: body.offset,
          q: body.q,
          sort: body.sort,
        },
      })
      if (!result.ok) return fail(result, 'Failed to query CrowdStrike alerts')

      const alertIds = getStringResources(result.data)
      if (failedWithoutResources(result, alertIds.length)) {
        return fail(result, 'Failed to query CrowdStrike alerts')
      }

      return {
        ok: true,
        output: { alertIds, count: alertIds.length, pagination: getPagination(result.data) },
      }
    }

    case 'crowdstrike_get_alert_details': {
      const result = await request({
        method: 'POST',
        path: '/alerts/entities/alerts/v2',
        query: { include_hidden: body.includeHidden },
        body: { composite_ids: body.compositeIds },
      })
      if (!result.ok) return fail(result, 'Failed to fetch CrowdStrike alert details')

      const alerts = getRecordResources(result.data).map(normalizeAlert)
      if (failedWithoutResources(result, alerts.length)) {
        return fail(result, 'Failed to fetch CrowdStrike alert details')
      }

      return {
        ok: true,
        output: { alerts, count: alerts.length, errors: getEnvelopeErrors(result.data) },
      }
    }

    case 'crowdstrike_update_alerts': {
      const result = await request({
        method: 'PATCH',
        path: '/alerts/entities/alerts/v3',
        query: { include_hidden: body.includeHidden },
        body: {
          action_parameters: buildAlertActionParameters(body),
          composite_ids: body.compositeIds,
        },
      })
      if (!result.ok) return fail(result, 'Failed to update CrowdStrike alerts')

      const errors = getEnvelopeErrors(result.data)
      if (errors.length > 0) {
        return fail(result, 'Failed to update CrowdStrike alerts')
      }

      return {
        ok: true,
        output: { updatedIds: body.compositeIds, count: body.compositeIds.length, errors },
      }
    }

    case 'crowdstrike_perform_host_action': {
      const result = await request({
        method: 'POST',
        path: '/devices/entities/devices-actions/v2',
        query: { action_name: body.actionName },
        body: { ids: body.deviceIds },
      })
      if (!result.ok) return fail(result, 'Failed to perform CrowdStrike host action')

      const affected = getRecordResources(result.data).map(normalizeAffectedEntity)
      if (failedWithoutResources(result, affected.length)) {
        return fail(result, 'Failed to perform CrowdStrike host action')
      }

      return {
        ok: true,
        output: { affected, count: affected.length, errors: getEnvelopeErrors(result.data) },
      }
    }

    case 'crowdstrike_query_host_groups': {
      const result = await request({
        method: 'GET',
        path: '/devices/queries/host-groups/v1',
        query: {
          filter: body.filter,
          limit: body.limit,
          offset: body.offset,
          sort: body.sort,
        },
      })
      if (!result.ok) return fail(result, 'Failed to query CrowdStrike host groups')

      const hostGroupIds = getStringResources(result.data)
      if (failedWithoutResources(result, hostGroupIds.length)) {
        return fail(result, 'Failed to query CrowdStrike host groups')
      }

      return {
        ok: true,
        output: {
          hostGroupIds,
          count: hostGroupIds.length,
          pagination: getPagination(result.data),
        },
      }
    }

    case 'crowdstrike_get_host_group_details': {
      const result = await callCrowdStrikeByIds(
        baseUrl,
        accessToken,
        {
          method: 'GET',
          path: '/devices/entities/host-groups/v1',
          ids: body.hostGroupIds,
        },
        signal
      )
      if (!result.ok) return fail(result, 'Failed to fetch CrowdStrike host group details')

      const hostGroups = getRecordResources(result.data).map(normalizeHostGroup)
      if (failedWithoutResources(result, hostGroups.length)) {
        return fail(result, 'Failed to fetch CrowdStrike host group details')
      }

      return {
        ok: true,
        output: {
          hostGroups,
          count: hostGroups.length,
          errors: getEnvelopeErrors(result.data),
        },
      }
    }

    case 'crowdstrike_perform_host_group_action': {
      const result = await request({
        method: 'POST',
        path: '/devices/entities/host-group-actions/v1',
        query: { action_name: body.actionName },
        body: {
          action_parameters: [{ name: 'filter', value: buildDeviceIdFilter(body.deviceIds) }],
          ids: [body.hostGroupId],
        },
      })
      if (!result.ok) return fail(result, 'Failed to perform CrowdStrike host group action')

      const hostGroups = getRecordResources(result.data).map(normalizeHostGroup)
      if (failedWithoutResources(result, hostGroups.length)) {
        return fail(result, 'Failed to perform CrowdStrike host group action')
      }

      return {
        ok: true,
        output: {
          hostGroups,
          count: hostGroups.length,
          errors: getEnvelopeErrors(result.data),
        },
      }
    }

    case 'crowdstrike_query_indicators': {
      const result = await request({
        method: 'GET',
        path: '/iocs/queries/indicators/v1',
        query: {
          after: body.after,
          filter: body.filter,
          limit: body.limit,
          offset: body.offset,
          sort: body.sort,
        },
      })
      if (!result.ok) return fail(result, 'Failed to query CrowdStrike indicators')

      const indicatorIds = getStringResources(result.data)
      if (failedWithoutResources(result, indicatorIds.length)) {
        return fail(result, 'Failed to query CrowdStrike indicators')
      }

      return {
        ok: true,
        output: {
          indicatorIds,
          count: indicatorIds.length,
          pagination: getCursorPagination(result.data),
        },
      }
    }

    case 'crowdstrike_get_indicator_details': {
      const result = await callCrowdStrikeByIds(
        baseUrl,
        accessToken,
        {
          method: 'GET',
          path: '/iocs/entities/indicators/v1',
          ids: body.indicatorIds,
        },
        signal
      )
      if (!result.ok) return fail(result, 'Failed to fetch CrowdStrike indicator details')

      const indicators = getRecordResources(result.data).map(normalizeIndicator)
      if (failedWithoutResources(result, indicators.length)) {
        return fail(result, 'Failed to fetch CrowdStrike indicator details')
      }

      return {
        ok: true,
        output: {
          indicators,
          count: indicators.length,
          errors: getEnvelopeErrors(result.data),
        },
      }
    }

    case 'crowdstrike_create_indicators':
    case 'crowdstrike_update_indicators': {
      const isCreate = body.operation === 'crowdstrike_create_indicators'
      const result = await request({
        method: isCreate ? 'POST' : 'PATCH',
        path: '/iocs/entities/indicators/v1',
        query: {
          ignore_warnings: body.ignoreWarnings,
          retrodetects: body.retrodetects,
        },
        body: {
          comment: body.comment,
          indicators: body.indicators,
        },
      })
      if (!result.ok) {
        return fail(
          result,
          isCreate
            ? 'Failed to create CrowdStrike indicators'
            : 'Failed to update CrowdStrike indicators'
        )
      }

      const indicators = getRecordResources(result.data).map(normalizeIndicator)
      if (failedWithoutResources(result, indicators.length)) {
        return fail(
          result,
          isCreate
            ? 'Failed to create CrowdStrike indicators'
            : 'Failed to update CrowdStrike indicators'
        )
      }

      return {
        ok: true,
        output: {
          indicators,
          count: indicators.length,
          errors: getEnvelopeErrors(result.data),
        },
      }
    }

    case 'crowdstrike_delete_indicators': {
      const result = await callCrowdStrikeByIds(
        baseUrl,
        accessToken,
        {
          method: 'DELETE',
          path: '/iocs/entities/indicators/v1',
          query: { comment: body.comment, filter: body.filter },
          ids: body.filter ? undefined : body.indicatorIds,
        },
        signal
      )
      if (!result.ok) return fail(result, 'Failed to delete CrowdStrike indicators')

      const deletedIds = getStringResources(result.data)
      if (failedWithoutResources(result, deletedIds.length)) {
        return fail(result, 'Failed to delete CrowdStrike indicators')
      }

      return {
        ok: true,
        output: {
          deletedIds,
          count: deletedIds.length,
          errors: getEnvelopeErrors(result.data),
        },
      }
    }

    case 'crowdstrike_query_vulnerabilities': {
      const result = await request({
        method: 'GET',
        path: '/spotlight/queries/vulnerabilities/v1',
        query: {
          after: body.after,
          filter: body.filter,
          limit: body.limit,
          sort: body.sort,
        },
      })
      if (!result.ok) return fail(result, 'Failed to query CrowdStrike vulnerabilities')

      const vulnerabilityIds = getStringResources(result.data)
      if (failedWithoutResources(result, vulnerabilityIds.length)) {
        return fail(result, 'Failed to query CrowdStrike vulnerabilities')
      }

      return {
        ok: true,
        output: {
          vulnerabilityIds,
          count: vulnerabilityIds.length,
          pagination: getSpotlightPagination(result.data),
        },
      }
    }

    case 'crowdstrike_get_vulnerability_details': {
      const result = await callCrowdStrikeByIds(
        baseUrl,
        accessToken,
        {
          method: 'GET',
          path: '/spotlight/entities/vulnerabilities/v2',
          ids: body.vulnerabilityIds,
        },
        signal
      )
      if (!result.ok) return fail(result, 'Failed to fetch CrowdStrike vulnerability details')

      const vulnerabilities = getRecordResources(result.data).map(normalizeVulnerability)
      if (failedWithoutResources(result, vulnerabilities.length)) {
        return fail(result, 'Failed to fetch CrowdStrike vulnerability details')
      }

      return {
        ok: true,
        output: {
          vulnerabilities,
          count: vulnerabilities.length,
          errors: getEnvelopeErrors(result.data),
        },
      }
    }

    case 'crowdstrike_init_rtr_session': {
      const result = await request({
        method: 'POST',
        path: '/real-time-response/entities/sessions/v1',
        body: {
          device_id: body.deviceId,
          origin: body.origin,
          queue_offline: body.queueOffline,
        },
      })
      if (!result.ok) return fail(result, 'Failed to initialize CrowdStrike RTR session')

      const session = getFirstRecordResource(result.data)
      if (!session) return fail(result, 'CrowdStrike did not return an RTR session')

      return {
        ok: true,
        output: {
          sessionId: getString(session.session_id),
          deviceId: getString(session.device_id),
          platform: getString(session.platform),
          pwd: getString(session.pwd),
          offlineQueued: getBoolean(session.offline_queued),
          existingAidSessions: getNumber(session.existing_aid_sessions),
          createdAt: getString(session.created_at),
          errors: getEnvelopeErrors(result.data),
        },
      }
    }

    case 'crowdstrike_execute_rtr_command': {
      const result = await request({
        method: 'POST',
        path: '/real-time-response/entities/command/v1',
        body: {
          base_command: body.baseCommand,
          command_string: body.commandString,
          session_id: body.sessionId,
        },
      })
      if (!result.ok) return fail(result, 'Failed to execute CrowdStrike RTR command')

      const command = getFirstRecordResource(result.data)
      if (!command) return fail(result, 'CrowdStrike did not return an RTR command result')

      return {
        ok: true,
        output: {
          cloudRequestId: getString(command.cloud_request_id),
          sessionId: getString(command.session_id),
          queuedCommandOffline: getBoolean(command.queued_command_offline),
          errors: getEnvelopeErrors(result.data),
        },
      }
    }

    case 'crowdstrike_get_rtr_command_status': {
      const result = await request({
        method: 'GET',
        path: '/real-time-response/entities/command/v1',
        query: {
          cloud_request_id: body.cloudRequestId,
          sequence_id: body.sequenceId ?? 0,
        },
      })
      if (!result.ok) return fail(result, 'Failed to fetch CrowdStrike RTR command status')

      const status = getFirstRecordResource(result.data)
      if (!status) return fail(result, 'CrowdStrike did not return an RTR command status')

      return {
        ok: true,
        output: {
          complete: getBoolean(status.complete),
          stdout: getString(status.stdout),
          stderr: getString(status.stderr),
          baseCommand: getString(status.base_command),
          sessionId: getString(status.session_id),
          taskId: getString(status.task_id),
          sequenceId: getNumber(status.sequence_id),
          errors: getEnvelopeErrors(result.data),
        },
      }
    }

    case 'crowdstrike_delete_rtr_session': {
      const result = await request({
        method: 'DELETE',
        path: '/real-time-response/entities/sessions/v1',
        query: { session_id: body.sessionId },
      })
      if (!result.ok) return fail(result, 'Failed to delete CrowdStrike RTR session')

      const deleteErrors = getEnvelopeErrors(result.data)
      if (deleteErrors.length > 0) {
        return fail(result, 'Failed to delete CrowdStrike RTR session')
      }

      return {
        ok: true,
        output: {
          sessionId: body.sessionId,
          deleted: true,
          errors: deleteErrors,
        },
      }
    }

    case 'crowdstrike_query_cases': {
      const result = await request({
        method: 'GET',
        path: '/cases/queries/cases/v1',
        query: {
          filter: body.filter,
          limit: body.limit,
          offset: body.offset,
          q: body.q,
          sort: body.sort,
        },
      })
      if (!result.ok) return fail(result, 'Failed to query CrowdStrike cases')

      const caseIds = getStringResources(result.data)
      if (failedWithoutResources(result, caseIds.length)) {
        return fail(result, 'Failed to query CrowdStrike cases')
      }

      return {
        ok: true,
        output: { caseIds, count: caseIds.length, pagination: getPagination(result.data) },
      }
    }

    case 'crowdstrike_get_case_details': {
      const result = await request({
        method: 'POST',
        path: '/cases/entities/cases/v2',
        body: { ids: body.caseIds },
      })
      if (!result.ok) return fail(result, 'Failed to fetch CrowdStrike case details')

      const cases = getRecordResources(result.data).map(normalizeCase)
      if (failedWithoutResources(result, cases.length)) {
        return fail(result, 'Failed to fetch CrowdStrike case details')
      }

      return {
        ok: true,
        output: { cases, count: cases.length, errors: getEnvelopeErrors(result.data) },
      }
    }
  }
}

export async function executeCrowdStrikeRequest(
  body: CrowdstrikeQueryBody,
  signal?: AbortSignal
): Promise<OperationResult> {
  signal?.throwIfAborted()
  const baseUrl = getCloudBaseUrl(body.cloud)
  const accessToken = await getAccessToken(body, signal)
  signal?.throwIfAborted()

  logger.info('CrowdStrike request', {
    cloud: body.cloud,
    operation: body.operation,
  })

  if (
    body.operation === 'crowdstrike_query_sensors' ||
    body.operation === 'crowdstrike_get_sensor_details' ||
    body.operation === 'crowdstrike_get_sensor_aggregates'
  ) {
    return executeSensorOperation(body, baseUrl, accessToken, signal)
  }

  return executeCrowdStrikeOperation(body, baseUrl, accessToken, signal)
}
