/**
 * Parse OTLP headers per the OTEL spec format `key1=value1,key2=value2`.
 * Values are URL-decoded; the raw value is preserved if decoding fails.
 * Keys and values are trimmed; empty or malformed entries are skipped.
 * @see https://opentelemetry.io/docs/specs/otel/protocol/exporter/
 */
export function parseOtlpHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!key) continue
    const rawVal = trimmed.slice(eq + 1).trim()
    let val = rawVal
    try {
      val = decodeURIComponent(rawVal)
    } catch {
      // value wasn't URL-encoded; keep as-is.
    }
    out[key] = val
  }
  return out
}

/**
 * Sim's anonymous telemetry collector, used when no collector is configured. It receives traces
 * only: logs and metrics carry an instance's own operational detail and go only to a collector
 * its operator chose.
 */
export const ANONYMOUS_TELEMETRY_ENDPOINT = 'https://telemetry.simstudio.ai/v1/traces'

/** True when the operator turned telemetry off (`NEXT_TELEMETRY_DISABLED=1`). */
export function isTelemetryDisabled(): boolean {
  return process.env.NEXT_TELEMETRY_DISABLED === '1'
}

/** True when `endpoint` names the anonymous collector's host, however the URL is spelled. */
function isAnonymousCollector(endpoint: string): boolean {
  try {
    return new URL(endpoint).host === new URL(ANONYMOUS_TELEMETRY_ENDPOINT).host
  } catch {
    return false
  }
}

/**
 * The collector this process sends telemetry to: `OTEL_EXPORTER_OTLP_ENDPOINT`, then the legacy
 * `TELEMETRY_ENDPOINT`, then `fallback` (a fork's `telemetry.config.ts` endpoint, or the anonymous
 * collector). `OTEL_EXPORTER_OTLP_HEADERS` belong to the operator's own collector, so they are
 * never sent to the anonymous one.
 */
export function resolveOtlpTarget(fallback: string = ANONYMOUS_TELEMETRY_ENDPOINT): {
  endpoint: string
  headers: Record<string, string>
  anonymous: boolean
} {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.TELEMETRY_ENDPOINT || fallback
  const anonymous = isAnonymousCollector(endpoint)
  return {
    endpoint,
    headers: anonymous ? {} : parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS || ''),
    anonymous,
  }
}

/**
 * Appends `/v1/traces` to an OTLP base URL's path unless it already ends there (with or without a
 * trailing slash), keeping any query string. The HTTP exporter doesn't auto-suffix the signal path
 * even though the spec says the env var is a base URL.
 */
export function normalizeOtlpTracesUrl(url: string): string {
  if (!url) return url
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    u.pathname = path.endsWith('/v1/traces') ? path : `${path}/v1/traces`
    return u.toString()
  } catch {
    return url
  }
}
