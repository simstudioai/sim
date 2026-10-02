import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  PowerBIDataset,
  PowerBIQueryError,
  PowerBIRefresh,
  PowerBIReport,
  PowerBIWorkspace,
} from '@/tools/powerbi/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const MAX_POWERBI_RESPONSE_BYTES = 20 * 1024 * 1024

export const POWERBI_ACCESS_TOKEN_PARAM = {
  type: 'string',
  required: true,
  visibility: 'hidden',
  description: 'Power BI OAuth access token',
} as const

export const POWERBI_GROUP_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Power BI workspace ID',
} as const

export const POWERBI_DATASET_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Power BI semantic model ID (dataset ID in the REST API)',
} as const

export function powerBIUrl(
  pathSegments: readonly string[],
  query: Readonly<Record<string, string | number | undefined>> = {}
): string {
  const path = pathSegments.map((segment) => safeUrlPathSegment(segment, 'Power BI path segment'))
  const url = new URL(`https://api.powerbi.com/v1.0/myorg/${path.join('/')}`)
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(name, String(value))
  }
  return url.toString()
}

export function powerBIHeaders(accessToken: string): Record<string, string> {
  if (!accessToken?.trim()) throw new Error('Power BI access token is required')
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

export async function readPowerBIJson<T = unknown>(
  response: Response,
  signal?: AbortSignal
): Promise<T> {
  return readResponseJsonWithLimit<T>(response, {
    maxBytes: MAX_POWERBI_RESPONSE_BYTES,
    label: 'Power BI response',
    signal,
  })
}

export function powerBIInteger(
  value: number | undefined,
  name: string,
  minimum: number
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < minimum || value > 2_147_483_647) {
    throw new Error(`${name} must be an integer between ${minimum} and 2147483647`)
  }
  return value
}

export function powerBIRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecordLike(value)) throw new Error(`Power BI returned an invalid ${name}`)
  return value
}

export function powerBIOptionalArray(value: unknown, name: string): unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`Power BI returned an invalid ${name}`)
  return value
}

export function powerBICollection(value: unknown): unknown[] {
  const data = powerBIRecord(value, 'collection')
  if (!Array.isArray(data.value)) throw new Error('Power BI returned an invalid collection value')
  return data.value
}

function powerBIResourceString(value: unknown, resource: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid Power BI ${resource} response: ${field} must be a non-empty string`)
  }
  return value
}

export function projectPowerBIWorkspace(value: unknown): PowerBIWorkspace {
  const data = powerBIRecord(value, 'workspace')
  return {
    id: powerBIResourceString(data.id, 'workspace', 'id'),
    name: powerBIResourceString(data.name, 'workspace', 'name'),
    isReadOnly: toBooleanOrNull(data.isReadOnly),
    isOnDedicatedCapacity: toBooleanOrNull(data.isOnDedicatedCapacity),
    capacityId: toStringOrNull(data.capacityId),
    defaultDatasetStorageFormat: toStringOrNull(data.defaultDatasetStorageFormat),
  }
}

export function projectPowerBIReport(value: unknown): PowerBIReport {
  const data = powerBIRecord(value, 'report')
  return {
    id: powerBIResourceString(data.id, 'report', 'id'),
    name: powerBIResourceString(data.name, 'report', 'name'),
    datasetId: toStringOrNull(data.datasetId),
    reportType: toStringOrNull(data.reportType),
    webUrl: toStringOrNull(data.webUrl),
    embedUrl: toStringOrNull(data.embedUrl),
    description: toStringOrNull(data.description),
  }
}

export function projectPowerBIDataset(value: unknown): PowerBIDataset {
  const data = powerBIRecord(value, 'semantic model')
  return {
    id: powerBIResourceString(data.id, 'semantic model', 'id'),
    name: powerBIResourceString(data.name, 'semantic model', 'name'),
    createdDate: toStringOrNull(data.createdDate),
    description: toStringOrNull(data.description),
    targetStorageMode: toStringOrNull(data.targetStorageMode),
    configuredBy: toStringOrNull(data.configuredBy),
    isRefreshable: toBooleanOrNull(data.isRefreshable),
    isEffectiveIdentityRequired: toBooleanOrNull(data.isEffectiveIdentityRequired),
    isEffectiveIdentityRolesRequired: toBooleanOrNull(data.isEffectiveIdentityRolesRequired),
    isOnPremGatewayRequired: toBooleanOrNull(data.isOnPremGatewayRequired),
    addRowsAPIEnabled: toBooleanOrNull(data.addRowsAPIEnabled),
    webUrl: toStringOrNull(data.webUrl),
  }
}

export function projectPowerBIRefresh(value: unknown): PowerBIRefresh {
  const data = powerBIRecord(value, 'refresh history entry')
  return {
    requestId: toStringOrNull(data.requestId),
    refreshType: toStringOrNull(data.refreshType),
    status: toStringOrNull(data.status),
    startTime: toStringOrNull(data.startTime),
    endTime: toStringOrNull(data.endTime),
    serviceExceptionJson: toStringOrNull(data.serviceExceptionJson),
    refreshAttempts: powerBIOptionalArray(data.refreshAttempts, 'refresh attempt list').map(
      (value) => {
        const attempt = powerBIRecord(value, 'refresh attempt')
        return {
          attemptId: toNumberOrNull(attempt.attemptId),
          type: toStringOrNull(attempt.type),
          startTime: toStringOrNull(attempt.startTime),
          endTime: toStringOrNull(attempt.endTime),
          serviceExceptionJson: toStringOrNull(attempt.serviceExceptionJson),
        }
      }
    ),
  }
}

export function appendPowerBIQueryError(
  errors: PowerBIQueryError[],
  value: unknown,
  scope: PowerBIQueryError['scope']
): void {
  if (value === undefined || value === null) return
  const error = powerBIRecord(value, 'query error')
  const diagnostic = isRecordLike(error['pbi.error']) ? error['pbi.error'] : null
  const details = error.details ?? diagnostic?.details ?? null
  let message = toStringOrNull(error.message) ?? toStringOrNull(diagnostic?.message)
  if (message === null && Array.isArray(details)) {
    for (const entry of details) {
      if (
        isRecordLike(entry) &&
        entry.code === 'DetailsMessage' &&
        isRecordLike(entry.detail) &&
        typeof entry.detail.value === 'string' &&
        entry.detail.value.trim()
      ) {
        message = entry.detail.value
        break
      }
    }
  }
  errors.push({
    scope,
    code: toStringOrNull(error.code) ?? toStringOrNull(diagnostic?.code),
    message,
    details,
  })
}
