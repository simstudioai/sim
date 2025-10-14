/**
 * Sim OpenTelemetry - Server-side Instrumentation
 */

import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { env } from './lib/env'
import { createLogger } from './lib/logs/console/logger'

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

const logger = createLogger('OTelInstrumentation')

const DEFAULT_TELEMETRY_CONFIG = {
  endpoint: env.TELEMETRY_ENDPOINT || 'https://telemetry.simstudio.ai/v1/traces',
  serviceName: 'sim-studio',
  serviceVersion: '0.1.0',
  serverSide: { enabled: true },
  batchSettings: {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000,
  },
}

/**
 * Initialize OpenTelemetry SDK with proper configuration
 */
async function initializeOpenTelemetry() {
  try {
    if (env.NEXT_TELEMETRY_DISABLED === '1') {
      logger.info('OpenTelemetry disabled via NEXT_TELEMETRY_DISABLED=1')
      return
    }

    let telemetryConfig
    try {
      telemetryConfig = (await import('./telemetry.config')).default
    } catch {
      telemetryConfig = DEFAULT_TELEMETRY_CONFIG
    }

    if (telemetryConfig.serverSide?.enabled === false) {
      logger.info('Server-side OpenTelemetry disabled in config')
      return
    }

    const { NodeSDK } = await import('@opentelemetry/sdk-node')
    const { defaultResource, resourceFromAttributes } = await import('@opentelemetry/resources')
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT } = await import(
      '@opentelemetry/semantic-conventions/incubating'
    )
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
    const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node')
    const { ParentBasedSampler, TraceIdRatioBasedSampler } = await import(
      '@opentelemetry/sdk-trace-base'
    )

    const exporter = new OTLPTraceExporter({
      url: telemetryConfig.endpoint,
      headers: {},
      timeoutMillis: telemetryConfig.batchSettings.exportTimeoutMillis,
    })

    const spanProcessor = new BatchSpanProcessor(exporter, {
      maxQueueSize: telemetryConfig.batchSettings.maxQueueSize,
      maxExportBatchSize: telemetryConfig.batchSettings.maxExportBatchSize,
      scheduledDelayMillis: telemetryConfig.batchSettings.scheduledDelayMillis,
      exportTimeoutMillis: telemetryConfig.batchSettings.exportTimeoutMillis,
    })

    const resource = defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: telemetryConfig.serviceName,
        [ATTR_SERVICE_VERSION]: telemetryConfig.serviceVersion,
        [ATTR_DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV || 'development',
        'service.namespace': 'sim-ai-platform',
        'telemetry.sdk.name': 'opentelemetry',
        'telemetry.sdk.language': 'nodejs',
        'telemetry.sdk.version': '1.0.0',
      })
    )

    const sampler = new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(0.1), // 10% sampling for root spans
    })

    const sdk = new NodeSDK({
      resource,
      spanProcessor,
      sampler,
      traceExporter: exporter,
    })

    sdk.start()

    const shutdownHandler = async () => {
      try {
        await sdk.shutdown()
        logger.info('OpenTelemetry SDK shut down successfully')
      } catch (err) {
        logger.error('Error shutting down OpenTelemetry SDK', err)
      }
    }

    process.on('SIGTERM', shutdownHandler)
    process.on('SIGINT', shutdownHandler)

    logger.info('OpenTelemetry instrumentation initialized')
  } catch (error) {
    logger.error('Failed to initialize OpenTelemetry instrumentation', error)
  }
}

export async function register() {
  await initializeOpenTelemetry()
}
