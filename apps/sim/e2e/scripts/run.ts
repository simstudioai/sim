import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { type StripeFakeServer, startStripeFakeServer } from '../fakes/stripe/server'
import {
  buildRunDatabaseUrl,
  createRunDatabase,
  createRunDatabaseName,
  dropRunDatabase,
  type RunDatabase,
} from '../support/database'
import { createHostedBillingProfile, E2E_ORIGIN, E2E_PROFILE } from '../support/deployment-profile'
import {
  assertNoForbiddenProviderInitialization,
  assertNoForbiddenProviderTraffic,
} from '../support/diagnostics'
import { formatRedactedEnvironmentSummary } from '../support/env'
import { assertE2eHostResolvesToLoopback } from '../support/hosts'
import { getRunDirectory, SIM_APP_DIR } from '../support/paths'
import {
  assertAdminApiBoundary,
  type FoundationProvisioningResult,
  inspectFoundationUsers,
} from '../support/probes'
import {
  assertPortAvailable,
  type ManagedProcess,
  stopAllManagedProcesses,
  stopAllManagedProcessesSync,
} from '../support/process'
import { buildApp, runMigrations, runPlaywright, startApp, startRealtime } from '../support/stack'
import { parseRunOptions } from './options'

const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
const STRIPE_TEST_KEY = 'sk_test_sim_e2e_foundation'

async function main(): Promise<void> {
  const options = parseRunOptions(process.argv.slice(2))
  const runId = createRunId()
  const runDirectory = getRunDirectory(runId)
  const logsDirectory = path.join(runDirectory, 'logs')
  const storageStateDirectory = path.join(runDirectory, 'auth')
  mkdirSync(logsDirectory, { recursive: true })
  mkdirSync(storageStateDirectory, { recursive: true })

  const nodeExecutable = resolveNode22()
  const bunExecutable = resolveBunExecutable()
  const adminDatabaseUrl = process.env.E2E_PG_ADMIN_URL ?? DEFAULT_ADMIN_DATABASE_URL

  let runDatabase: RunDatabase | null = null
  let stripeFake: StripeFakeServer | null = null
  let realtime: ManagedProcess | null = null
  let app: ManagedProcess | null = null
  let cleanupPromise: Promise<void> | null = null
  let failed = false
  let interrupted = false

  const cleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      await stopAllManagedProcesses()

      if (stripeFake) {
        writeFileSync(
          path.join(logsDirectory, 'stripe-requests.json'),
          JSON.stringify(stripeFake.requestLog, null, 2)
        )
        await stripeFake.stop()
      }

      if (runDatabase) {
        try {
          await dropRunDatabase(adminDatabaseUrl, runDatabase.name)
        } catch (error) {
          failed = true
          process.exitCode = 1
          console.error(`Failed to drop ${runDatabase.name}:`, error)
        }
      }
    })()
    return cleanupPromise
  }

  const handleSignal = (signal: NodeJS.Signals): void => {
    if (interrupted) return
    interrupted = true
    failed = true
    const exitCode = signal === 'SIGINT' ? 130 : 143
    process.exitCode = exitCode
    console.error(`Received ${signal}; cleaning up the E2E run`)
    const survivingPids = stopAllManagedProcessesSync()
    if (survivingPids.length > 0) {
      console.error(`E2E child processes survived SIGKILL: ${survivingPids.join(', ')}`)
    }
    if (stripeFake) {
      writeFileSync(
        path.join(logsDirectory, 'stripe-requests.json'),
        JSON.stringify(stripeFake.requestLog, null, 2)
      )
    }
    if (runDatabase) {
      const cleanupResult = spawnSync(
        bunExecutable,
        ['--no-env-file', path.join(SIM_APP_DIR, 'e2e/scripts/cleanup-database.ts')],
        {
          cwd: SIM_APP_DIR,
          encoding: 'utf8',
          env: {
            NODE_ENV: 'test',
            PATH: process.env.PATH ?? '',
            E2E_PG_ADMIN_URL: adminDatabaseUrl,
            E2E_DATABASE_NAME: runDatabase.name,
          },
        }
      )
      if (cleanupResult.status !== 0) {
        console.error(cleanupResult.stderr || cleanupResult.stdout)
      } else {
        runDatabase = null
      }
    }
    process.exit(exitCode)
  }
  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)

  try {
    const hostAddresses = await assertE2eHostResolvesToLoopback()
    console.info(`E2E host resolved to loopback: ${hostAddresses.join(', ')}`)
    await Promise.all([assertPortAvailable(3000), assertPortAvailable(3002)])

    const runDatabaseName = createRunDatabaseName(runId)
    runDatabase = {
      name: runDatabaseName,
      url: buildRunDatabaseUrl(adminDatabaseUrl, runDatabaseName),
    }
    await createRunDatabase(adminDatabaseUrl, runDatabaseName)
    stripeFake = await startStripeFakeServer({
      apiKey: STRIPE_TEST_KEY,
      hostname: '127.0.0.1',
      port: 0,
    })
    if (!stripeFake.baseUrl) throw new Error('Stripe fake did not expose a base URL')

    const profile = createHostedBillingProfile({
      runId,
      databaseUrl: runDatabase.url,
      stripeApiBaseUrl: stripeFake.baseUrl,
      ci: process.env.CI === 'true',
    })
    console.info(formatRedactedEnvironmentSummary(profile.id, profile.childEnvironment))

    const stackOptions = {
      bunExecutable,
      nodeExecutable,
      env: profile.childEnvironment.env,
      logsDirectory,
    }

    await runMigrations(stackOptions)
    await buildApp(stackOptions)
    realtime = await startRealtime(stackOptions)
    app = await startApp(stackOptions)
    await assertAdminApiBoundary(E2E_ORIGIN, profile.childEnvironment.env.ADMIN_API_KEY)
    assertNoForbiddenProviderInitialization([app.logPath, realtime.logPath])

    const playwrightEnvironment = createPlaywrightEnvironment(
      profile.childEnvironment.env,
      runId,
      storageStateDirectory
    )
    await runPlaywright(
      {
        nodeExecutable,
        env: playwrightEnvironment,
        logsDirectory,
      },
      options.playwrightArgs
    )
    const provisioning = await inspectFoundationUsers(runDatabase.url, runId)
    assertAuthenticatedSmokeEffectsIfPresent(stripeFake, provisioning)
  } catch (error) {
    failed = true
    console.error(error)
    process.exitCode = 1
  } finally {
    try {
      assertNoForbiddenProviderTraffic(
        [app?.logPath, realtime?.logPath].filter((value): value is string => Boolean(value))
      )
    } catch (error) {
      failed = true
      process.exitCode = 1
      console.error(error)
    }
    await cleanup()
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
    console.info(`E2E ${failed ? 'failed' : 'completed'}; diagnostics: ${runDirectory}`)
  }
}

