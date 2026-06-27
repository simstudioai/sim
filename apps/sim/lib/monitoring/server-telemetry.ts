import { env } from '@/lib/core/config/env'
import { isDev } from '@/lib/core/config/env-flags'

export const DEFAULT_TELEMETRY_ENDPOINT = 'https://telemetry.simstudio.ai/v1/traces'

/**
 * Returns true when the OTLP endpoint targets a remote collector (not localhost).
 */
export function isRemoteTelemetryEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname
    return !/^(localhost|127\.0\.0\.1)$/i.test(hostname)
  } catch {
    return true
  }
}

/**
 * Resolves the configured OTLP traces endpoint, if any.
 */
export function resolveTelemetryEndpoint(fallback = DEFAULT_TELEMETRY_ENDPOINT): string {
  return (
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.TELEMETRY_ENDPOINT ||
    env.TELEMETRY_ENDPOINT ||
    fallback
  )
}

/**
 * Whether server-side telemetry export should run in this process.
 * Skips the hosted collector in local dev unless an endpoint is explicitly configured.
 */
export function isServerTelemetryEnabled(): boolean {
  if (env.NEXT_TELEMETRY_DISABLED === '1' || process.env.NEXT_TELEMETRY_DISABLED === '1') {
    return false
  }

  const explicitEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.TELEMETRY_ENDPOINT ||
    env.TELEMETRY_ENDPOINT

  if (explicitEndpoint) {
    return true
  }

  return !isDev
}
