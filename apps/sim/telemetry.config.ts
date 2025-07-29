/**
 * Sim Telemetry Configuration
 *
 * PRIVACY NOTICE:
 * - Telemetry is enabled by default to help us improve the product
 * - You can disable telemetry via:
 *   1. Settings UI > Privacy tab > Toggle off "Allow anonymous telemetry"
 *   2. Setting NEXT_TELEMETRY_DISABLED=1 environment variable
 *
 * This file allows you to configure telemetry collection for your
 * Sim instance. If you've forked the repository, you can modify
 * this file to send telemetry to your own collector.
 *
 * We only collect anonymous usage data to improve the product:
 * - Feature usage statistics
 * - Error rates
 * - Performance metrics
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
   * Endpoint URL where telemetry data is sent
   * Change this if you want to send telemetry to your own collector
   */
  endpoint: env.TELEMETRY_ENDPOINT || 'https://telemetry.sim.ai/v1/traces',

  /**
   * Service name used to identify this instance
   * You can change this
   */
  serviceName: 'sim-studio',

  /**
   * Version of the service, defaults to the app version
   */
  serviceVersion: '0.1.0',

  /**
   * Batch settings for sending telemetry
   * - maxQueueSize: Max number of spans to buffer
   * - maxExportBatchSize: Max number of spans to send in a single batch
   * - scheduledDelayMillis: Delay between batches (ms)
   * - exportTimeoutMillis: Timeout for exporting data (ms)
   */
  batchSettings: {
    maxQueueSize: 100,
    maxExportBatchSize: 10,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000,
  },

  /**
   * Categories of events that can be collected
   * This is used for validation when events are sent
   */
  allowedCategories: ['page_view', 'feature_usage', 'performance', 'error', 'workflow', 'consent'],

  /**
   * Client-side instrumentation settings
   * Set enabled: false to disable client-side telemetry entirely
   */
  clientSide: {
    enabled: true,
  },

  /**
   * Server-side instrumentation settings
   * Set enabled: false to disable server-side telemetry entirely
   */
  serverSide: {
    enabled: true,
  },
}

export default config
