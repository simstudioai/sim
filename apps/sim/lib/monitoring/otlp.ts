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
