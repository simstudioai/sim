import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { additionalFiles, additionalPackages } from '@trigger.dev/build/extensions/core'
import { defineConfig } from '@trigger.dev/sdk'
import { env } from './lib/core/config/env'

const grafanaEndpoint = env.GRAFANA_OTLP_ENDPOINT
const grafanaInstanceId = env.GRAFANA_INSTANCE_ID
const grafanaToken = env.GRAFANA_API_TOKEN
const grafanaConfigured = Boolean(grafanaEndpoint || grafanaInstanceId || grafanaToken)
const grafanaFullyConfigured = Boolean(grafanaEndpoint && grafanaInstanceId && grafanaToken)

if (grafanaConfigured && !grafanaFullyConfigured) {
  throw new Error(
    'Grafana OTLP telemetry is partially configured. Set GRAFANA_OTLP_ENDPOINT, GRAFANA_INSTANCE_ID, and GRAFANA_API_TOKEN together, or leave all three unset.'
  )
}

const grafanaTelemetry = grafanaFullyConfigured
  ? (() => {
      const baseUrl = grafanaEndpoint!.replace(/\/+$/, '')
      const headers = {
        Authorization: `Basic ${Buffer.from(`${grafanaInstanceId}:${grafanaToken}`).toString('base64')}`,
      }
      const deploymentEnvironment = env.SIM_DEPLOYMENT_ENVIRONMENT
      const resource = deploymentEnvironment
        ? resourceFromAttributes({ 'deployment.environment.name': deploymentEnvironment })
        : undefined
      return {
        exporters: [new OTLPTraceExporter({ url: `${baseUrl}/v1/traces`, headers })],
        logExporters: [new OTLPLogExporter({ url: `${baseUrl}/v1/logs`, headers })],
        metricExporters: [new OTLPMetricExporter({ url: `${baseUrl}/v1/metrics`, headers })],
        ...(resource ? { resource } : {}),
      }
    })()
  : undefined

export default defineConfig({
  project: env.TRIGGER_PROJECT_ID!,
  runtime: 'node-22',
  logLevel: 'log',
  maxDuration: 5400,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ['./background'],
  ...(grafanaTelemetry ? { telemetry: grafanaTelemetry } : {}),
  build: {
    external: ['isolated-vm'],
    extensions: [
      additionalFiles({
        files: [
          './lib/execution/isolated-vm-worker.cjs',
          './lib/execution/sandbox/bundles/pptxgenjs.cjs',
          './lib/execution/sandbox/bundles/docx.cjs',
          './lib/execution/sandbox/bundles/pdf-lib.cjs',
        ],
      }),
      additionalPackages({
        packages: ['unpdf', 'isolated-vm', 'react-dom', '@react-email/render'],
      }),
    ],
  },
})
