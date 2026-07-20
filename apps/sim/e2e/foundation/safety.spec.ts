import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  test('@next/env preserves a pre-set process value over an env file', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-next-env-'))
    const key = `SIM_E2E_CANARY_${Date.now()}`
    try {
      writeFileSync(path.join(directory, '.env'), `${key}=file-value\n`)
      process.env[key] = 'shadowed-value'
      loadEnvConfig(directory, false, console, true)
      expect(process.env[key]).toBe('shadowed-value')
    } finally {
      delete process.env[key]
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
})
