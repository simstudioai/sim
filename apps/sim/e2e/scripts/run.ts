import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { type McpFakeServer, startMcpFakeServer } from '../fakes/mcp/server'
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
import { assertE2eHostsResolveToLoopback } from '../support/hosts'
import {
  assertNoSyntheticSecretLeaks,
  loadSyntheticSecretCanaryForScan,
  scrubUnscannableArtifacts,
} from '../support/leak-canary'
import { assertValidMcpFakeTraffic, writeMcpRequestLog } from '../support/mcp-requests'
import { getRunDirectory, SIM_APP_DIR } from '../support/paths'
import {
  assertAdminApiBoundary,
  assertManifestWorkspaceIdentities,
  assertSettingsPrimaryRetentionRestored,
  type FoundationProvisioningResult,
  inspectFoundationUsers,
} from '../support/probes'
import {
  assertPortAvailable,
  getActiveManagedProcessGroupIds,
  type ManagedProcess,
  setManagedProcessGroupObserver,
  stopAllManagedProcesses,
} from '../support/process'
import { acquireE2eRunLock } from '../support/run-lock'
import { createE2eRuntimeSecrets, runtimeSecretValues } from '../support/runtime-secrets'
import { createSingleFlightSignalCleanup } from '../support/signal-cleanup'
import {
  buildApp,
  capturePersonaAuthStates,
  runMigrations,
  runPlaywright,
  seedE2eWorld,
  startApp,
  startRealtime,
} from '../support/stack'
import { buildPlaywrightInvocations, parseRunOptions } from './options'

const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'

