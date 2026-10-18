import { isRecordLike, toRecord } from '@sim/utils/object'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type { CloudflareEnvelope } from '@/tools/cloudflare/types'
import type { ToolOutputProperty } from '@/tools/types'

/** Reads a Cloudflare response envelope; endpoints with no content handle 204 before calling. */
export async function readCloudflareResponse<TResult>(
  response: Response,
  options?: { allowEmptySuccess: boolean }
): Promise<CloudflareEnvelope<TResult>> {
  let data: unknown
  if (options?.allowEmptySuccess) {
    const body = await response.text()
    if (body.trim() === '') {
      return response.ok
        ? { success: true }
        : {
            success: false,
            errors: [{ message: `Cloudflare returned HTTP ${response.status} with an empty body` }],
          }
    }
    data = JSON.parse(body)
  } else {
    data = await response.json()
  }
  if (!isRecordLike(data)) throw new Error('Cloudflare returned an invalid response envelope')
  return data as CloudflareEnvelope<TResult>
}

/** Standard bearer-token headers for the Cloudflare v4 API. */
export function cloudflareHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

/** Extracts the first error message from a Cloudflare envelope. */
export function cloudflareErrorMessage(data: CloudflareEnvelope, fallback: string): string {
  const message = data.errors?.[0]?.message
  return typeof message === 'string' && message.length > 0 ? message : fallback
}

/**
 * Parses a param that may arrive either as a JSON string (typed into a block
 * field) or as an already-structured value (piped from an upstream block).
 */
export function parseJsonParam(value: unknown, fieldName: string): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${fieldName} must be valid JSON`)
  }
}

/** Parses a param that must resolve to a JSON array. */
export function parseJsonArrayParam(value: unknown, fieldName: string): unknown[] | undefined {
  const parsed = parseJsonParam(value, fieldName)
  if (parsed === undefined) return undefined
  if (!Array.isArray(parsed)) throw new Error(`${fieldName} must be a JSON array`)
  return parsed
}

/** Parses a param that must resolve to a JSON object. */
export function parseJsonObjectParam(
  value: unknown,
  fieldName: string
): Record<string, unknown> | undefined {
  const parsed = parseJsonParam(value, fieldName)
  if (parsed === undefined) return undefined
  if (!isRecordLike(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/** Reads a comma-separated list or an explicit JSON string array, including [] to clear a list. */
export function parseCsvParam(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value) || (typeof value === 'string' && value.trim().startsWith('['))) {
    const items = parseJsonArrayParam(value, 'List')
    if (!items?.every((item) => typeof item === 'string'))
      throw new Error('List must contain strings')
    return items
  }
  if (typeof value !== 'string')
    throw new Error('List must be comma-separated text or a JSON string array')
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

type CloudflareValue<T> = T extends { type: 'string' }
  ? string
  : T extends { type: 'number' }
    ? number
    : T extends { type: 'boolean' }
      ? boolean
      : T extends { type: 'array'; items: infer I }
        ? CloudflareValue<I>[]
        : T extends { properties: infer P }
          ? { [K in keyof P]?: CloudflareValue<P[K]> | null }
          : unknown

export type CloudflareOutput<T extends Record<string, ToolOutputProperty>> = {
  [K in keyof T]: T[K] extends { type: 'array' }
    ? CloudflareValue<T[K]>
    : CloudflareValue<T[K]> | null
}

/** Projects documented provider fields, retaining absent arrays as empty lists and scalars as null. */
export function mapCloudflareFields<T extends Record<string, ToolOutputProperty>>(
  value: unknown,
  outputs: T
): CloudflareOutput<T> {
  const record = toRecord(value)
  return Object.fromEntries(
    Object.entries(outputs).map(([key, field]) => [
      key,
      field.type === 'array'
        ? Array.isArray(record[key])
          ? record[key]
          : []
        : (record[key] ?? null),
    ])
  ) as CloudflareOutput<T>
}

export const DEFAULT_ZONE_SETTING_IDS = [
  'ssl',
  'always_use_https',
  'min_tls_version',
  'tls_1_3',
  'security_level',
  'cache_level',
  'browser_cache_ttl',
  'development_mode',
  'rocket_loader',
  'email_obfuscation',
  'hotlink_protection',
  'ip_geolocation',
  'http2',
  'http3',
  'websockets',
]

/** Upper bound on one zone-settings fan-out, so a pasted list cannot become an unbounded burst. */
export const MAX_ZONE_SETTING_IDS = 40

/** Resolves the requested zone setting ids, falling back to the default read set. */
export function requestedZoneSettingIds(settingIds: unknown): string[] {
  return parseCsvParam(settingIds) ?? DEFAULT_ZONE_SETTING_IDS
}

/** Appends a query param when the value is present and non-empty. */
export function appendParam(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return
  url.searchParams.append(key, String(value))
}

/** Preserves the existing per-rule defaults while exposing the documented ruleset fields. */
export function mapCloudflareRuleset(value: unknown) {
  const output = mapCloudflareFields(value, RULESET_OUTPUTS)
  return {
    ...output,
    rules: output.rules.map((rule) => {
      const fields = mapCloudflareFields(rule, RULESET_OUTPUTS.rules.items.properties)
      return {
        ...fields,
        id: fields.id ?? '',
        action: fields.action ?? '',
        expression: fields.expression ?? '',
        description: fields.description ?? '',
        enabled: fields.enabled ?? false,
        categories: fields.categories ?? [],
      }
    }),
  }
}
