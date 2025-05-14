/**
 * Sim Studio Telemetry - Server-side Instrumentation
 *
 * This file can be customized in forked repositories:
 * - Set TELEMETRY_ENDPOINT env var to your collector
 * - Modify exporter configuration as needed
 *
 * Please maintain ethical telemetry practices if modified.
 */
// This file enables OpenTelemetry instrumentation for Next.js
// See: https://nextjs.org/docs/app/building-your-application/optimizing/open-telemetry
// Set experimental.instrumentationHook = true in next.config.ts to enable this
import { createLogger } from '@/lib/logs/console-logger'
import { env } from './lib/env'

const Sentry =
  env.NODE_ENV === 'production' ? require('@sentry/nextjs') : { captureRequestError: () => {} }

const logger = createLogger('OtelInstrumentation')

const DEFAULT_TELEMETRY_CONFIG = {
  endpoint: env.TELEMETRY_ENDPOINT || 'https://telemetry.simstudio.ai/v1/traces',
  serviceName: 'sim-studio',
  serviceVersion: '0.1.0',
  serverSide: { enabled: true },
  batchSettings: {
    maxQueueSize: 100,
    maxExportBatchSize: 10,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000,
  },
}

export async function register() {
  if (env.NODE_ENV === 'production') {
    if (env.NEXT_RUNTIME === 'nodejs') {
      await import('./sentry.server.config')
    }

    if (env.NEXT_RUNTIME === 'edge') {
      await import('./sentry.edge.config')
    }
  }

  // Skip OpenTelemetry instrumentation completely to avoid Node.js API issues with ESM
  logger.info('OpenTelemetry instrumentation is disabled for ESM compatibility')
  return
}

export const onRequestError = Sentry.captureRequestError
