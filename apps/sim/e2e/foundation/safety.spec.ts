import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { expect, test } from '@playwright/test'
import { parseRunOptions } from '../scripts/options'
import {
  assertLoopbackPostgresUrl,
  assertSafeDatabaseName,
  buildRunDatabaseUrl,
} from '../support/database'
import { buildChildEnvironment, discoverEnvFileKeys } from '../support/env'
import { isLoopbackAddress } from '../support/hosts'
import { assertPortAvailable } from '../support/process'

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

  test('database guards reject shared or remote targets', () => {
    expect(() => assertSafeDatabaseName('simstudio')).toThrow()
    expect(() => assertSafeDatabaseName('sim_e2e_valid_run')).not.toThrow()
    expect(() =>
      assertLoopbackPostgresUrl('postgresql://postgres:postgres@example.com/postgres')
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
  })

  test('sharding is limited to the navigation project', () => {
    expect(() =>
      parseRunOptions(['--project=hosted-billing-chromium-navigation', '--shard=1/2'])
    ).not.toThrow()
    expect(() =>
      parseRunOptions(['--project=hosted-billing-chromium-workflows', '--shard=1/2'])
    ).toThrow(/coupled workflows must remain unsharded/)
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
})
