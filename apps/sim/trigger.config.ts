import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { createLogger } from '@sim/logger'
import {
  diffTriggerEnv,
  parseTriggerEnvSyncTargets,
  resolveTriggerEnvFromAppSecret,
  TRIGGER_CONSTANT_VARS,
} from '@sim/runtime-secrets/trigger-env'
import { distrustCompromisedRoots } from '@sim/security/tls-trust'
import { getErrorMessage } from '@sim/utils/errors'
import type { BuildExtension } from '@trigger.dev/build'
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

/**
 * Environment a run needs for sandboxed work. Function block runs and the
 * document compiler share one provider selection, and the doc-template
 * variables decide whether a run reads a generated document through the doc
 * sandbox's artifact store or the isolated-vm fallback. The app authors
 * documents for whichever compiler it sees, so a worker missing the doc
 * template falls back to isolated-vm and tries to run Python or Node-style
 * sources as sandbox JavaScript. Reading a generated document under the doc
 * sandbox means loading its compiled artifact from the copilot storage
 * context, so that bucket has to be visible to the run as well. The values
 * still have to exist in the Trigger.dev environment; syncing only keeps the
 * worker's view of them aligned with the app's. Only an environment outside
 * `TRIGGER_ENV_SYNC_TARGETS` takes this list; a listed one gets these keys from
 * the app's env-vars secret with everything else.
 */
const FUNCTION_EXECUTION_ENV = [
  { name: 'REDIS_URL', secret: true },
  { name: 'REDIS_TLS_SERVERNAME', secret: false },
  { name: 'SANDBOX_PROVIDER', secret: false },
  { name: 'E2B_ENABLED', secret: false },
  { name: 'E2B_API_KEY', secret: true },
  { name: 'E2B_FUNCTION_TEMPLATE_ID', secret: false },
  { name: 'E2B_FUNCTION_TEMPLATE_GENERATION', secret: false },
  { name: 'MOTHERSHIP_E2B_DOC_TEMPLATE_ID', secret: false },
  { name: 'DAYTONA_API_KEY', secret: true },
  { name: 'DAYTONA_FUNCTION_SNAPSHOT_ID', secret: false },
  { name: 'DAYTONA_DOC_SNAPSHOT_ID', secret: false },
  { name: 'S3_COPILOT_BUCKET_NAME', secret: false },
  { name: 'AZURE_STORAGE_COPILOT_CONTAINER_NAME', secret: false },
  { name: 'GCS_COPILOT_BUCKET_NAME', secret: false },
] as const

function getFunctionExecutionEnvVars() {
  return FUNCTION_EXECUTION_ENV.flatMap(({ name, secret }) => {
    const value = env[name]
    return value ? [{ name, value, isSecret: secret }] : []
  })
}

const syncLogger = createLogger('TriggerEnvSync')

/**
 * The environments `TRIGGER_ENV_SYNC_TARGETS` lists. Exits on a list the deploy workflows would
 * not match: `syncEnvVars` swallows a thrown error, and a typo must not silently keep the old path.
 */
function syncTargets(): Set<string> {
  try {
    return parseTriggerEnvSyncTargets(env.TRIGGER_ENV_SYNC_TARGETS)
  } catch (error) {
    syncLogger.error('Invalid TRIGGER_ENV_SYNC_TARGETS; aborting the deploy', {
      error: getErrorMessage(error),
    })
    process.exit(1)
  }
}

/**
 * Mirrors the app's env-vars secret into an environment listed in
 * `TRIGGER_ENV_SYNC_TARGETS`, logging only counts, never names or values (CI
 * logs are public). The CLI applies the variables when it uploads the version,
 * before promotion, and only adds or updates: a key removed from the secret
 * stays in Trigger.dev until it is deleted there. Exits on failure, because
 * `syncEnvVars` catches a thrown error and deploys without syncing, which would
 * keep stale configuration.
 */
async function syncFromAppSecret(environment: string, deployedEnv: Record<string, string>) {
  try {
    const { secretId, vars } = await resolveTriggerEnvFromAppSecret(environment)
    const { added, changed } = diffTriggerEnv(vars, deployedEnv)
    syncLogger.info('Syncing the Trigger.dev environment from the app env-vars secret', {
      environment,
      secretId,
      total: vars.length,
      added: added.length,
      changed: changed.length,
    })
    return vars
  } catch (error) {
    syncLogger.error('Trigger.dev env sync failed; aborting the deploy', {
      environment,
      error: getErrorMessage(error),
    })
    process.exit(1)
  }
}

/**
 * Node.js version copied into the task image, in lockstep with `NODE_VERSION`
 * in `docker/app.Dockerfile`: `isolated-vm` 6.x loads its Node 24 (ABI 137)
 * prebuild. The image is pinned by its multi-arch index digest.
 */
const NODE_VERSION = '24.22.1'
const NODE_IMAGE = `node:${NODE_VERSION}-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c`

