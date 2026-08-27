import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'

/**
 * Jotform serves the same REST surface from three regional hosts, and an API key
 * is only valid on the host that issued it. See https://api.jotform.com/docs/
 */
const JOTFORM_REGION_HOSTS: Record<string, string> = {
  us: 'https://api.jotform.com',
  eu: 'https://eu-api.jotform.com',
  hipaa: 'https://hipaa-api.jotform.com',
}

const DEFAULT_REGION = 'us'

export interface JotformScope {
  apiKey: string
  region?: string
}

/** The envelope every Jotform endpoint wraps its payload in. */
export interface JotformEnvelope {
  content: unknown
  resultSet: JotformResultSet | null
  limitLeft: number | null
  message: string | null
}

export interface JotformResultSet {
  offset: number | null
  limit: number | null
  count: number | null
}

/** Empty strings arrive from untouched subblocks and must not reach the API as values. */
export function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Reads a required path segment, failing loudly rather than building `/form//questions`. */
export function requireValue(value: unknown, field: string): string {
  const trimmed = trimOrUndefined(value)
  if (!trimmed) throw new Error(`${field} is required.`)
  return trimmed
}

export function buildJotformUrl(params: JotformScope, path: string): URL {
  const host = JOTFORM_REGION_HOSTS[(params.region || DEFAULT_REGION).trim().toLowerCase()]
  if (!host) {
    throw new Error(`Unknown Jotform region "${params.region}". Use "us", "eu", or "hipaa".`)
  }
  return new URL(`${host}/${path.replace(/^\/+/, '')}`)
}

export function buildJotformHeaders(apiKey: string): Record<string, string> {
  return { APIKEY: apiKey.trim() }
}

/**
 * Jotform answers with HTTP 200 and a `responseCode` in the body for many failures,
 * so the body has to be inspected even when `response.ok` is true.
 */
export async function parseJotformResponse(
  response: Response,
  label: string
): Promise<JotformEnvelope> {
  const text = await response.text()
  let data: Record<string, unknown> | null = null
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null
  } catch {
    data = null
  }

  const message = typeof data?.message === 'string' ? data.message : null
  /* Jotform types `responseCode` inconsistently across endpoints, quoting it on some,
     so a `typeof === 'number'` test would skip the check on the quoted ones. */
  const responseCode = toNumberOrNull(data?.responseCode)

  if (!response.ok || (responseCode !== null && (responseCode < 200 || responseCode >= 300))) {
    const status = responseCode ?? response.status
    /* An error body is not always the documented JSON envelope — an upstream gateway
       can return an HTML page — so the raw fallback is capped before it becomes the
       error message. */
    const detail = message || truncate(text, 300) || response.statusText
    throw new Error(`${label} error (${status}): ${detail}`)
  }

  const rawResultSet = data?.resultSet as Record<string, unknown> | undefined
  const limitLeft = data?.['limit-left']

  return {
    content: data?.content ?? null,
    resultSet: rawResultSet
      ? {
          offset: toNumberOrNull(rawResultSet.offset),
          limit: toNumberOrNull(rawResultSet.limit),
          count: toNumberOrNull(rawResultSet.count),
        }
      : null,
    limitLeft: toNumberOrNull(limitLeft),
    message,
  }
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `json` params arrive parsed from the block but as a raw JSON string when a tool is
 * called straight from the registry, so object bodies normalize both shapes.
 */
export function toJsonObject(
  value: Record<string, unknown> | string | undefined,
  field: string
): Record<string, unknown> {
  if (value === undefined || value === null || value === '') return {}
  if (isRecord(value)) return value

  let parsed: unknown
  try {
    parsed = JSON.parse(value as string)
  } catch (error) {
    throw new Error(`Invalid JSON input for ${field}: ${getErrorMessage(error)}`)
  }

  if (!isRecord(parsed)) {
    throw new Error(`Expected ${field} to be a JSON object.`)
  }

  return parsed
}

/** Same as `toJsonObject`, but for params documented as arrays. */
export function toJsonArray(value: unknown[] | string | undefined, field: string): unknown[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return value

  let parsed: unknown
  try {
    parsed = JSON.parse(value as string)
  } catch (error) {
    throw new Error(`Invalid JSON input for ${field}: ${getErrorMessage(error)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${field} to be a JSON array.`)
  }

  return parsed
}

/**
 * Jotform's POST endpoints read PHP-style bracket notation — `submission[3][first]`,
 * `question[text]`, `properties[formWidth]` — rather than a JSON body, so nested
 * objects are flattened into bracketed keys before form encoding.
 */
export function toFormBody(fields: Record<string, unknown>): string {
  const pairs: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    appendFormPairs(pairs, key, value)
  }
  return pairs.join('&')
}

function appendFormPairs(pairs: string[], key: string, value: unknown): void {
  if (value === undefined || value === null) return

  if (Array.isArray(value)) {
    value.forEach((entry, index) => appendFormPairs(pairs, `${key}[${index}]`, entry))
    return
  }

  if (isRecord(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendFormPairs(pairs, `${key}[${childKey}]`, childValue)
    }
    return
  }

  pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
}

/**
 * Form-encoded bodies must declare their content type so the shared transport passes
 * the preformatted string through instead of re-serializing it as JSON.
 */
export function jotformFormHeaders(apiKey: string): Record<string, string> {
  return {
    ...buildJotformHeaders(apiKey),
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

/**
 * Control keys a submission body carries alongside its answers. `created_at` is the
 * one that looks like a `{qid}_{subfield}` pair and is not one, which is why the
 * official PHP SDK special-cases it by name rather than by shape.
 */
const SUBMISSION_CONTROL_KEYS = new Set(['created_at', 'new', 'flag', 'status', 'ip'])

/**
 * Expands the `{qid}_{subfield}` shorthand Jotform documents (`1_first`) into the
 * nested form its API actually reads (`submission[1][first]`). Both official SDKs
 * perform this same split, and users copy the shorthand straight out of the docs, so
 * an already-nested object and the flat shorthand have to mean the same thing.
 */
export function normalizeSubmissionAnswers(
  answers: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(answers)) {
    const separator = key.indexOf('_')
    if (separator <= 0 || SUBMISSION_CONTROL_KEYS.has(key)) {
      normalized[key] = value
      continue
    }

    const qid = key.slice(0, separator)
    const subField = key.slice(separator + 1)
    const existing = normalized[qid]
    const target = isRecord(existing) ? existing : {}
    target[subField] = value
    normalized[qid] = target
  }

  return normalized
}

/** Applies the pagination and filter query shared by every Jotform list endpoint. */
export function applyListQuery(
  url: URL,
  params: {
    offset?: string
    limit?: string
    orderby?: string
    direction?: string
    filter?: Record<string, unknown> | string
  }
): void {
  const offset = trimOrUndefined(params.offset)
  const limit = trimOrUndefined(params.limit)
  const orderby = trimOrUndefined(params.orderby)
  const direction = trimOrUndefined(params.direction)

  if (offset) url.searchParams.set('offset', offset)
  if (limit) url.searchParams.set('limit', limit)
  if (orderby) url.searchParams.set('orderby', orderby)
  if (direction) url.searchParams.set('direction', direction.toUpperCase())

  const filter = toJsonObject(params.filter, 'filter')
  if (Object.keys(filter).length > 0) url.searchParams.set('filter', JSON.stringify(filter))
}
