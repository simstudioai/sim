/**
 * Shared request/response helpers for the Cloudflare API tools.
 *
 * Every Cloudflare v4 endpoint answers with the same envelope:
 * `{ success, errors, messages, result }`. A `200 OK` carrying
 * `success: false` is a failure, so callers must always branch on
 * `data.success` rather than on the HTTP status.
 */

import type {
  CloudflareEnvelope,
  CloudflareRawAccessApplication,
  CloudflareRawAccessPolicy,
  CloudflareRawRuleset,
} from '@/tools/cloudflare/types'

/**
 * Reads a Cloudflare v4 response body into the shared envelope shape, so the
 * caller branches on a typed `success` flag and reads `result` through a checked
 * payload type instead of an implicitly-`any` `response.json()`. Used by the
 * tools whose `result` has a payload type in `types.ts`.
 */
export async function readCloudflareResponse<TResult>(
  response: Response
): Promise<CloudflareEnvelope<TResult>> {
  return (await response.json()) as CloudflareEnvelope<TResult>
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
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/** Splits a comma-separated string param into a trimmed, non-empty list. */
export function parseCsvParam(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

/**
 * Maps a Cloudflare ruleset `result` payload onto the flat ruleset output shape
 * shared by the get-ruleset, phase-entrypoint, and rule mutation tools — every
 * one of those endpoints answers with the full ruleset object.
 */
export function mapRuleset(ruleset: CloudflareRawRuleset | undefined) {
  return {
    id: ruleset?.id ?? '',
    name: ruleset?.name ?? '',
    description: ruleset?.description ?? '',
    kind: ruleset?.kind ?? '',
    phase: ruleset?.phase ?? '',
    version: ruleset?.version ?? null,
    last_updated: ruleset?.last_updated ?? null,
    rules: Array.isArray(ruleset?.rules)
      ? ruleset.rules.map((rule) => ({
          id: rule.id ?? '',
          version: rule.version ?? null,
          action: rule.action ?? '',
          action_parameters: rule.action_parameters ?? null,
          expression: rule.expression ?? '',
          description: rule.description ?? '',
          enabled: rule.enabled ?? false,
          ref: rule.ref ?? null,
          last_updated: rule.last_updated ?? null,
          categories: rule.categories ?? [],
          logging: rule.logging ?? null,
          ratelimit: rule.ratelimit ?? null,
        }))
      : [],
  }
}

/** The empty ruleset payload returned alongside an error. */
export function emptyRuleset() {
  return {
    id: '',
    name: '',
    description: '',
    kind: '',
    phase: '',
    version: null,
    last_updated: null,
    rules: [],
  }
}

/** Maps a Cloudflare Access application `result` payload onto the flat output shape. */
export function mapAccessApplication(app: CloudflareRawAccessApplication | undefined) {
  return {
    id: app?.id ?? '',
    name: app?.name ?? null,
    domain: app?.domain ?? null,
    type: app?.type ?? null,
    aud: app?.aud ?? null,
    session_duration: app?.session_duration ?? null,
    allowed_idps: app?.allowed_idps ?? null,
    app_launcher_visible: app?.app_launcher_visible ?? null,
    auto_redirect_to_identity: app?.auto_redirect_to_identity ?? null,
    custom_deny_message: app?.custom_deny_message ?? null,
    custom_deny_url: app?.custom_deny_url ?? null,
    logo_url: app?.logo_url ?? null,
    self_hosted_domains: app?.self_hosted_domains ?? null,
    destinations: app?.destinations ?? null,
    tags: app?.tags ?? null,
    policies: app?.policies ?? null,
  }
}

/** The empty Access application payload returned alongside an error. */
export function emptyAccessApplication() {
  return {
    id: '',
    name: null,
    domain: null,
    type: null,
    aud: null,
    session_duration: null,
    allowed_idps: null,
    app_launcher_visible: null,
    auto_redirect_to_identity: null,
    custom_deny_message: null,
    custom_deny_url: null,
    logo_url: null,
    self_hosted_domains: null,
    destinations: null,
    tags: null,
    policies: null,
  }
}

/** Maps a Cloudflare Access policy `result` payload onto the flat output shape. */
export function mapAccessPolicy(policy: CloudflareRawAccessPolicy | undefined) {
  return {
    id: policy?.id ?? '',
    name: policy?.name ?? null,
    decision: policy?.decision ?? null,
    precedence: policy?.precedence ?? null,
    include: policy?.include ?? null,
    exclude: policy?.exclude ?? null,
    require: policy?.require ?? null,
    session_duration: policy?.session_duration ?? null,
    approval_required: policy?.approval_required ?? null,
    isolation_required: policy?.isolation_required ?? null,
    purpose_justification_required: policy?.purpose_justification_required ?? null,
    purpose_justification_prompt: policy?.purpose_justification_prompt ?? null,
    created_at: policy?.created_at ?? null,
    updated_at: policy?.updated_at ?? null,
  }
}

/** The empty Access policy payload returned alongside an error. */
export function emptyAccessPolicy() {
  return {
    id: '',
    name: null,
    decision: null,
    precedence: null,
    include: null,
    exclude: null,
    require: null,
    session_duration: null,
    approval_required: null,
    isolation_required: null,
    purpose_justification_required: null,
    purpose_justification_prompt: null,
    created_at: null,
    updated_at: null,
  }
}

/**
 * The zone settings "Get Zone Settings" reads when the caller names none.
 *
 * Cloudflare deprecated the batch `GET /zones/{zone_id}/settings` endpoint,
 * which reaches end of life on 2027-03-31, and directs integrations at the
 * per-setting `GET /zones/{zone_id}/settings/{setting_id}` endpoint. "Read the
 * zone's settings" is therefore a fan-out over an explicit, bounded list rather
 * than one request.
 * https://developers.cloudflare.com/fundamentals/api/reference/deprecations/
 */
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
