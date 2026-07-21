import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { expect, test } from '@playwright/test'
import { parseRunOptions } from '../scripts/options'
import { classifyE2eHashOwner } from '../support/build-manifest'
import {
  assertLoopbackPostgresUrl,
  assertSafeDatabaseName,
  buildRunDatabaseUrl,
} from '../support/database'
import { createHostedBillingProfile } from '../support/deployment-profile'
import { buildChildEnvironment, discoverEnvFileKeys } from '../support/env'
import { areValidE2eHostAddresses, isLoopbackAddress } from '../support/hosts'
import {
  assertPortAvailable,
  spawnManagedProcess,
  waitForManagedProcessReady,
} from '../support/process'
import { verifySandboxBundleIntegrity } from '../support/sandbox-bundles'
import { parseProcessGroupIds } from '../support/signal-cleanup'

test.describe('foundation safety guards', () => {
  test('discovers env keys without leaking values and shadows unknown keys', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-env-'))
    try {
      writeFileSync(
        path.join(directory, '.env'),
        'OPENAI_API_KEY=do-not-leak-this\nSAFE_VALUE=from-file\n'
      )
      expect(discoverEnvFileKeys(directory)).toEqual(['OPENAI_API_KEY', 'SAFE_VALUE'])

      const result = buildChildEnvironment({
        values: { REQUIRED_VALUE: 'configured' },
        required: ['REQUIRED_VALUE'],
        allowedSensitiveKeys: new Set(),
        envDirectory: directory,
      })
      expect(result.env.OPENAI_API_KEY).toBe('')
      expect(result.env.SAFE_VALUE).toBe('')
      expect(JSON.stringify(result)).not.toContain('do-not-leak-this')
      expect(JSON.stringify(result)).not.toContain('from-file')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('@next/env preserves non-empty and empty shadow values over an env file', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-next-env-'))
    const key = `SIM_E2E_CANARY_${Date.now()}`
    const emptyKey = `${key}_EMPTY`
    try {
      writeFileSync(path.join(directory, '.env'), `${key}=file-value\n${emptyKey}=must-not-load\n`)
      process.env[key] = 'shadowed-value'
      process.env[emptyKey] = ''
      loadEnvConfig(directory, false, console, true)
      expect(process.env[key]).toBe('shadowed-value')
      expect(process.env[emptyKey]).toBe('')
    } finally {
      delete process.env[key]
      delete process.env[emptyKey]
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('deployment profile projects least-privilege build and runtime environments', () => {
    const profile = createHostedBillingProfile({
      runId: 'projection_test',
      databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/sim_e2e_projection_test',
      stripeApiBaseUrl: 'http://127.0.0.1:40123',
      homeDirectory: path.join(os.tmpdir(), 'sim-e2e-projection'),
      playwrightBrowsersPath: path.join(os.tmpdir(), 'sim-e2e-browsers'),
      ci: false,
    })
    const { build, app, realtime, migration, seed, authCapture, playwright } = profile.environments

    expect(build.env.DATABASE_URL).toContain('/sim_e2e_build_sentinel')
    expect(build.env.DATABASE_URL).not.toBe(app.env.DATABASE_URL)
    expect(build.env.STRIPE_API_BASE_URL).toBe('http://127.0.0.1:1')
    expect(build.env.E2E_RUN_ID).toBe('build_sentinel')

    for (const key of Object.keys(app.env).filter((key) => key.startsWith('NEXT_PUBLIC_'))) {
      expect(build.env[key], `${key} must be identical at build and runtime`).toBe(app.env[key])
    }

    expect(seed.env.ADMIN_API_KEY).toBe(app.env.ADMIN_API_KEY)
    expect(seed.env.DATABASE_URL).toBe(app.env.DATABASE_URL)
    expect(authCapture.env.ADMIN_API_KEY).toBeUndefined()
    expect(authCapture.env.DATABASE_URL).toBeUndefined()
    expect(playwright.env.ADMIN_API_KEY).toBeUndefined()
    expect(playwright.env.DATABASE_URL).toBeUndefined()
    expect(realtime.env.ADMIN_API_KEY).toBeUndefined()
    expect(realtime.env.STRIPE_SECRET_KEY).toBeUndefined()
    expect(migration.env.ADMIN_API_KEY).toBeUndefined()
    expect(migration.env.MIGRATION_DATABASE_URL).toBe(app.env.DATABASE_URL)
  })

  test('database guards reject shared or remote targets', () => {
    expect(() => assertSafeDatabaseName('simstudio')).toThrow()
    expect(() => assertSafeDatabaseName('sim_e2e_valid_run')).not.toThrow()
    expect(() =>
      assertLoopbackPostgresUrl('postgresql://postgres:postgres@example.com/postgres')
    ).toThrow()
    expect(() =>
      assertLoopbackPostgresUrl('postgresql://postgres:postgres@localhost/postgres')
    ).toThrow()
    expect(() =>
      assertLoopbackPostgresUrl('postgresql://postgres:postgres@127.0.0.1/postgres?sslmode=disable')
    ).toThrow()
    expect(
      buildRunDatabaseUrl(
        'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
        'sim_e2e_valid_run'
      )
    ).toContain('/sim_e2e_valid_run')
  })

  test('loopback detection rejects public addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('127.10.20.30')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('8.8.8.8')).toBe(false)
    expect(areValidE2eHostAddresses(['127.0.0.1'])).toBe(true)
    expect(areValidE2eHostAddresses(['127.0.0.1', '::1'])).toBe(true)
    expect(areValidE2eHostAddresses(['::1'])).toBe(false)
    expect(areValidE2eHostAddresses(['127.0.0.2'])).toBe(false)
  })

  test('sharding is limited to the navigation project', () => {
    expect(() =>
      parseRunOptions(['--project=hosted-billing-chromium-navigation', '--shard=1/2'])
    ).not.toThrow()
    expect(() =>
      parseRunOptions(['--project=hosted-billing-chromium-workflows', '--shard=1/2'])
    ).toThrow(/coupled workflows must remain unsharded/)
  })

  test('Playwright CLI arguments cannot override orchestration invariants', () => {
    expect(() => parseRunOptions(['--workers=8'])).toThrow(/cannot override/)
    expect(() => parseRunOptions(['--config=other.config.ts'])).toThrow(/cannot override/)
    expect(() => parseRunOptions(['--project', 'hosted-billing-chromium-navigation'])).toThrow(
      /canonical/
    )
    expect(() => parseRunOptions(['--pass-with-no-tests'])).toThrow(/cannot override/)
    expect(parseRunOptions(['--reuse-build'], { ci: false })).toEqual({
      playwrightArgs: [],
      reuseBuild: true,
    })
    expect(() => parseRunOptions(['--reuse-build'], { ci: true })).toThrow(/local-only/)
    expect(() => parseRunOptions(['--keep-stack'], { ci: false })).toThrow(/deferred/)
  })

  test('hash ownership follows execution ownership', () => {
    expect(classifyE2eHashOwner('apps/sim/e2e/settings/navigation/routes.spec.ts')).toBe('rerun')
    expect(classifyE2eHashOwner('apps/sim/e2e/fixtures/scenario.ts')).toBe('scenario')
    expect(classifyE2eHashOwner('apps/sim/e2e/scripts/seed-world.ts')).toBe('scenario')
    expect(classifyE2eHashOwner('apps/sim/e2e/fakes/stripe/server.ts')).toBe('retained-stack')
    expect(classifyE2eHashOwner('apps/sim/e2e/support/readiness.ts')).toBe('retained-stack')
    expect(classifyE2eHashOwner('apps/realtime/src/index.ts')).toBe('retained-stack')
    expect(classifyE2eHashOwner('apps/sim/app/page.tsx')).toBe('next-build')
  })

  test('committed sandbox bundles match the reviewed fingerprint', () => {
    expect(() => verifySandboxBundleIntegrity()).not.toThrow()
  })

  test('empty signal cleanup groups never become PID zero', () => {
    expect(parseProcessGroupIds(undefined)).toEqual([])
    expect(parseProcessGroupIds('')).toEqual([])
    expect(parseProcessGroupIds(' 123, 0, -1, nope, 456 ')).toEqual([123, 456])
  })

  test('port preflight rejects an existing listener', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
      await expect(assertPortAvailable(address.port)).rejects.toThrow(/to be free/)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  test('spawn failures finalize without hanging cleanup', async () => {
    const logsDirectory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-spawn-'))
    try {
      const managed = spawnManagedProcess({
        name: 'missing-command',
        command: path.join(logsDirectory, 'does-not-exist'),
        args: [],
        cwd: logsDirectory,
        env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
        logsDirectory,
      })
      const completion = await managed.completion
      expect(completion.error).toBeTruthy()
      await expect(managed.stop()).resolves.toBeUndefined()
    } finally {
      rmSync(logsDirectory, { recursive: true, force: true })
    }
  })

  test('process exit after readiness does not create an unhandled rejection', async () => {
    const logsDirectory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-ready-'))
    let unhandled: unknown
    const onUnhandled = (error: unknown) => {
      unhandled = error
    }
    process.once('unhandledRejection', onUnhandled)
    try {
      const managed = spawnManagedProcess({
        name: 'ready-process',
        command: 'sleep',
        args: ['10'],
        cwd: logsDirectory,
        env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
        logsDirectory,
      })
      await waitForManagedProcessReady(managed, async () => {})
      await managed.stop()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).toBeUndefined()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      rmSync(logsDirectory, { recursive: true, force: true })
    }
  })
})
