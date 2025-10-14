/**
 * Sim OpenTelemetry Configuration
 *
 * PRIVACY NOTICE:
 * - Telemetry is enabled by default to help us improve the product
 * - You can disable telemetry via:
 *   1. Settings UI > Privacy tab > Toggle off "Allow anonymous telemetry"
 *   2. Setting NEXT_TELEMETRY_DISABLED=1 environment variable
 *
 * This file allows you to configure OpenTelemetry collection for your
 * Sim instance. If you've forked the repository, you can modify
 * this file to send telemetry to your own collector.
 *
 * We only collect anonymous usage data to improve the product:
 * - Feature usage statistics
 * - Error rates (always captured)
 * - Performance metrics (sampled at 10%)
 * - AI/LLM operation traces (always captured for workflows)
 *
 * We NEVER collect:
 * - Personal information
 * - Workflow content or outputs
 * - API keys or tokens
 * - IP addresses or geolocation data
 */
import { env } from './lib/env'

const config = {
  /**
   * OTLP Endpoint URL where telemetry data is sent
   * Change this if you want to send telemetry to your own collector
   * Supports any OTLP-compatible backend (Jaeger, Grafana Tempo, etc.)
   */
  endpoint: env.TELEMETRY_ENDPOINT || 'https://telemetry.simstudio.ai/v1/traces',

  /**
   * Service name used to identify this instance
   * You can change this for your fork
   */
  serviceName: 'sim-studio',

  /**
   * Version of the service, defaults to the app version
   */
  serviceVersion: '0.1.0',

  /**
   * Batch settings for OpenTelemetry BatchSpanProcessor
   * Optimized for production use with minimal overhead
   *
   * - maxQueueSize: Max number of spans to buffer (increased from 100 to 2048)
   * - maxExportBatchSize: Max number of spans per batch (increased from 10 to 512)
   * - scheduledDelayMillis: Delay between batches (5 seconds)
   * - exportTimeoutMillis: Timeout for exporting data (30 seconds)
   */
  batchSettings: {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000,
  },

  /**
   * Sampling configuration
   * - Errors: Always sampled (100%)
   * - AI/LLM operations: Always sampled (100%)
   * - Other operations: Sampled at 10%
   */
  sampling: {
    defaultRate: 0.1, // 10% sampling for regular operations
    alwaysSampleErrors: true,
    alwaysSampleAI: true,
  },

  /**
   * Categories of events that can be collected
   * This is used for validation when events are sent
   */
  allowedCategories: [
    'page_view',
    'feature_usage',
    'performance',
    'error',
    'workflow',
    'consent',
    'batch', // Added for batched events
  ],

  /**
   * Client-side instrumentation settings
   * Set enabled: false to disable client-side telemetry entirely
   *
   * Client-side telemetry now uses:
   * - Event batching (send every 10s or 50 events)
   * - Only critical Web Vitals (LCP, FID, CLS)
   * - Unhandled errors only
   */
  clientSide: {
    enabled: true,
    batchIntervalMs: 10000, // 10 seconds
    maxBatchSize: 50,
  },

  /**
   * Server-side instrumentation settings
   * Set enabled: false to disable server-side telemetry entirely
   *
   * Server-side telemetry uses:
   * - OpenTelemetry SDK with BatchSpanProcessor
   * - Intelligent sampling (errors and AI ops always captured)
   * - Semantic conventions for AI/LLM operations
   */
  serverSide: {
    enabled: true,
  },
}

export default config
