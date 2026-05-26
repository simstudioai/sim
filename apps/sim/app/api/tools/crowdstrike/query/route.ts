import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { crowdstrikeQueryContract } from '@/lib/api/contracts/tools/crowdstrike'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type {
  CrowdStrikeAggregateQuery,
  CrowdStrikeBaseParams,
  CrowdStrikeCloud,
  CrowdStrikeQuerySensorsParams,
  CrowdStrikeSensorAggregateBucket,
  CrowdStrikeSensorAggregateResult,
} from '@/tools/crowdstrike/types'

const logger = createLogger('CrowdStrikeIdentityProtectionAPI')

type JsonRecord = Record<string, unknown>

function getCloudBaseUrl(cloud: CrowdStrikeCloud): string {
  const cloudMap: Record<CrowdStrikeCloud, string> = {
    'eu-1': 'https://api.eu-1.crowdstrike.com',
    'us-1': 'https://api.crowdstrike.com',
    'us-2': 'https://api.us-2.crowdstrike.com',
    'us-gov-1': 'https://api.laggar.gcw.crowdstrike.com',
    'us-gov-2': 'https://api.us-gov-2.crowdstrike.mil',
  }

  return cloudMap[cloud]
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function getRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isJsonRecord)
}

function getResourcesArray(data: unknown): unknown[] {
  const root = getResponseRoot(data)
  if (!isJsonRecord(root) || !Array.isArray(root.resources)) {
    return []
  }

  return root.resources
}

function getRecordResources(data: unknown): JsonRecord[] {
  return getResourcesArray(data).filter(isJsonRecord)
}

function getStringResources(data: unknown): string[] {
  return getStringArray(getResourcesArray(data))
}

function getResponseRoot(data: unknown): unknown {
  if (!isJsonRecord(data)) {
    return null
  }

  if (isJsonRecord(data.body)) {
    return data.body
  }

  return data
}

function getPagination(data: unknown) {
  const root = getResponseRoot(data)
  if (!isJsonRecord(root) || !isJsonRecord(root.meta) || !isJsonRecord(root.meta.pagination)) {
    return null
  }

  return {
    limit: getNumber(root.meta.pagination.limit),
    offset: getNumber(root.meta.pagination.offset),
    total: getNumber(root.meta.pagination.total),
  }
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (!isJsonRecord(data)) {
    return fallback
  }

  const errors = Array.isArray(data.errors) ? data.errors : []
  const firstError = errors[0]
  if (isJsonRecord(firstError)) {
    const firstMessage = getString(firstError.message) ?? getString(firstError.code)
    if (firstMessage) {
      return firstMessage
    }
  }

  return (
    getString(data.message) ??
    getString(data.error_description) ??
    getString(data.error) ??
    fallback
  )
}

function buildQueryUrl(baseUrl: string, params: CrowdStrikeQuerySensorsParams): string {
  const url = new URL(baseUrl)
  url.pathname = '/identity-protection/queries/devices/v1'

  if (params.filter) {
    url.searchParams.set('filter', params.filter)
  }

  if (params.limit != null) {
    url.searchParams.set('limit', params.limit.toString())
  }

  if (params.offset != null) {
    url.searchParams.set('offset', params.offset.toString())
  }

  if (params.sort) {
    url.searchParams.set('sort', params.sort)
  }

  return url.toString()
}

function buildSensorDetailsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = '/identity-protection/entities/devices/GET/v1'
  return url.toString()
}

function buildSensorAggregatesUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = '/identity-protection/aggregates/devices/GET/v1'
  return url.toString()
}

async function getAccessToken(params: CrowdStrikeBaseParams): Promise<string> {
  const baseUrl = getCloudBaseUrl(params.cloud)
  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'client_credentials',
    }).toString(),
    cache: 'no-store',
  })

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(getErrorMessage(data, 'Failed to authenticate with CrowdStrike'))
  }

  if (!isJsonRecord(data) || typeof data.access_token !== 'string') {
    throw new Error('CrowdStrike authentication did not return an access token')
  }

  return data.access_token
}

function normalizeSensor(resource: JsonRecord) {
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
    pagination: paginationData == null ? null : getPagination(paginationData),
    sensors,
  }
}

function normalizeAggregationResult(resource: JsonRecord): CrowdStrikeSensorAggregateResult {
  return {
    buckets: getRecordArray(resource.buckets).map(normalizeAggregationBucket),
    docCountErrorUpperBound: getNumber(resource.doc_count_error_upper_bound),
    name: getString(resource.name),
    sumOtherDocCount: getNumber(resource.sum_other_doc_count),
  }
}

function normalizeAggregationBucket(resource: JsonRecord): CrowdStrikeSensorAggregateBucket {
  return {
    count: getNumber(resource.count),
    from: getNumber(resource.from),
    keyAsString: getString(resource.key_as_string),
    label: isJsonRecord(resource.label) ? resource.label : null,
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
  }
}

async function postCrowdStrikeJson(
  url: string,
  accessToken: string,
  body: JsonRecord | CrowdStrikeAggregateQuery
) {
  return fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error || 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const parsed = await parseRequest(
      crowdstrikeQueryContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body
    const baseUrl = getCloudBaseUrl(params.cloud)
    const accessToken = await getAccessToken(params)

    logger.info(`[${requestId}] CrowdStrike request`, {
      cloud: params.cloud,
      operation: params.operation,
    })

    if (params.operation === 'crowdstrike_query_sensors') {
      const queryResponse = await fetch(buildQueryUrl(baseUrl, params), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      })

      const queryData: unknown = await queryResponse.json().catch(() => null)
      if (!queryResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            error: getErrorMessage(queryData, 'CrowdStrike request failed'),
          },
          { status: queryResponse.status }
        )
      }

      const ids = getStringResources(queryData)
      if (ids.length === 0) {
        return NextResponse.json({
          success: true,
          output: normalizeSensorsOutput({ resources: [] }, queryData),
        })
      }

      const detailResponse = await postCrowdStrikeJson(
        buildSensorDetailsUrl(baseUrl),
        accessToken,
        { ids }
      )

      const detailData: unknown = await detailResponse.json().catch(() => null)
      if (!detailResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            error: getErrorMessage(detailData, 'Failed to fetch CrowdStrike sensor details'),
          },
          { status: detailResponse.status }
        )
      }

      return NextResponse.json({
        success: true,
        output: normalizeSensorsOutput(detailData, queryData),
      })
    }

    if (params.operation === 'crowdstrike_get_sensor_details') {
      const detailResponse = await postCrowdStrikeJson(
        buildSensorDetailsUrl(baseUrl),
        accessToken,
        { ids: params.ids }
      )

      const detailData: unknown = await detailResponse.json().catch(() => null)
      if (!detailResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            error: getErrorMessage(detailData, 'Failed to fetch CrowdStrike sensor details'),
          },
          { status: detailResponse.status }
        )
      }

      return NextResponse.json({
        success: true,
        output: normalizeSensorsOutput(detailData),
      })
    }

    const aggregateResponse = await postCrowdStrikeJson(
      buildSensorAggregatesUrl(baseUrl),
      accessToken,
      params.aggregateQuery
    )

    const aggregateData: unknown = await aggregateResponse.json().catch(() => null)
    if (!aggregateResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: getErrorMessage(aggregateData, 'Failed to fetch CrowdStrike sensor aggregates'),
        },
        { status: aggregateResponse.status }
      )
    }

    return NextResponse.json({
      success: true,
      output: normalizeAggregatesOutput(aggregateData),
    })
  } catch (error) {
    const message = toError(error).message
    logger.error(`[${requestId}] CrowdStrike request failed`, { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
