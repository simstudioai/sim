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
import { DiagConsoleLogger, DiagLogLevel, diag, TraceFlags, trace } from '@opentelemetry/api'
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
 * Span name prefixes we keep after sampling.
 *
 * Scope: this process only traces *mothership / copilot* requests for now.
 * Anything outside that lifecycle (workflow executor, block runtime,
 * Next.js framework noise, etc.) is intentionally dropped so Jaeger only
 * shows the Sim half of a mothership trace.
 *
 * Any new prefix here should correspond to a span our copilot code
 * explicitly creates; adding a broad prefix (e.g. `http.`) risks
 * silently re-enabling non-copilot tracing.
 */
const ALLOWED_SPAN_PREFIXES = ['gen_ai.', 'copilot.', 'sim →', 'sim.', 'tool.execute']

function isBusinessSpan(spanName: string): boolean {
  return ALLOWED_SPAN_PREFIXES.some((prefix) => spanName.startsWith(prefix))
}

/**
 * Parse OTLP headers from the standard env var `OTEL_EXPORTER_OTLP_HEADERS`.
 *
 * Spec format: `key1=value1,key2=value2`, with values optionally
 * URL-encoded. We tolerate whitespace around entries and values that
 * themselves contain `=`. This is the mechanism every managed backend
 * (Honeycomb, Grafana Cloud, New Relic, Datadog) uses to receive its
 * auth token without any backend-specific code paths here.
 */
function parseOtlpHeadersEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const rawVal = trimmed.slice(eq + 1).trim()
    let val = rawVal
    try {
      val = decodeURIComponent(rawVal)
    } catch {
      // value wasn't URL-encoded; keep as-is.
    }
    if (key) out[key] = val
  }
  return out
}

/**
 * Normalize an OTLP base URL to the full traces-signal endpoint.
 *
 * The OTel HTTP exporter sends to whatever URL you give it verbatim
 * — no signal-path appending. That's a footgun when the same env
 * var also flows into the Go side, where the SDK *does* append
 * `/v1/traces` automatically. We bridge the gap here so both halves
 * of the mothership can share one endpoint value.
 *
 * Rules:
 *   - If the URL already has a non-root path, respect it (operator
 *     intent: "post to exactly this URL").
 *   - Otherwise, append `/v1/traces`.
 *   - Malformed URLs pass through unchanged; the exporter will
 *     surface the error at first export.
 */
function normalizeOtlpTracesUrl(url: string): string {
  if (!url) return url
  try {
    const u = new URL(url)
    if (u.pathname && u.pathname !== '/') return url
    return `${url.replace(/\/$/, '')}/v1/traces`
  } catch {
    return url
  }
}

/**
 * Resolve the sampling ratio from env, with sensible fallbacks.
 *
 * Matches the Go side's `samplerFromEnv()` semantics so operators can
 * control both halves of the mothership trace tree from the same
 * variable. Invalid values degrade gracefully to the fallback.
 */
function resolveSamplingRatio(isLocalEndpoint: boolean): number {
  const raw = process.env.TELEMETRY_SAMPLING_RATIO || process.env.OTEL_TRACES_SAMPLER_ARG || ''
  if (raw) {
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed)) {
      if (parsed <= 0) return 0
      if (parsed >= 1) return 1
      return parsed
    }
  }
  // Local dev gets 100% for deterministic manual verification.
  // Production default is also 100% — the 1-day retention at the
  // backend caps storage cost, not sampling.
  return isLocalEndpoint ? 1.0 : 1.0
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

    // Endpoint resolution: prefer the OTel spec env var, fall back to
    // our legacy TELEMETRY_ENDPOINT so existing deploys keep working
    // during rollout. Read process.env directly because
    // @t3-oss/env-nextjs sometimes returns undefined for server vars
    // that aren't listed in experimental__runtimeEnv.
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

    // Parse OTEL_EXPORTER_OTLP_HEADERS per the OTel spec: comma-
    // separated `key=value` pairs, values optionally URL-encoded. This
    // is how managed backends (Honeycomb, Grafana Cloud, New Relic)
    // receive their API keys without needing a vendor-specific code
    // path — flip the secret, redeploy, traces land in the new place.
    const otlpHeaders = parseOtlpHeadersEnv(process.env.OTEL_EXPORTER_OTLP_HEADERS || '')

    // The @opentelemetry/exporter-trace-otlp-http exporter treats the
    // `url` option as the complete POST target and does NOT append the
    // `/v1/traces` signal path. The Go SDK, by contrast, does append
    // it when only a host is given. Normalize here so operators can
    // set the same `OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io`
    // for both services and have it Just Work.
    const exporterUrl = normalizeOtlpTracesUrl(telemetryConfig.endpoint)

    const exporter = new OTLPTraceExporter({
      url: exporterUrl,
      headers: otlpHeaders,
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

    // service.instance.id identifies this specific process within the
    // shared `mothership` service. Jaeger's clock-skew adjuster groups
    // spans by (service, instance) — without a unique instance per
    // origin, Sim and Go spans fall into the same group, Jaeger sees
    // multi-second cross-machine clock drift within one group, and its
    // adjuster emits spurious "parent is not in the trace; skipping
    // clock skew adjustment" warnings on every cross-process child.
    // Stable per-origin instance ID (`mothership-sim` / `mothership-go`)
    // is enough to split the groups cleanly; Jaeger still shows both
    // under the single `mothership` service in its service picker.
    const serviceInstanceId = `${telemetryConfig.serviceName}-${MOTHERSHIP_ORIGIN}`
    const resource = defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: telemetryConfig.serviceName,
        [ATTR_SERVICE_VERSION]: telemetryConfig.serviceVersion,
        [ATTR_DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV || 'development',
        'service.namespace': 'mothership',
        'service.instance.id': serviceInstanceId,
        'mothership.origin': MOTHERSHIP_ORIGIN,
        'telemetry.sdk.name': 'opentelemetry',
        'telemetry.sdk.language': 'nodejs',
        'telemetry.sdk.version': '1.0.0',
      })
    )

    // Sampling ratio resolution, in priority order:
    //   1. `TELEMETRY_SAMPLING_RATIO` (our explicit, matches Go side)
    //   2. `OTEL_TRACES_SAMPLER_ARG`  (OTel spec env var)
    //   3. 1.0 for local endpoints (so dev traces are deterministic)
    //   4. 1.0 otherwise (production wants every mothership request —
    //      retention happens at the backend)
    //
    // `1.0` is the right default for mothership: every request is
    // support-critical and we rely on the backend's retention (1 day
    // in prod) to cap storage, not upstream sampling.
    const isLocalEndpoint = /localhost|127\.0\.0\.1/i.test(telemetryConfig.endpoint)
    const samplingRatio = resolveSamplingRatio(isLocalEndpoint)
    const rootRatioSampler = new TraceIdRatioBasedSampler(samplingRatio)
    const sampler = createBusinessSpanSampler(rootRatioSampler)

    logger.info('OpenTelemetry sampler configured', {
      samplingRatio,
      endpoint: telemetryConfig.endpoint,
      origin: MOTHERSHIP_ORIGIN,
    })

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