async function main(): Promise<void> {
  const options = parseRunOptions(process.argv.slice(2))
  const runId = createRunId()
  const runDirectory = getRunDirectory(runId)
  const logsDirectory = path.join(runDirectory, 'logs')
  const storageStateDirectory = path.join(runDirectory, 'auth')
  const markerDirectory = path.join(runDirectory, 'markers')
  const privateDirectory = path.join(runDirectory, 'private')
  const homesDirectory = path.join(runDirectory, 'homes')
  const runtimeHomeDirectory = path.join(homesDirectory, 'runtime')
  const setupHomeDirectory = path.join(homesDirectory, 'setup')
  const authCaptureHomeDirectory = path.join(homesDirectory, 'auth-capture')
  const playwrightHomeDirectory = path.join(homesDirectory, 'playwright')
  const manifestPath = path.join(runDirectory, 'persona-manifest.json')
  const credentialsPath = path.join(privateDirectory, 'persona-credentials.json')
  const canarySecretsPath = path.join(privateDirectory, 'synthetic-secrets.json')
  const authScreenshotsDirectory = path.join(runDirectory, 'auth-capture-screenshots')
  const diagnosticRoots = [
    runDirectory,
    path.join(SIM_APP_DIR, 'playwright-report'),
    path.join(SIM_APP_DIR, 'test-results'),
  ]
  mkdirSync(logsDirectory, { recursive: true })
  mkdirSync(storageStateDirectory, { recursive: true, mode: 0o700 })
  mkdirSync(markerDirectory, { recursive: true })
  mkdirSync(privateDirectory, { recursive: true, mode: 0o700 })
  for (const directory of [
    runtimeHomeDirectory,
    setupHomeDirectory,
    authCaptureHomeDirectory,
    playwrightHomeDirectory,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }

  const nodeExecutable = resolveNode22()
  const bunExecutable = resolveBunExecutable()
  const adminDatabaseUrl = process.env.E2E_PG_ADMIN_URL ?? DEFAULT_ADMIN_DATABASE_URL
  const runtimeSecrets = createE2eRuntimeSecrets()
  const runLock = acquireE2eRunLock()
  setManagedProcessGroupObserver((processGroupIds) => runLock.setProcessGroupIds(processGroupIds))

  let runDatabase: RunDatabase | null = null
  let databaseCreationComplete = false
  let stripeFake: StripeFakeServer | null = null
  let mcpFake: McpFakeServer | null = null
  let realtime: ManagedProcess | null = null
  let app: ManagedProcess | null = null
  let cleanupPromise: Promise<void> | null = null
  let fakeFinalizationPromise: Promise<void> | null = null
  let leakCanarySecrets: string[] = runtimeSecretValues(runtimeSecrets)
  let canaryCoverageComplete = true
  let diagnosticsRetained = true
  let failed = false

  const persistFakeRequestLogs = (): void => {
    const failures: unknown[] = []
    if (stripeFake) {
      try {
        writeFileSync(
          path.join(logsDirectory, 'stripe-requests.json'),
          JSON.stringify(stripeFake.requestLog, null, 2)
        )
      } catch (error) {
        failures.push(error)
      }
    }
    if (mcpFake) {
      try {
        writeMcpRequestLog(logsDirectory, mcpFake.requestLog)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Unable to persist E2E fake request logs')
    }
  }

  const finalizeFakeServers = (): Promise<void> => {
    if (fakeFinalizationPromise) return fakeFinalizationPromise
    fakeFinalizationPromise = (async () => {
      const failures: unknown[] = []
      try {
        persistFakeRequestLogs()
      } catch (error) {
        failures.push(error)
      }
      for (const fake of [mcpFake, stripeFake]) {
        if (!fake) continue
        try {
          await fake.stop()
        } catch (error) {
          failures.push(error)
        }
      }
      try {
        persistFakeRequestLogs()
      } catch (error) {
        failures.push(error)
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Unable to finalize E2E fake servers')
      }
    })()
    return fakeFinalizationPromise
  }

  const cleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      const failures: unknown[] = []
      try {
        await stopAllManagedProcesses()
      } catch (error) {
        failures.push(error)
      }

      try {
        await finalizeFakeServers()
      } catch (error) {
        failures.push(error)
      }

      for (const sensitiveDirectory of [storageStateDirectory, privateDirectory, homesDirectory]) {
        try {
          rmSync(sensitiveDirectory, { recursive: true, force: true })
          if (existsSync(sensitiveDirectory)) {
            throw new Error(`Sensitive directory still exists: ${sensitiveDirectory}`)
          }
        } catch (error) {
          failures.push(error)
        }
      }

      try {
        if (runDatabase) await dropRunDatabase(adminDatabaseUrl, runDatabase.name)
      } catch (error) {
        failures.push(error)
      }

      if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more E2E cleanup stages failed')
      }
    })()
    return cleanupPromise
  }

  const signalCleanup = createSingleFlightSignalCleanup(async (signal) => {
    const cleanupProcessGroupIds = getActiveManagedProcessGroupIds()
    setManagedProcessGroupObserver(null)
    failed = true
    const exitCode = signal === 'SIGINT' ? 130 : 143
    process.exitCode = exitCode
    console.error(`Received ${signal}; cleaning up the E2E run`)
    let lockTransferred = false
    try {
      try {
        await finalizeFakeServers()
      } catch (error) {
        console.error(error)
      }
      if (runDatabase) {
        let cleanupLogFd: number | null = null
        try {
          cleanupLogFd = openSync(path.join(logsDirectory, 'signal-cleanup.log'), 'a')
          const cleanupProcess = spawn(
            bunExecutable,
            ['--no-env-file', path.join(SIM_APP_DIR, 'e2e/scripts/signal-cleanup.ts')],
            {
              cwd: SIM_APP_DIR,
              detached: true,
              env: {
                NODE_ENV: 'test',
                PATH: process.env.PATH ?? '',
                HOME: setupHomeDirectory,
                E2E_PG_ADMIN_URL: adminDatabaseUrl,
                E2E_DATABASE_NAME: runDatabase.name,
                E2E_DATABASE_CREATION_COMPLETE: String(databaseCreationComplete),
                E2E_CLEANUP_PROCESS_GROUPS: cleanupProcessGroupIds.join(','),
                E2E_CLEANUP_DIRECTORIES: JSON.stringify([
                  storageStateDirectory,
                  privateDirectory,
                  homesDirectory,
                ]),
                E2E_RUN_LOCK_PATH: runLock.path,
                E2E_RUN_LOCK_TOKEN: runLock.token,
              },
              stdio: ['ignore', cleanupLogFd, cleanupLogFd],
            }
          )
          await new Promise<void>((resolve, reject) => {
            cleanupProcess.once('spawn', resolve)
            cleanupProcess.once('error', reject)
          })
          if (!cleanupProcess.pid) {
            throw new Error('Detached E2E cleanup supervisor started without a process ID')
          }
          if (!runLock.transfer(cleanupProcess.pid)) {
            throw new Error('Detached E2E cleanup supervisor could not acquire run-lock ownership')
          }
          lockTransferred = true
          cleanupProcess.unref()
          console.error(`Detached E2E cleanup supervisor started as PID ${cleanupProcess.pid}`)
        } finally {
          if (cleanupLogFd !== null) {
            try {
              closeSync(cleanupLogFd)
            } catch (error) {
              console.error(error)
            }
          }
        }
      }
    } catch (error) {
      console.error(error)
    }
    try {
      if (!lockTransferred) {
        if (runDatabase) runLock.retain('signal cleanup supervisor failed to start')
        else runLock.release()
      }
    } catch (error) {
      console.error('Unable to update E2E run-lock after signal cleanup startup failure', error)
    } finally {
      process.exit(exitCode)
    }
  })
  // Persistent handlers keep repeated or opposite signals from invoking the OS default while
  // the first handler awaits ownership transfer. The synchronous guard keeps cleanup single-flight.
  const handleSigint = (): void => void signalCleanup.start('SIGINT')
  const handleSigterm = (): void => void signalCleanup.start('SIGTERM')
  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  try {
    const hostAddresses = await assertE2eHostsResolveToLoopback()
    console.info(
      `E2E hosts resolved to loopback: ${Object.entries(hostAddresses)
        .map(([hostname, addresses]) => `${hostname}=${addresses.join(',')}`)
        .join(' ')}`
    )
    await Promise.all([assertPortAvailable(3000), assertPortAvailable(3002)])

    const runDatabaseName = createRunDatabaseName(runId)
    runDatabase = {
      name: runDatabaseName,
      url: buildRunDatabaseUrl(adminDatabaseUrl, runDatabaseName),
    }
    await createRunDatabase(adminDatabaseUrl, runDatabaseName)
    databaseCreationComplete = true
    stripeFake = await startStripeFakeServer({
      apiKey: runtimeSecrets.stripeSecretKey,
      hostname: '127.0.0.1',
      port: 0,
    })
    if (!stripeFake.baseUrl) throw new Error('Stripe fake did not expose a base URL')
    mcpFake = await startMcpFakeServer({
      hostname: '127.0.0.1',
      port: 0,
    })
    if (!mcpFake.baseUrl) throw new Error('MCP fake did not expose a base URL')

    const profile = createHostedBillingProfile({
      runId,
      databaseUrl: runDatabase.url,
      stripeApiBaseUrl: stripeFake.baseUrl,
      mcpServerUrl: mcpFake.baseUrl,
      runtimeHomeDirectory,
      setupHomeDirectory,
      authCaptureHomeDirectory,
      playwrightHomeDirectory,
      playwrightBrowsersPath: resolvePlaywrightBrowsersPath(),
      runtimeSecrets,
      ci: process.env.CI === 'true',
    })
    for (const [name, environment] of Object.entries(profile.environments)) {
      console.info(formatRedactedEnvironmentSummary(`${profile.id}/${name}`, environment))
    }

    const commandOptions = {
      bunExecutable,
      nodeExecutable,
      logsDirectory,
    }

    await runMigrations({
      ...commandOptions,
      env: profile.environments.migration.env,
    })
    await buildApp({
      ...commandOptions,
      buildEnvironment: profile.environments.build,
      reuseBuild: options.reuseBuild,
      ci: process.env.CI === 'true',
    })
    realtime = await startRealtime({
      ...commandOptions,
      env: profile.environments.realtime.env,
    })
    app = await startApp({
      ...commandOptions,
      env: profile.environments.app.env,
    })
    await assertAdminApiBoundary(
      'http://127.0.0.1:3000',
      profile.environments.app.env.ADMIN_API_KEY
    )
    assertNoForbiddenProviderInitialization([app.logPath, realtime.logPath])

    await seedE2eWorld({
      ...commandOptions,
      env: {
        ...profile.environments.seed.env,
        E2E_ORCHESTRATED: '1',
        E2E_MANIFEST_PATH: manifestPath,
        E2E_CREDENTIALS_PATH: credentialsPath,
        E2E_CANARY_SECRETS_PATH: canarySecretsPath,
      },
    })
    await capturePersonaAuthStates({
      ...commandOptions,
      env: {
        ...profile.environments.authCapture.env,
        E2E_MANIFEST_PATH: manifestPath,
        E2E_CREDENTIALS_PATH: credentialsPath,
        E2E_STORAGE_STATE_DIR: storageStateDirectory,
        E2E_AUTH_SCREENSHOT_DIR: authScreenshotsDirectory,
      },
    })
    leakCanarySecrets = loadSyntheticSecretCanaryForScan(leakCanarySecrets, canarySecretsPath)
    rmSync(credentialsPath, { force: true })
    rmSync(canarySecretsPath, { force: true })

    const playwrightEnvironment = createPlaywrightEnvironment(
      profile.environments.playwright.env,
      runId,
      storageStateDirectory,
      markerDirectory,
      manifestPath
    )
    const playwrightInvocations = buildPlaywrightInvocations(options)
    for (const [index, playwrightArgs] of playwrightInvocations.entries()) {
      if (playwrightInvocations.length > 1) {
        console.log(
          `Playwright repeat gate ${index + 1}/${playwrightInvocations.length}: ${playwrightArgs.find((argument) => argument.startsWith('--project='))}`
        )
      }
      await runPlaywright(
        {
          nodeExecutable,
          env: playwrightEnvironment,
          logsDirectory,
        },
        playwrightArgs
      )
    }
    const provisioning = await inspectFoundationUsers(runDatabase.url, runId)
    assertAuthenticatedSmokeEffectsIfPresent(
      stripeFake,
      provisioning,
      hasFoundationCompletionMarker(markerDirectory)
    )
  } catch (error) {
    failed = true
    console.error(error)
    process.exitCode = 1
  } finally {
    if (signalCleanup.claimNormalFinalization()) {
      process.off('SIGINT', handleSigint)
      process.off('SIGTERM', handleSigterm)

      if (runDatabase) {
        try {
          assertSeededScenarioManifestExists(manifestPath)
          await Promise.all([
            assertManifestWorkspaceIdentities(runDatabase.url, manifestPath),
            assertSettingsPrimaryRetentionRestored(runDatabase.url, manifestPath),
          ])
        } catch (error) {
          failed = true
          process.exitCode = 1
          console.error(error)
        }
      }
      try {
        leakCanarySecrets = loadSyntheticSecretCanaryForScan(leakCanarySecrets, canarySecretsPath)
      } catch (error) {
        canaryCoverageComplete = false
        failed = true
        process.exitCode = 1
        console.error(error)
      } finally {
        rmSync(credentialsPath, { force: true })
        rmSync(canarySecretsPath, { force: true })
      }
      let cleanupSucceeded = false
      try {
        await cleanup()
        cleanupSucceeded = true
      } catch (error) {
        failed = true
        process.exitCode = 1
        console.error(error)
      }
      try {
        persistFakeRequestLogs()
      } catch (error) {
        failed = true
        process.exitCode = 1
        console.error(error)
      }
      if (mcpFake) {
        try {
          assertValidMcpFakeTraffic(
            mcpFake.requestLog,
            hasMcpWorkflowCompletionMarker(markerDirectory)
          )
        } catch (error) {
          failed = true
          process.exitCode = 1
          console.error(error)
        }
      }
      try {
        assertNoForbiddenProviderTraffic(
          [app?.logPath, realtime?.logPath].filter((value): value is string => Boolean(value))
        )
      } catch (error) {
        failed = true
        process.exitCode = 1
        console.error(error)
      }
      if (canaryCoverageComplete && leakCanarySecrets.length > 0) {
        try {
          await assertNoSyntheticSecretLeaks({
            secrets: leakCanarySecrets,
            roots: diagnosticRoots,
            excludedPaths: [privateDirectory, storageStateDirectory],
          })
          writeFileSync(
            path.join(markerDirectory, 'leak-scan-complete.json'),
            `${JSON.stringify({ runId, completedAt: new Date().toISOString() })}\n`,
            { mode: 0o600 }
          )
        } catch (error) {
          failed = true
          process.exitCode = 1
          console.error(error)
          diagnosticsRetained = scrubDiagnostics(diagnosticRoots)
          if (diagnosticsRetained) cleanupSucceeded = false
        }
      } else if (!canaryCoverageComplete) {
        diagnosticsRetained = scrubDiagnostics(diagnosticRoots)
        if (diagnosticsRetained) cleanupSucceeded = false
      }
      setManagedProcessGroupObserver(null)
      if (cleanupSucceeded) runLock.release()
      else runLock.retain('normal cleanup failed; inspect diagnostics and clean resources manually')
      console.info(
        diagnosticsRetained
          ? `E2E ${failed ? 'failed' : 'completed'}; diagnostics: ${runDirectory}`
          : 'E2E failed; diagnostics were scrubbed because complete secret scanning was impossible'
      )
    }
  }
}

