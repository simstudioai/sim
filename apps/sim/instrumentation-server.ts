/**
 * Sim Studio Telemetry - Server-side Instrumentation
 *
 * This file contains all server-side instrumentation logic.
 */

import { env } from './lib/env'
import { isProd } from './lib/environment'
import { createLogger } from './lib/logs/console-logger'

const Sentry = isProd ? require('@sentry/nextjs') : { captureRequestError: () => {} }

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

// Initialize OpenTelemetry
async function initializeOpenTelemetry() {
  try {
    if (env.NEXT_TELEMETRY_DISABLED === '1') {
      logger.info('OpenTelemetry telemetry disabled via environment variable')
      return
    }

    let telemetryConfig
    try {
      // Use dynamic import for ES modules
      telemetryConfig = (await import('./telemetry.config.ts')).default
    } catch (_e) {
      telemetryConfig = DEFAULT_TELEMETRY_CONFIG
    }

    if (telemetryConfig.serverSide?.enabled === false) {
      logger.info('Server-side OpenTelemetry instrumentation is disabled in config')
      return
    }

    // Dynamic imports for server-side libraries
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
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV,
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

async function initializeSentry() {
  if (!isProd) return

  try {
    const Sentry = await import('@sentry/nextjs')

    // Skip initialization if Sentry appears to be already configured
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore accessing internal API
    if ((Sentry as any).Hub?.current?.getClient()) {
      logger.debug('Sentry already initialized, skipping duplicate init')
      return
    }

    Sentry.init({
      dsn: env.NEXT_PUBLIC_SENTRY_DSN || undefined,
      enabled: true,
      environment: env.NODE_ENV || 'development',
      tracesSampleRate: 0.2,
      beforeSend(event) {
        if (event.request && typeof event.request === 'object') {
          ;(event.request as any).ip = null
        }
        return event
      },
    })

    logger.info('Sentry initialized (server-side)')
  } catch (error) {
    logger.error('Failed to initialize Sentry', error as Error)
  }
}

export async function register() {
  await initializeSentry()
  await initializeOpenTelemetry()
}

export const onRequestError = Sentry.captureRequestError
