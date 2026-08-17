import { isRecordLike } from '@sim/utils/object'
import type { CrowdStrikeBaseParams, CrowdStrikeCloud } from '@/tools/crowdstrike/types'

export type JsonRecord = Record<string, unknown>

const CLOUD_BASE_URLS: Record<CrowdStrikeCloud, string> = {
  'eu-1': 'https://api.eu-1.crowdstrike.com',
  'us-1': 'https://api.crowdstrike.com',
  'us-2': 'https://api.us-2.crowdstrike.com',
  'us-3': 'https://api.us-3.crowdstrike.com',
  'us-gov-1': 'https://api.laggar.gcw.crowdstrike.com',
  'us-gov-2': 'https://api.us-gov-2.crowdstrike.mil',
}

export function getCloudBaseUrl(cloud: CrowdStrikeCloud): string {
  return CLOUD_BASE_URLS[cloud]
}

export function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function getNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

export function getBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

export function getRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecordLike)
}

export function getRecord(value: unknown): JsonRecord | null {
  return isRecordLike(value) ? value : null
}

/**
 * Every Falcon endpoint this integration calls answers with a flat
 * `{ meta, resources, errors }` envelope, so the envelope readers below and
 * `getFalconErrorMessage` both read the payload root directly.
 */
export function getResourcesArray(data: unknown): unknown[] {
  if (!isRecordLike(data) || !Array.isArray(data.resources)) {
    return []
  }

  return data.resources
}

export function getRecordResources(data: unknown): JsonRecord[] {
  return getResourcesArray(data).filter(isRecordLike)
}

export function getStringResources(data: unknown): string[] {
  return getStringArray(getResourcesArray(data))
}

export function getFirstRecordResource(data: unknown): JsonRecord | null {
  return getRecordResources(data)[0] ?? null
}

export function getPagination(data: unknown) {
  if (!isRecordLike(data) || !isRecordLike(data.meta) || !isRecordLike(data.meta.pagination)) {
    return null
  }

  const { pagination } = data.meta

  return {
    limit: getNumber(pagination.limit),
    offset: getNumber(pagination.offset),
    total: getNumber(pagination.total),
  }
}

/** Offset pagination plus the `after` cursor the IOC Management API returns. */
export function getCursorPagination(data: unknown) {
  if (!isRecordLike(data) || !isRecordLike(data.meta) || !isRecordLike(data.meta.pagination)) {
    return null
  }

  const { pagination } = data.meta

  return {
    after: getString(pagination.after),
    limit: getNumber(pagination.limit),
    offset: getNumber(pagination.offset),
    total: getNumber(pagination.total),
  }
}

/** Spotlight paginates by cursor only — it returns no offset. */
export function getSpotlightPagination(data: unknown) {
  if (!isRecordLike(data) || !isRecordLike(data.meta) || !isRecordLike(data.meta.pagination)) {
    return null
  }

  const { pagination } = data.meta

  return {
    after: getString(pagination.after),
    limit: getNumber(pagination.limit),
    total: getNumber(pagination.total),
  }
}

/**
 * CrowdStrike returns `{ meta, resources, errors }` on every endpoint, and a 200
 * can still carry a populated `errors` array for the IDs that failed.
 */
export function getEnvelopeErrors(data: unknown) {
  if (!isRecordLike(data)) {
    return []
  }

  return getRecordArray(data.errors).map((entry) => ({
    code: getNumber(entry.code),
    id: getString(entry.id),
    message: getString(entry.message),
  }))
}

export function getFalconErrorMessage(data: unknown, fallback: string): string {
  if (!isRecordLike(data)) {
    return fallback
  }

  const errors = Array.isArray(data.errors) ? data.errors : []
  const firstError = errors[0]
  if (isRecordLike(firstError)) {
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

/**
 * Raised when the Falcon OAuth2 token exchange fails. Carries the Falcon status
 * so the route can answer with the real cause (401 for bad credentials) instead
 * of letting a credential problem fall through to a generic 500.
 */
export class CrowdStrikeAuthError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'CrowdStrikeAuthError'
    this.status = status >= 400 && status <= 599 ? status : 502
  }
}

export async function getAccessToken(params: CrowdStrikeBaseParams): Promise<string> {
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
    throw new CrowdStrikeAuthError(
      getFalconErrorMessage(data, 'Failed to authenticate with CrowdStrike'),
      response.status
    )
  }

  if (!isRecordLike(data) || typeof data.access_token !== 'string') {
    throw new CrowdStrikeAuthError('CrowdStrike authentication did not return an access token', 502)
  }

  return data.access_token
}

interface CrowdStrikeRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  repeatedQuery?: Record<string, string[] | undefined>
  body?: unknown
}

export interface CrowdStrikeCallResult {
  ok: boolean
  status: number
  data: unknown
}

export function buildUrl(baseUrl: string, options: CrowdStrikeRequestOptions): string {
  const url = new URL(options.path, baseUrl)

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }

  for (const [key, values] of Object.entries(options.repeatedQuery ?? {})) {
    for (const value of values ?? []) {
      url.searchParams.append(key, value)
    }
  }

  return url.toString()
}

export async function callCrowdStrike(
  baseUrl: string,
  accessToken: string,
  options: CrowdStrikeRequestOptions
): Promise<CrowdStrikeCallResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(buildUrl(baseUrl, options), {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  })

  const data: unknown = await response.json().catch(() => null)

  return { ok: response.ok, status: response.status, data }
}
