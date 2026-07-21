import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  clearActiveNextBuild,
  computeBuildIdentity,
  restoreCachedBuild,
  storeCompletedBuild,
} from './build-manifest'
import type { ChildEnvironment } from './env'
import { DB_PACKAGE_DIR, PLAYWRIGHT_CLI, REALTIME_APP_DIR, REPO_ROOT, SIM_APP_DIR } from './paths'
import {
  type ManagedProcess,
  runCommand,
  spawnManagedProcess,
  waitForManagedProcessReady,
} from './process'
import { waitForHttpReady } from './readiness'
import { verifySandboxBundleIntegrity } from './sandbox-bundles'

export interface StackCommandOptions {
  bunExecutable: string
  nodeExecutable: string
  env: Record<string, string>
  logsDirectory: string
}

export interface BuildAppOptions extends StackCommandOptions {
  buildEnvironment: ChildEnvironment
  reuseBuild: boolean
}

export async function runMigrations(options: StackCommandOptions): Promise<void> {
  await runCommand({
    name: 'migrate',
    command: options.bunExecutable,
    args: ['--no-env-file', path.join(DB_PACKAGE_DIR, 'scripts/migrate.ts')],
    cwd: DB_PACKAGE_DIR,
    env: options.env,
    logsDirectory: options.logsDirectory,
  })
}

export async function seedE2eWorld(options: StackCommandOptions): Promise<void> {
  await runCommand({
    name: 'seed-world',
    command: options.bunExecutable,
    args: ['--no-env-file', path.join(SIM_APP_DIR, 'e2e/scripts/seed-world.ts')],
    cwd: SIM_APP_DIR,
    env: options.env,
    logsDirectory: options.logsDirectory,
  })
}

export async function capturePersonaAuthStates(options: StackCommandOptions): Promise<void> {
  await runCommand({
    name: 'capture-auth-states',
    command: options.nodeExecutable,
    args: ['--import', 'tsx', path.join(SIM_APP_DIR, 'e2e/scripts/capture-auth-states.ts')],
    cwd: SIM_APP_DIR,
    env: options.env,
    logsDirectory: options.logsDirectory,
  })
}

export async function buildApp(options: BuildAppOptions): Promise<void> {
  verifySandboxBundleIntegrity()
  const identity = computeBuildIdentity({
    buildEnvironment: options.buildEnvironment,
    nodeExecutable: options.nodeExecutable,
  })
  if (options.reuseBuild) {
    const reuseDecision = restoreCachedBuild(identity)
    writeBuildDecision(options.logsDirectory, reuseDecision)
    if (reuseDecision.reused) {
      console.info(`Reused verified Next build ${identity.nextBuildHash}`)
      return
    }
    console.info(`Next build cache miss: ${reuseDecision.reason}`)
  }

  clearActiveNextBuild()
  const buildHome = options.buildEnvironment.env.HOME
  if (buildHome) mkdirSync(buildHome, { recursive: true })
  await runCommand({
    name: 'next-build',
    command: options.nodeExecutable,
    args: [path.join(REPO_ROOT, 'node_modules/next/dist/bin/next'), 'build'],
    cwd: SIM_APP_DIR,
    env: options.buildEnvironment.env,
    logsDirectory: options.logsDirectory,
  })
  const storedDecision = storeCompletedBuild(identity)
  writeBuildDecision(options.logsDirectory, storedDecision)
}

export async function startRealtime(options: StackCommandOptions): Promise<ManagedProcess> {
  const realtime = spawnManagedProcess({
    name: 'realtime',
    command: options.bunExecutable,
    args: ['--no-env-file', 'src/index.ts'],
    cwd: REALTIME_APP_DIR,
    env: {
      ...options.env,
      SIM_DB_ROLE: 'realtime',
      DB_APP_NAME: 'sim-realtime',
      REALTIME_HOST: '127.0.0.1',
      PORT: '3002',
    },
    logsDirectory: options.logsDirectory,
  })
  try {
    await waitForManagedProcessReady(realtime, (signal) =>
      waitForHttpReady({
        name: 'Realtime',
        url: 'http://127.0.0.1:3002/health',
        signal,
        validate: async (response) => {
          if (!response.ok) return false
          const body = (await response.json()) as { status?: string; runId?: string }
          return body.status === 'ok' && body.runId === options.env.E2E_RUN_ID
        },
      })
    )
    return realtime
  } catch (error) {
    await realtime.stop()
    throw error
  }
}

export async function startApp(options: StackCommandOptions): Promise<ManagedProcess> {
  const app = spawnManagedProcess({
    name: 'app',
    command: options.nodeExecutable,
    args: [
      path.join(REPO_ROOT, 'node_modules/next/dist/bin/next'),
      'start',
      '-p',
      '3000',
      '-H',
      '127.0.0.1',
    ],
    cwd: SIM_APP_DIR,
    env: {
      ...options.env,
      SIM_DB_ROLE: 'web',
      DB_APP_NAME: 'sim-app',
      PORT: '3000',
    },
    logsDirectory: options.logsDirectory,
  })
  try {
    await waitForManagedProcessReady(app, (signal) =>
      waitForHttpReady({
        name: 'Next.js',
        url: 'http://127.0.0.1:3000/api/health',
        signal,
        validate: async (response) => {
          if (!response.ok) return false
          const body = (await response.json()) as { status?: string; runId?: string }
          return body.status === 'ok' && body.runId === options.env.E2E_RUN_ID
        },
      })
    )
    return app
  } catch (error) {
    await app.stop()
    throw error
  }
}

export async function runPlaywright(
  options: Omit<StackCommandOptions, 'bunExecutable'>,
  args: string[]
): Promise<void> {
  await runCommand({
    name: 'playwright',
    command: options.nodeExecutable,
    args: [PLAYWRIGHT_CLI, 'test', '--config=playwright.config.ts', ...args],
    cwd: SIM_APP_DIR,
    env: options.env,
    logsDirectory: options.logsDirectory,
  })
}

function writeBuildDecision(logsDirectory: string, decision: object): void {
  writeFileSync(
    path.join(logsDirectory, 'build-reuse-decision.json'),
    `${JSON.stringify(decision, null, 2)}\n`
  )
}
