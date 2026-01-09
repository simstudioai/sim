/**
 * Sim OpenTelemetry - Server-side Instrumentation
 */

import type { Attributes, Context, Link, SpanKind } from '@opentelemetry/api'
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import type { Sampler, SamplingResult } from '@opentelemetry/sdk-trace-base'
import { createLogger } from '@sim/logger'
import { env } from './lib/core/config/env'

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
 * Span name prefixes we want to KEEP
 */
const ALLOWED_SPAN_PREFIXES = [
  'platform.', // Our platform events
  'gen_ai.', // GenAI semantic convention spans
  'workflow.', // Workflow execution spans
  'block.', // Block execution spans
  'http.client.', // Our API block HTTP calls
  'function.', // Function block execution
  'router.', // Router block evaluation
  'condition.', // Condition block evaluation
  'loop.', // Loop block execution
  'parallel.', // Parallel block execution
]

function isBusinessSpan(spanName: string): boolean {
  return ALLOWED_SPAN_PREFIXES.some((prefix) => spanName.startsWith(prefix))
}

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
    const { ParentBasedSampler, TraceIdRatioBasedSampler, SamplingDecision } = await import(
      '@opentelemetry/sdk-trace-base'
    )

    const createBusinessSpanSampler = (baseSampler: Sampler): Sampler => ({
      shouldSample(
        context: Context,
        traceId: string,
        spanName: string,
        spanKind: SpanKind,
        attributes: Attributes,
        links: Link[]
      ): SamplingResult {
        if (attributes['next.span_type']) {
          return { decision: SamplingDecision.NOT_RECORD }
        }

        if (isBusinessSpan(spanName)) {
          return baseSampler.shouldSample(context, traceId, spanName, spanKind, attributes, links)
        }

        return { decision: SamplingDecision.NOT_RECORD }
      },

      toString(): string {
        return `BusinessSpanSampler{baseSampler=${baseSampler.toString()}}`
      },
    })

    const exporter = new OTLPTraceExporter({
      url: telemetryConfig.endpoint,
      headers: {},
      timeoutMillis: Math.min(telemetryConfig.batchSettings.exportTimeoutMillis, 10000),
      keepAlive: false,
    })

    const batchProcessor = new BatchSpanProcessor(exporter, {
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

    const baseSampler = new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(0.1),
    })
    const sampler = createBusinessSpanSampler(baseSampler)

    const sdk = new NodeSDK({
      resource,
      spanProcessor: batchProcessor,
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

    logger.info('OpenTelemetry instrumentation initialized with business span filtering')
  } catch (error) {
    logger.error('Failed to initialize OpenTelemetry instrumentation', error)
  }
}

export async function register() {
  await initializeOpenTelemetry()
}
