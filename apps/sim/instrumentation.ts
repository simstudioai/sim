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

const Sentry =
  process.env.NODE_ENV === 'production'
    ? require('@sentry/nextjs')
    : { captureRequestError: () => {} }

const logger = createLogger('OtelInstrumentation')

const DEFAULT_TELEMETRY_CONFIG = {
  endpoint: process.env.TELEMETRY_ENDPOINT || 'https://telemetry.simstudio.ai/v1/traces',
  serviceName: 'sim-studio',
  serviceVersion: process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0',
  serverSide: { enabled: true },
  batchSettings: {
    maxQueueSize: 100,
    maxExportBatchSize: 10,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000,
  },
}

export async function register() {
  if (process.env.NODE_ENV === 'production') {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      await import('./sentry.server.config')
    }

    if (process.env.NEXT_RUNTIME === 'edge') {
      await import('./sentry.edge.config')
    }
  }

  // OpenTelemetry instrumentation
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      if (process.env.NEXT_TELEMETRY_DISABLED === '1') {
        logger.info('OpenTelemetry telemetry disabled via environment variable')
        return
      }

      let telemetryConfig
      try {
        // Use dynamic import instead of require for ES modules
        telemetryConfig = (await import('./telemetry.config.ts')).default
      } catch (e) {
        telemetryConfig = DEFAULT_TELEMETRY_CONFIG
      }

      if (telemetryConfig.serverSide?.enabled === false) {
        logger.info('Server-side OpenTelemetry instrumentation is disabled in config')
        return
      }

      const { NodeSDK } = await import('@opentelemetry/sdk-node')
      const { resourceFromAttributes } = await import('@opentelemetry/resources')
      const { SemanticResourceAttributes } = await import('@opentelemetry/semantic-conventions')
      const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node')
      const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')

      const exporter = new OTLPTraceExporter({
        url: telemetryConfig.endpoint,
      })

      const spanProcessor = new BatchSpanProcessor(exporter, {
        maxQueueSize:
          telemetryConfig.batchSettings?.maxQueueSize ||
          DEFAULT_TELEMETRY_CONFIG.batchSettings.maxQueueSize,
        maxExportBatchSize:
          telemetryConfig.batchSettings?.maxExportBatchSize ||
          DEFAULT_TELEMETRY_CONFIG.batchSettings.maxExportBatchSize,
        scheduledDelayMillis:
          telemetryConfig.batchSettings?.scheduledDelayMillis ||
          DEFAULT_TELEMETRY_CONFIG.batchSettings.scheduledDelayMillis,
        exportTimeoutMillis:
          telemetryConfig.batchSettings?.exportTimeoutMillis ||
          DEFAULT_TELEMETRY_CONFIG.batchSettings.exportTimeoutMillis,
      })

      const configResource = resourceFromAttributes({
        [SemanticResourceAttributes.SERVICE_NAME]: telemetryConfig.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: telemetryConfig.serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
      })

      const sdk = new NodeSDK({
        resource: configResource,
        spanProcessors: [spanProcessor],
      })

      sdk.start()

      const shutdownHandler = async () => {
        await sdk
          .shutdown()
          .then(() => logger.info('OpenTelemetry SDK shut down successfully'))
          .catch((err) => logger.error('Error shutting down OpenTelemetry SDK', err))
      }

      process.on('SIGTERM', shutdownHandler)
      process.on('SIGINT', shutdownHandler)

      logger.info('OpenTelemetry instrumentation initialized for server-side telemetry')
    } catch (error) {
      logger.error('Failed to initialize OpenTelemetry instrumentation', error)
    }
  }
}

export const onRequestError = Sentry.captureRequestError
