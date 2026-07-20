import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { type StripeFakeServer, startStripeFakeServer } from '../fakes/stripe/server'
import {
  createRunDatabase,
  createRunDatabaseName,
  dropRunDatabase,
  type RunDatabase,
} from '../support/database'
import { createHostedBillingProfile, E2E_ORIGIN, E2E_PROFILE } from '../support/deployment-profile'
import { formatRedactedEnvironmentSummary } from '../support/env'
import { assertE2eHostResolvesToLoopback } from '../support/hosts'
import { getRunDirectory } from '../support/paths'
import { type ManagedProcess, stopProcesses } from '../support/process'
import { buildApp, runMigrations, runPlaywright, startApp, startRealtime } from '../support/stack'
import { parseRunOptions } from './options'

const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
const STRIPE_TEST_KEY = 'sk_test_sim_e2e_foundation'

async function main(): Promise<void> {
  const options = parseRunOptions(process.argv.slice(2))
  const runId = createRunId()
  const runDirectory = getRunDirectory(runId)
  const logsDirectory = path.join(runDirectory, 'logs')
  const storageStatePath = path.join(runDirectory, 'auth', 'foundation.json')
  mkdirSync(logsDirectory, { recursive: true })
  mkdirSync(path.dirname(storageStatePath), { recursive: true })

  const nodeExecutable = resolveNode22()
  const bunExecutable = resolveBunExecutable()
  const adminDatabaseUrl = process.env.E2E_PG_ADMIN_URL ?? DEFAULT_ADMIN_DATABASE_URL

  let runDatabase: RunDatabase | null = null
  let stripeFake: StripeFakeServer | null = null
  const processes: ManagedProcess[] = []
  let failed = false

  try {
    const hostAddresses = await assertE2eHostResolvesToLoopback()
    console.info(`E2E host resolved to loopback: ${hostAddresses.join(', ')}`)

    runDatabase = await createRunDatabase(adminDatabaseUrl, createRunDatabaseName(runId))
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
    if (!options.skipBuild) await buildApp(stackOptions)
    processes.push(await startRealtime(stackOptions))
    processes.push(await startApp(stackOptions))

    const playwrightEnvironment = createPlaywrightEnvironment(
      profile.childEnvironment.env,
      runId,
      stripeFake.baseUrl,
      storageStatePath
    )
    await runPlaywright(
      {
        nodeExecutable,
        env: playwrightEnvironment,
        logsDirectory,
      },
      options.playwrightArgs
    )
  } catch (error) {
    failed = true
    console.error(error)
    process.exitCode = 1
  } finally {
    await stopProcesses(processes)

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
  stripeFakeUrl: string,
  storageStatePath: string
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
    E2E_RUN_ID: runId,
    E2E_BASE_URL: E2E_ORIGIN,
    E2E_ADMIN_API_KEY: stackEnvironment.ADMIN_API_KEY,
    E2E_STRIPE_FAKE_URL: stripeFakeUrl,
    E2E_STRIPE_FAKE_KEY: stackEnvironment.STRIPE_SECRET_KEY,
    E2E_STORAGE_STATE_PATH: storageStatePath,
  }
}

await main()
