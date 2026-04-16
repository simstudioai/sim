/**
 * Sim OpenTelemetry - Server-side Instrumentation
 *
 * Mothership joint trace design
 * -----------------------------
 * Both Sim (this file) and the Go copilot server register under a single
 * OTel `service.name = "mothership"` so every request shows up as one
 * service in the OTLP backend. To keep the two halves distinguishable:
 *
 *   - Every span emitted by this process is prefixed with `sim: ` on
 *     start, and gets a `mothership.origin = "sim"` attribute.
 *   - The Go side does the same with `go: ` / `mothership.origin = "go"`.
 *
 * So in Jaeger/Tempo, filtering by `mothership.origin` (exact) or by
 * operation name prefix (`sim:` / `go:`) cleanly splits the two halves.
 */

import type { Attributes, Context, Link, SpanKind } from '@opentelemetry/api'
import { DiagConsoleLogger, DiagLogLevel, TraceFlags, diag, trace } from '@opentelemetry/api'
import type {
  ReadableSpan,
  Sampler,
  SamplingResult,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { createLogger } from '@sim/logger'
import { env } from './lib/core/config/env'

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

const logger = createLogger('OTelInstrumentation')

const MOTHERSHIP_ORIGIN = 'sim' as const
const SPAN_NAME_PREFIX = `${MOTHERSHIP_ORIGIN}: `

const DEFAULT_TELEMETRY_CONFIG = {
  endpoint: env.TELEMETRY_ENDPOINT || 'https://telemetry.simstudio.ai/v1/traces',
  // Joint Sim+Go service surface in Jaeger/Tempo. See header comment.
  serviceName: 'mothership',
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
 * Span name prefixes we keep after sampling. All spans we care about
 * (copilot lifecycle, fetchGo Sim→Go calls, gen_ai.* root, workflow/block
 * executions, etc.) start with one of these. Anything else is Next.js
 * framework noise and gets dropped unless its parent is already sampled.
 */
const ALLOWED_SPAN_PREFIXES = [
  'platform.',
  'gen_ai.',
  'workflow.',
  'block.',
  'http.client.',
  'function.',
  'router.',
  'condition.',
  'loop.',
  'parallel.',
  'copilot.',
  'sim →',
  'sim.',
]

function isBusinessSpan(spanName: string): boolean {
  return ALLOWED_SPAN_PREFIXES.some((prefix) => spanName.startsWith(prefix))
}

/**
 * MothershipOriginSpanProcessor tags every span this process creates with
 * `mothership.origin` and prepends a `sim: ` prefix to the span name on
 * start, before any downstream processor (BatchSpanProcessor) reads it.
 *
 * Implemented as its own processor rather than a resource attribute so
 * the backend span/operation list (which keys on span name) is visually
 * split between sim and go even when both share service.name.
 */
class MothershipOriginSpanProcessor implements SpanProcessor {
  onStart(span: Span): void {
    span.setAttribute('mothership.origin', MOTHERSHIP_ORIGIN)
    const name = span.name
    if (!name.startsWith(SPAN_NAME_PREFIX)) {
      span.updateName(`${SPAN_NAME_PREFIX}${name}`)
    }
  }
  onEnd(_span: ReadableSpan): void {}
  shutdown(): Promise<void> {
    return Promise.resolve()
  }
  forceFlush(): Promise<void> {
    return Promise.resolve()
  }
}

async function initializeOpenTelemetry() {
  try {
    if (env.NEXT_TELEMETRY_DISABLED === '1' || process.env.NEXT_TELEMETRY_DISABLED === '1') {
      logger.info('OpenTelemetry disabled via NEXT_TELEMETRY_DISABLED=1')
      return
    }

    let telemetryConfig
    try {
      telemetryConfig = (await import('./telemetry.config')).default
    } catch {
      telemetryConfig = DEFAULT_TELEMETRY_CONFIG
    }

    // Prefer process.env directly: @t3-oss/env-nextjs sometimes returns
    // undefined for server vars that aren't listed in experimental__runtimeEnv,
    // and TELEMETRY_ENDPOINT isn't mapped there.
    const resolvedEndpoint =
      process.env.TELEMETRY_ENDPOINT || env.TELEMETRY_ENDPOINT || telemetryConfig.endpoint
    telemetryConfig = {
      ...telemetryConfig,
      endpoint: resolvedEndpoint,
      serviceName: 'mothership',
    }

    if (telemetryConfig.serverSide?.enabled === false) {
      logger.info('Server-side OpenTelemetry disabled in config')
      return
    }

    logger.info('OpenTelemetry init', {
      endpoint: telemetryConfig.endpoint,
      serviceName: telemetryConfig.serviceName,
      origin: MOTHERSHIP_ORIGIN,
    })

    const { NodeSDK } = await import('@opentelemetry/sdk-node')
    const { defaultResource, resourceFromAttributes } = await import('@opentelemetry/resources')
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT } = await import(
      '@opentelemetry/semantic-conventions/incubating'
    )
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
    const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node')
    const { TraceIdRatioBasedSampler, SamplingDecision } = await import(
      '@opentelemetry/sdk-trace-base'
    )

    // Sampler responsibilities:
    //   1. Drop Next.js framework spans (tagged with next.span_type).
    //   2. If we're inside a sampled business trace (parent has SAMPLED), let
    //      the child record so the full trace stays together.
    //   3. For a business-span ROOT, decide afresh with the ratio sampler —
    //      ignoring an unsampled Next.js HTTP parent. Delegating to
    //      ParentBasedSampler here would use its localParentNotSampled
    //      inner sampler (AlwaysOff by default) and veto every trace.
    const createBusinessSpanSampler = (rootRatioSampler: Sampler): Sampler => ({
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

        const parentSpanContext = trace.getSpanContext(context)
        const parentIsSampled =
          !!parentSpanContext &&
          (parentSpanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED

        if (parentIsSampled) {
          return { decision: SamplingDecision.RECORD_AND_SAMPLED }
        }

        if (isBusinessSpan(spanName)) {
          return rootRatioSampler.shouldSample(
            context,
            traceId,
            spanName,
            spanKind,
            attributes,
            links
          )
        }

        return { decision: SamplingDecision.NOT_RECORD }
      },
      toString(): string {
        return `BusinessSpanSampler{rootSampler=${rootRatioSampler.toString()}}`
      },
    })

    const exporter = new OTLPTraceExporter({
      url: telemetryConfig.endpoint,
      headers: {},
      timeoutMillis: Math.min(telemetryConfig.batchSettings.exportTimeoutMillis, 10000),
      keepAlive: false,
    })

    // Surface export failures in the Sim log instead of letting
    // BatchSpanProcessor silently drop them.
    const origExport = exporter.export.bind(exporter)
    exporter.export = (spans, resultCallback) => {
      origExport(spans, (result) => {
        if (result?.code !== 0) {
          // eslint-disable-next-line no-console
          console.error('[OTEL] exporter export failed', {
            endpoint: telemetryConfig.endpoint,
            resultCode: result?.code,
            error: result?.error?.message,
            spanCount: spans.length,
          })
        }
        resultCallback(result)
      })
    }

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
        'service.namespace': 'mothership',
        'mothership.origin': MOTHERSHIP_ORIGIN,
        'telemetry.sdk.name': 'opentelemetry',
        'telemetry.sdk.language': 'nodejs',
        'telemetry.sdk.version': '1.0.0',
      })
    )

    // Dev / self-hosted OTLP backends (Jaeger/Tempo on localhost) should
    // capture every trace so manual verification is deterministic. Keep 10%
    // for production cloud endpoints.
    const isLocalEndpoint = /localhost|127\.0\.0\.1/i.test(telemetryConfig.endpoint)
    const samplingRatio = isLocalEndpoint ? 1.0 : 0.1
    const rootRatioSampler = new TraceIdRatioBasedSampler(samplingRatio)
    const sampler = createBusinessSpanSampler(rootRatioSampler)

    // Order matters: the origin-prefix processor must run BEFORE the batch
    // processor so the renamed span and the mothership.origin attribute are
    // captured on export.
    const spanProcessors: SpanProcessor[] = [new MothershipOriginSpanProcessor(), batchProcessor]

    const sdk = new NodeSDK({
      resource,
      spanProcessors,
      sampler,
    })

    sdk.start()

    const shutdownOtel = async () => {
      try {
        await sdk.shutdown()
        logger.info('OpenTelemetry SDK shut down successfully')
      } catch (err) {
        logger.error('Error shutting down OpenTelemetry SDK', err)
      }
    }

    process.on('SIGTERM', shutdownOtel)
    process.on('SIGINT', shutdownOtel)

    logger.info('OpenTelemetry instrumentation initialized', {
      serviceName: telemetryConfig.serviceName,
      origin: MOTHERSHIP_ORIGIN,
      samplingRatio,
    })
  } catch (error) {
    logger.error('Failed to initialize OpenTelemetry instrumentation', error)
  }
}

export async function register() {
  await initializeOpenTelemetry()

  const shutdownPostHog = async () => {
    try {
      const { getPostHogClient } = await import('@/lib/posthog/server')
      await getPostHogClient()?.shutdown()
      logger.info('PostHog client shut down successfully')
    } catch (err) {
      logger.error('Error shutting down PostHog client', err)
    }
  }

  process.on('SIGTERM', shutdownPostHog)
  process.on('SIGINT', shutdownPostHog)

  const { startMemoryTelemetry } = await import('./lib/monitoring/memory-telemetry')
  startMemoryTelemetry()
}
