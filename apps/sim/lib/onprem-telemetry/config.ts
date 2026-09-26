import { env, isTruthy } from '@/lib/core/config/env'

export const DEFAULT_LOOKBACK_DAYS = 7
export const MAX_LOOKBACK_DAYS = 90

export type OnPremTelemetryConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true
      /** Receiving instance base URL, no trailing slash. */
      endpoint: string
      deploymentId: string
      apiKey: string
      lookbackDays: number
    }

/**
 * Resolves the sender configuration from the environment on every call, so a
 * deployment that flips `ONPREM_TELEMETRY_ENABLED` off takes effect at the
 * next cron tick without a restart. Anything short of a complete
 * configuration reads as disabled — a half-configured deployment never sends.
 */
export function getOnPremTelemetryConfig(): OnPremTelemetryConfig {
  if (!isTruthy(env.ONPREM_TELEMETRY_ENABLED)) {
    return { enabled: false, reason: 'ONPREM_TELEMETRY_ENABLED is not set' }
  }

  const endpoint = env.ONPREM_TELEMETRY_ENDPOINT
  const deploymentId = env.ONPREM_TELEMETRY_DEPLOYMENT_ID
  const apiKey = env.ONPREM_TELEMETRY_API_KEY
  const missing = [
    !endpoint && 'ONPREM_TELEMETRY_ENDPOINT',
    !deploymentId && 'ONPREM_TELEMETRY_DEPLOYMENT_ID',
    !apiKey && 'ONPREM_TELEMETRY_API_KEY',
  ].filter((name): name is string => Boolean(name))
  if (missing.length > 0 || !endpoint || !deploymentId || !apiKey) {
    return { enabled: false, reason: `${missing.join(', ')} not set` }
  }

  const parsedLookback = Number.parseInt(env.ONPREM_TELEMETRY_LOOKBACK_DAYS ?? '', 10)
  const lookbackDays =
    Number.isFinite(parsedLookback) && parsedLookback > 0
      ? Math.min(parsedLookback, MAX_LOOKBACK_DAYS)
      : DEFAULT_LOOKBACK_DAYS

  return {
    enabled: true,
    endpoint: endpoint.replace(/\/+$/, ''),
    deploymentId,
    apiKey,
    lookbackDays,
  }
}
