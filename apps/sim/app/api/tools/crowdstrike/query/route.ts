import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { crowdstrikeQueryContract } from '@/lib/api/contracts/tools/crowdstrike'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  CrowdStrikeAuthError,
  type CrowdStrikeCallResult,
  callCrowdStrike,
  getAccessToken,
  getCloudBaseUrl,
  getEnvelopeErrors,
  getFalconErrorMessage,
  getNumber,
  getPagination,
  getRecordArray,
  getRecordResources,
  getString,
  getStringArray,
  getStringResources,
  type JsonRecord,
} from '@/app/api/tools/crowdstrike/query/falcon'
import {
  executeCrowdStrikeOperation,
  failedWithoutResources,
  failureStatus,
} from '@/app/api/tools/crowdstrike/query/operations'
import type {
  CrowdStrikeQuerySensorsParams,
  CrowdStrikeSensorAggregateBucket,
  CrowdStrikeSensorAggregateResult,
} from '@/tools/crowdstrike/types'

const logger = createLogger('CrowdStrikeAPI')

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
    errors: getEnvelopeErrors(data),
    pagination: paginationData == null ? null : getPagination(paginationData),
    sensors,
  }
}

/**
 * CrowdStrike answers 200 while the envelope carries only errors. Mirrors the
 * shared operation executor so the Identity Protection branches cannot report a
 * resource-less error envelope as a success.
 */
function envelopeFailureResponse(
  result: CrowdStrikeCallResult,
  resourceCount: number,
  fallback: string
) {
  if (!failedWithoutResources(result, resourceCount)) {
    return null
  }

  return NextResponse.json(
    { success: false, error: getFalconErrorMessage(result.data, fallback) },
    { status: failureStatus(result) }
  )
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

/**
 * Special route: this proxies workflow tool calls to CrowdStrike Falcon with the
 * caller's own API credentials, so it authenticates through `checkInternalAuth`
 * rather than an application use case and uses raw `withRouteHandler`.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
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

    logger.info('CrowdStrike request', {
      cloud: params.cloud,
      operation: params.operation,
    })

    if (params.operation === 'crowdstrike_query_sensors') {
      const queryResponse = await callCrowdStrike(baseUrl, accessToken, {
        method: 'GET',
        path: '/identity-protection/queries/devices/v1',
        query: sensorQuery(params),
      })

      if (!queryResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            error: getFalconErrorMessage(queryResponse.data, 'CrowdStrike request failed'),
          },
          { status: queryResponse.status }
        )
      }

      const ids = getStringResources(queryResponse.data)
      const queryFailure = envelopeFailureResponse(
        queryResponse,
        ids.length,
        'Failed to query CrowdStrike sensors'
      )
      if (queryFailure) return queryFailure

      if (ids.length === 0) {
        return NextResponse.json({
          success: true,
          output: normalizeSensorsOutput({ resources: [] }, queryResponse.data),
        })
      }

      const detailResponse = await callCrowdStrike(baseUrl, accessToken, {
        method: 'POST',
        path: '/identity-protection/entities/devices/GET/v1',
        body: { ids },
      })

      if (!detailResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            error: getFalconErrorMessage(
              detailResponse.data,
              'Failed to fetch CrowdStrike sensor details'
            ),
          },
          { status: detailResponse.status }
        )
      }

      const detailFailure = envelopeFailureResponse(
        detailResponse,
        getRecordResources(detailResponse.data).length,
        'Failed to fetch CrowdStrike sensor details'
      )
      if (detailFailure) return detailFailure

      return NextResponse.json({
        success: true,
        output: normalizeSensorsOutput(detailResponse.data, queryResponse.data),
      })
    }

    if (params.operation === 'crowdstrike_get_sensor_details') {
      const detailResponse = await callCrowdStrike(baseUrl, accessToken, {
        method: 'POST',
        path: '/identity-protection/entities/devices/GET/v1',
        body: { ids: params.ids },
      })

      if (!detailResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            error: getFalconErrorMessage(
              detailResponse.data,
              'Failed to fetch CrowdStrike sensor details'
            ),
          },
          { status: detailResponse.status }
        )
      }

      const detailsFailure = envelopeFailureResponse(
        detailResponse,
        getRecordResources(detailResponse.data).length,
        'Failed to fetch CrowdStrike sensor details'
      )
      if (detailsFailure) return detailsFailure

      return NextResponse.json({
        success: true,
        output: normalizeSensorsOutput(detailResponse.data),
      })
    }

    if (params.operation === 'crowdstrike_get_sensor_aggregates') {
      const aggregateResponse = await callCrowdStrike(baseUrl, accessToken, {
        method: 'POST',
        path: '/identity-protection/aggregates/devices/GET/v1',
        body: params.aggregateQuery,
      })

      if (!aggregateResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            error: getFalconErrorMessage(
              aggregateResponse.data,
              'Failed to fetch CrowdStrike sensor aggregates'
            ),
          },
          { status: aggregateResponse.status }
        )
      }

      const aggregateFailure = envelopeFailureResponse(
        aggregateResponse,
        getRecordResources(aggregateResponse.data).length,
        'Failed to fetch CrowdStrike sensor aggregates'
      )
      if (aggregateFailure) return aggregateFailure

      return NextResponse.json({
        success: true,
        output: normalizeAggregatesOutput(aggregateResponse.data),
      })
    }

    const result = await executeCrowdStrikeOperation(params, baseUrl, accessToken)
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status || 502 }
      )
    }

    return NextResponse.json({ success: true, output: result.output })
  } catch (error) {
    const message = toError(error).message

    /**
     * The token exchange runs before the operation dispatch, so without this a
     * bad client ID or secret (Falcon 401) reaches the caller as a 500.
     */
    if (error instanceof CrowdStrikeAuthError) {
      logger.warn('CrowdStrike authentication failed', { error: message, status: error.status })
      return NextResponse.json({ success: false, error: message }, { status: error.status })
    }

    logger.error('CrowdStrike request failed', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
