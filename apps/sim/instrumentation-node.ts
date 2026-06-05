// Sim OTel bootstrap. Filter by `mothership.origin` or span-name
// prefix (`sim-mothership:` / `go-mothership:`) to separate the two
// halves of a mothership trace in the OTLP backend.

import { hostname } from 'node:os'
import type { Attributes, Context, Link, SpanKind } from '@opentelemetry/api'
import { DiagConsoleLogger, DiagLogLevel, diag, TraceFlags, trace } from '@opentelemetry/api'
import type {
  ReadableSpan,
  Sampler,
  SamplingResult,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { createLogger } from '@sim/logger'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { env } from './lib/core/config/env'
import { parseOtlpHeaders } from './lib/monitoring/otlp'

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

const logger = createLogger('OTelInstrumentation')

const MOTHERSHIP_ORIGIN = 'sim-mothership' as const
const SPAN_NAME_PREFIX = `${MOTHERSHIP_ORIGIN}: `

const SERVICE_INSTANCE_SLUG = 'sim' as const

const DEFAULT_TELEMETRY_CONFIG = {
  endpoint: env.TELEMETRY_ENDPOINT || 'https://telemetry.simstudio.ai/v1/traces',
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

// Allowlist of span-name prefixes exported from this process.
// Non-mothership code (workflow executor, block runtime, framework
// noise) is dropped. Broaden carefully — `http.` etc. would reopen
// the firehose.
const ALLOWED_SPAN_PREFIXES = ['gen_ai.', 'copilot.', 'sim →', 'sim.', 'tool.execute']

function isBusinessSpan(spanName: string): boolean {
  return ALLOWED_SPAN_PREFIXES.some((prefix) => spanName.startsWith(prefix))
}

// Append `/v1/traces` to the OTLP base URL unless already present.
// The HTTP exporter doesn't auto-suffix the signal path even though
// the spec says the env var is a base URL.
function normalizeOtlpTracesUrl(url: string): string {
  if (!url) return url
  try {
    const u = new URL(url)
    if (u.pathname.endsWith('/v1/traces')) return url
    const base = url.replace(/\/$/, '')
    return `${base}/v1/traces`
  } catch {
    return url
  }
}

// Metrics counterpart to `normalizeOtlpTracesUrl`. Operates on the parsed
// pathname (not a raw string suffix) so query strings and trailing slashes
// don't corrupt the result: swap a `/v1/traces` suffix for `/v1/metrics`,
// otherwise append `/v1/metrics`.
function normalizeOtlpMetricsUrl(url: string): string {
  if (!url) return url
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    if (path.endsWith('/v1/metrics')) return url
    u.pathname = path.endsWith('/v1/traces')
      ? path.replace(/\/v1\/traces$/, '/v1/metrics')
      : `${path}/v1/metrics`
    return u.toString()
  } catch {
    return url
  }
}

// Sampling ratio from env (mirrors Go's `samplerFromEnv`); fallback
// is 100% everywhere. Retention caps cost, not sampling.
function resolveSamplingRatio(_isLocalEndpoint: boolean): number {
  const raw = process.env.TELEMETRY_SAMPLING_RATIO || process.env.OTEL_TRACES_SAMPLER_ARG || ''
  if (raw) {
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed)) {
      if (parsed <= 0) return 0
      if (parsed >= 1) return 1
      return parsed
    }
  }
  return 1.0
}

// Tags allowed spans with `mothership.origin` and prepends
// `sim-mothership:` to the span name so backends can visually split
// the two halves even when service.name is shared.
class MothershipOriginSpanProcessor implements SpanProcessor {
  onStart(span: Span): void {
    const name = span.name
    if (!isBusinessSpan(name)) {
      return
    }
    span.setAttribute(TraceAttr.MothershipOrigin, MOTHERSHIP_ORIGIN)
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

    // Prefer the OTel spec env var, fall back to legacy TELEMETRY_ENDPOINT.
    const resolvedEndpoint =
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      process.env.TELEMETRY_ENDPOINT ||
      env.TELEMETRY_ENDPOINT ||
      telemetryConfig.endpoint
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
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http')
    const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics')
    const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node')
    const { TraceIdRatioBasedSampler, SamplingDecision } = await import(
      '@opentelemetry/sdk-trace-base'
    )

    // Drops Next framework spans, inherits SAMPLED from business
    // parents, and re-samples business roots fresh (don't delegate to
    // ParentBased — its unsampled-parent path is AlwaysOff by default).
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

    const otlpHeaders = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS || '')
    const exporterUrl = normalizeOtlpTracesUrl(telemetryConfig.endpoint)

    const exporter = new OTLPTraceExporter({
      url: exporterUrl,
      headers: otlpHeaders,
      timeoutMillis: Math.min(telemetryConfig.batchSettings.exportTimeoutMillis, 10000),
      keepAlive: false,
    })

    // Surface export failures (BatchSpanProcessor swallows them otherwise).
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

    // Metrics (hosted-key counters/histograms) share the trace endpoint and
    // headers — only the signal path differs. Unlike spans these aren't sampled.
    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: normalizeOtlpMetricsUrl(telemetryConfig.endpoint),
        headers: otlpHeaders,
        timeoutMillis: Math.min(telemetryConfig.batchSettings.exportTimeoutMillis, 10000),
        keepAlive: false,
      }),
      exportIntervalMillis: 60000,
    })

    // Must be unique per process: replicas sharing one instance id collapse
    // into a single Prometheus series, so their independent cumulative
    // counters interleave and corrupt rate()/increase(). The slug keeps Sim
    // distinct from Go for Jaeger's clock-skew grouping; the hostname (the
    // container id under ECS) makes each replica its own series.
    const serviceInstanceId = `${telemetryConfig.serviceName}-${SERVICE_INSTANCE_SLUG}-${hostname()}`
    const resource = defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: telemetryConfig.serviceName,
        [ATTR_SERVICE_VERSION]: telemetryConfig.serviceVersion,
        // OTEL_ → DEPLOYMENT_ENVIRONMENT → NODE_ENV; matches Go's
        // `resourceEnvFromEnv()` so both halves tag the same value.
        [ATTR_DEPLOYMENT_ENVIRONMENT]:
          process.env.OTEL_DEPLOYMENT_ENVIRONMENT ||
          process.env.DEPLOYMENT_ENVIRONMENT ||
          env.NODE_ENV ||
          'development',
        'service.namespace': 'mothership',
        'service.instance.id': serviceInstanceId,
        'mothership.origin': MOTHERSHIP_ORIGIN,
        'telemetry.sdk.name': 'opentelemetry',
        'telemetry.sdk.language': 'nodejs',
        'telemetry.sdk.version': '1.0.0',
      })
    )

    const isLocalEndpoint = /localhost|127\.0\.0\.1/i.test(telemetryConfig.endpoint)
    const samplingRatio = resolveSamplingRatio(isLocalEndpoint)
    const rootRatioSampler = new TraceIdRatioBasedSampler(samplingRatio)
    const sampler = createBusinessSpanSampler(rootRatioSampler)

    logger.info('OpenTelemetry sampler configured', {
      samplingRatio,
      endpoint: telemetryConfig.endpoint,
      origin: MOTHERSHIP_ORIGIN,
    })

    // Origin-prefix must run before batch so the rename/attr is captured.
    const spanProcessors: SpanProcessor[] = [new MothershipOriginSpanProcessor(), batchProcessor]

    const sdk = new NodeSDK({
      resource,
      spanProcessors,
      sampler,
      metricReader,
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
