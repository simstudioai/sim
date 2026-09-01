import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  additionalFiles,
  additionalPackages,
  syncEnvVars,
} from '@trigger.dev/build/extensions/core'
import { defineConfig } from '@trigger.dev/sdk'
import { env } from './lib/core/config/env'
import { markInsideTriggerRun } from './lib/core/config/trigger-runtime'
import { parseOtlpHeaders } from './lib/monitoring/otlp'

const grafanaEndpoint = env.GRAFANA_OTLP_ENDPOINT
const grafanaHeaders = env.GRAFANA_OTLP_HEADERS
const grafanaDeploymentEnvironment = env.GRAFANA_DEPLOYMENT_ENVIRONMENT
const grafanaConfigured = Boolean(grafanaEndpoint || grafanaHeaders || grafanaDeploymentEnvironment)
const grafanaFullyConfigured = Boolean(
  grafanaEndpoint && grafanaHeaders && grafanaDeploymentEnvironment
)

if (grafanaConfigured && !grafanaFullyConfigured) {
  throw new Error(
    'Grafana OTLP telemetry is partially configured. Set GRAFANA_OTLP_ENDPOINT, GRAFANA_OTLP_HEADERS, and GRAFANA_DEPLOYMENT_ENVIRONMENT together, or leave all three unset.'
  )
}

const FUNCTION_EXECUTION_ENV = [
  { name: 'REDIS_URL', secret: true },
  { name: 'REDIS_TLS_SERVERNAME', secret: false },
  { name: 'SANDBOX_PROVIDER', secret: false },
  { name: 'E2B_ENABLED', secret: false },
  { name: 'E2B_API_KEY', secret: true },
  { name: 'E2B_FUNCTION_TEMPLATE_ID', secret: false },
  { name: 'E2B_FUNCTION_TEMPLATE_GENERATION', secret: false },
  { name: 'DAYTONA_API_KEY', secret: true },
  { name: 'DAYTONA_FUNCTION_SNAPSHOT_ID', secret: false },
] as const

function getFunctionExecutionEnvVars() {
  return FUNCTION_EXECUTION_ENV.flatMap(({ name, secret }) => {
    const value = env[name]
    return value ? [{ name, value, isSecret: secret }] : []
  })
}

const grafanaTelemetry = grafanaFullyConfigured
  ? (() => {
      const baseUrl = grafanaEndpoint!.replace(/\/+$/, '')
      const headers = parseOtlpHeaders(grafanaHeaders!)
      if (Object.keys(headers).length === 0) {
        throw new Error(
          'GRAFANA_OTLP_HEADERS is set but yielded no valid key=value pairs. Expected format: "key1=value1,key2=value2".'
        )
      }
      const resource = resourceFromAttributes({
        'deployment.environment.name': grafanaDeploymentEnvironment!,
      })
      return {
        exporters: [new OTLPTraceExporter({ url: `${baseUrl}/v1/traces`, headers })],
        logExporters: [new OTLPLogExporter({ url: `${baseUrl}/v1/logs`, headers })],
        metricExporters: [new OTLPMetricExporter({ url: `${baseUrl}/v1/metrics`, headers })],
        resource,
      }
    })()
  : undefined

export default defineConfig({
  project: env.TRIGGER_PROJECT_ID!,
  runtime: 'node-24',
  logLevel: 'log',
  maxDuration: 5400,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ['./background'],
  /**
   * Runs before any task run, in the run process. Marks the process so that
   * dispatch decisions further down the call graph stop inferring from
   * environment variables whether Trigger.dev is available: a process that
   * Trigger.dev is executing has Trigger.dev available by definition.
   *
   * @see https://trigger.dev/docs/config/config-file#lifecycle-functions
   */
  init: () => {
    markInsideTriggerRun()
  },
  ...(grafanaTelemetry ? { telemetry: grafanaTelemetry } : {}),
  build: {
    external: [
      'isolated-vm',
      '@earendil-works/pi-ai',
      '@earendil-works/pi-coding-agent',
      'cpu-features',
      // `@e2b/code-interpreter` copies `e2b`'s members onto its exports at runtime, so
      // bundling drops every name a static analyzer cannot see — `Template` among them.
      // Same reason `next.config.ts` keeps these in `serverExternalPackages`.
      'e2b',
      '@e2b/code-interpreter',
      '@daytona/sdk',
    ],
    extensions: [
      syncEnvVars(() => [
        { name: 'DB_APP_NAME', value: 'sim-trigger' },
        /**
         * Workers run Trigger.dev by definition, but the flag saying so was only
         * set on the app container. Syncing it keeps the deployment flag honest
         * inside runs; the dispatch decision itself no longer depends on it,
         * because the `init` hook above marks the run process directly.
         */
        { name: 'TRIGGER_DEV_ENABLED', value: 'TRUE' },
        ...getFunctionExecutionEnvVars(),
      ]),
      additionalFiles({
        files: [
          './lib/execution/isolated-vm-worker.cjs',
          './lib/execution/sandbox/bundles/pptxgenjs.cjs',
          './lib/execution/sandbox/bundles/docx.cjs',
          './lib/execution/sandbox/bundles/pdf-lib.cjs',
        ],
      }),
      additionalPackages({
        packages: [
          'isolated-vm',
          'react-dom',
          'react-email',
          '@earendil-works/pi-ai',
          '@earendil-works/pi-coding-agent',
          '@e2b/code-interpreter',
          '@daytona/sdk',
        ],
      }),
    ],
  },
})