function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const random = randomUUID().replace(/-/g, '').slice(0, 10)
  return `${timestamp}_${random}`
}

function resolveBunExecutable(): string {
  if (!process.versions.bun) {
    throw new Error('The E2E orchestrator must be started with Bun')
  }
  return process.execPath
}

function resolveNode22(): string {
  const executable = process.env.E2E_NODE_BINARY ?? 'node'
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
  })
  if (result.status !== 0) {
    throw new Error(`Unable to execute Node for Playwright: ${result.stderr}`)
  }
  const version = result.stdout.trim()
  if (!/^v22\./.test(version)) {
    throw new Error(`Playwright E2E requires Node 22, received ${version}`)
  }
  return executable
}

function createPlaywrightEnvironment(
  stackEnvironment: Record<string, string>,
  runId: string,
  storageStateDirectory: string
): Record<string, string> {
  const keys = [
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SYSTEMROOT',
    'CI',
    'GITHUB_ACTIONS',
    'PLAYWRIGHT_BROWSERS_PATH',
  ]
  const env: Record<string, string> = {}
  for (const key of keys) {
    const value = stackEnvironment[key]
    if (value !== undefined) env[key] = value
  }
  return {
    ...env,
    E2E_PROFILE,
    E2E_ORCHESTRATED: '1',
    E2E_RUN_ID: runId,
    E2E_BASE_URL: E2E_ORIGIN,
    E2E_STORAGE_STATE_DIR: storageStateDirectory,
  }
}

function assertAuthenticatedSmokeEffectsIfPresent(
  stripeFake: StripeFakeServer,
  provisioning: FoundationProvisioningResult
): void {
  const created = stripeFake.requestLog.some(
    ({ method, path }) => method === 'POST' && path === '/v1/customers'
  )
  const unexpected = stripeFake.requestLog.filter((request) => request.unexpected)
  if (unexpected.length > 0) {
    throw new Error(
      `Stripe fake received unsupported requests: ${unexpected
        .map(({ method, path }) => `${method} ${path}`)
        .join(', ')}`
    )
  }
  if (!created && provisioning.count === 0) {
    console.info('Authenticated foundation smoke was filtered out; skipping its post-run probes')
    return
  }
  if (!created) throw new Error('Billing-enabled signup did not create a fake Stripe customer')
  if (provisioning.count === 0) {
    throw new Error('Authenticated smoke did not create a foundation user')
  }
  if (!provisioning.allHaveStripeCustomers) {
    throw new Error('A foundation user was not persisted with its fake Stripe customer')
  }
  if (!provisioning.allHaveStats) {
    throw new Error('A foundation user was not initialized with user_stats')
  }
}

await main()