/**
 * Tasks run on Bun, but the `bun-1.4` image ships no `node`, and the
 * isolated-vm sandbox worker and the Oracle Database worker are spawned as
 * `node` child processes, the same split as the app image. Adding image
 * instructions also builds the install stage from this base, so `bun install`
 * runs `isolated-vm`'s install script against the same Node. Deploy only:
 * `trigger dev` spawns the developer's own `node`.
 *
 * @see https://trigger.dev/docs/guides/frameworks/bun#choosing-a-bun-runtime
 */
function nodeBinary(): BuildExtension {
  return {
    name: 'node-binary',
    onBuildComplete(context) {
      if (context.target === 'dev') return
      context.addLayer({
        id: 'node-binary',
        image: {
          instructions: [
            `COPY --from=${NODE_IMAGE} /usr/local/bin/node /usr/local/bin/node`,
            `RUN [ "$(node --version)" = "v${NODE_VERSION}" ]`,
          ],
        },
      })
    },
  }
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
  runtime: 'bun-1.4',
  logLevel: 'info',
  maxDuration: 5400,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ['./background'],
  /**
   * Every file under `dirs` is imported as a task file at deploy time, so any
   * test co-located there must be excluded or its top-level `vi.mock()` throws
   * outside Vitest and fails the whole deploy. Setting this replaces the CLI's
   * defaults (`*.test.*` and `*.spec.*`), which are restated here alongside
   * the `*.integration.*` suffix used for suites that run against real
   * Postgres/Redis, across every extension task discovery matches.
   */
  ignorePatterns: ['**/*.{test,spec,integration}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
  /**
   * Runs before any task run, in the run process. First drops the compromised
   * eMudhra roots from the default CA set, before the run opens any TLS
   * connection (see `@sim/security/tls-trust`). Then marks the process so that
   * dispatch decisions further down the call graph stop inferring from
   * environment variables whether Trigger.dev is available: a process that
   * Trigger.dev is executing has Trigger.dev available by definition.
   *
   * Also warms the shared Redis connection, because nearly every task's first
   * Redis call — a lock acquire, a usage reservation — would otherwise pay the
   * handshake inside its own command deadline. Awaited so the connection is up
   * before `run()` issues anything; imported dynamically so deploy-time
   * evaluation of this config does not pull the client; and never throwing,
   * because a throw here fails the run. The execution-signal subscriber is
   * deliberately not warmed here: only the tasks that execute a workflow ever
   * subscribe, and they are a minority of runs, so that connection is warmed
   * on intent at the execution entry point instead. The same step refreshes
   * workload-identity AWS credentials (`prepareTriggerAttempt`).
   *
   * @see https://trigger.dev/docs/config/config-file#lifecycle-functions
   */
  init: async () => {
    const tlsTrust = distrustCompromisedRoots()
    if (tlsTrust.unsupported || tlsTrust.error) {
      createLogger('TriggerInit').error('Could not distrust compromised CA roots', tlsTrust)
    }
    markInsideTriggerRun()
    const { reportAccountTokenSealing } = await import('@sim/db/sealed-text')
    reportAccountTokenSealing()
    const { prepareTriggerAttempt } = await import('./lib/core/config/trigger-attempt')
    await prepareTriggerAttempt()
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
      // pdf.js resolves its worker via a runtime-relative dynamic import that
      // breaks inside the worker bundle; it must load from node_modules.
      'pdfjs-dist',
      '@napi-rs/canvas',
      // Native libvips binding; knowledge processing reads and downscales images with it.
      'sharp',
    ],
    extensions: [
      nodeBinary(),
      syncEnvVars(({ environment, env: deployedEnv }) => {
        if (syncTargets().has(environment)) return syncFromAppSecret(environment, deployedEnv)
        syncLogger.info('Syncing only the worker constants and function execution settings', {
          environment,
        })
        return [...TRIGGER_CONSTANT_VARS, ...getFunctionExecutionEnvVars()]
      }),
      additionalFiles({
        files: [
          './lib/execution/isolated-vm-worker.cjs',
          './lib/execution/sandbox/bundles/pptxgenjs.cjs',
          './lib/execution/sandbox/bundles/docx.cjs',
          './lib/execution/sandbox/bundles/pdf-lib.cjs',
          './lib/internal/oracledb/oracle-worker.cjs',
          './scripts/oracledb-patch-self-test.cjs',
          './scripts/verify-oracledb-patch.cjs',
          '../../node_modules/oracledb/**/*',
        ],
      }),
      additionalPackages({
        packages: [
          'isolated-vm',
          'react-dom',
          '@react-email/render',
          '@earendil-works/pi-ai',
          '@earendil-works/pi-coding-agent',
          '@e2b/code-interpreter',
          '@daytona/sdk',
          'pdfjs-dist',
          '@napi-rs/canvas',
          'sharp',
        ],
      }),
    ],
  },
})