function scrubDiagnostics(roots: string[]): boolean {
  try {
    scrubUnscannableArtifacts(roots)
    return false
  } catch (error) {
    console.error(error)
    return true
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

function resolvePlaywrightBrowsersPath(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH
  const parentHome = process.env.HOME
  if (!parentHome) throw new Error('HOME is required to locate installed Playwright browsers')
  return process.platform === 'darwin'
    ? path.join(parentHome, 'Library/Caches/ms-playwright')
    : path.join(parentHome, '.cache/ms-playwright')
}

function createPlaywrightEnvironment(
  baseEnvironment: Record<string, string>,
  runId: string,
  storageStateDirectory: string,
  markerDirectory: string,
  manifestPath: string
): Record<string, string> {
  return {
    ...baseEnvironment,
    E2E_PROFILE,
    E2E_ORCHESTRATED: '1',
    E2E_RUN_ID: runId,
    E2E_BASE_URL: E2E_ORIGIN,
    E2E_STORAGE_STATE_DIR: storageStateDirectory,
    E2E_MARKER_DIR: markerDirectory,
    E2E_MANIFEST_PATH: manifestPath,
  }
}

function assertAuthenticatedSmokeEffectsIfPresent(
  stripeFake: StripeFakeServer,
  provisioning: FoundationProvisioningResult,
  completed: boolean
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
  if (!completed) {
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

function hasFoundationCompletionMarker(markerDirectory: string): boolean {
  return (
    existsSync(markerDirectory) &&
    readdirSync(markerDirectory).some((name) => name.startsWith('foundation-authenticated-'))
  )
}

function hasMcpWorkflowCompletionMarker(markerDirectory: string): boolean {
  return (
    existsSync(markerDirectory) &&
    readdirSync(markerDirectory).some((name) => name.startsWith('mcp-workflow-complete'))
  )
}

function assertSeededScenarioManifestExists(manifestPath: string): void {
  if (!existsSync(manifestPath)) {
    throw new Error('Final database invariants require the seeded scenario manifest')
  }
}

await main()
