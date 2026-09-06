/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchSecretMap } = vi.hoisted(() => ({ mockFetchSecretMap: vi.fn() }))

vi.mock('@sim/runtime-secrets', () => ({ fetchSecretMap: mockFetchSecretMap }))

import {
  assertSyncableKeys,
  resolveTriggerEnvVars,
  SECRET_ID_BY_ENVIRONMENT,
  TriggerEnvSyncUnavailableError,
  WORKER_SECRET_KEYS,
} from '@/lib/core/config/trigger-env-sync'

const CONSTANTS = ['DB_APP_NAME']

function byName(vars: { name: string; value: string; isSecret: boolean }[]) {
  return new Map(vars.map((v) => [v.name, v]))
}

describe('resolveTriggerEnvVars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SIM_TRIGGER_ENV_SYNC_REQUIRED = undefined
  })

  afterEach(() => {
    process.env.SIM_TRIGGER_ENV_SYNC_REQUIRED = undefined
  })

  it('reads the secret mapped to the environment', async () => {
    mockFetchSecretMap.mockResolvedValue({})

    await resolveTriggerEnvVars('prod')

    expect(mockFetchSecretMap).toHaveBeenCalledWith('/production/sim/env-vars')
  })

  it.each([
    ['prod', '/production/sim/env-vars'],
    ['staging', '/staging/sim/env-vars'],
    ['preview', '/dev/sim/env-vars'],
  ])('maps %s to %s', (environment, secretId) => {
    expect(SECRET_ID_BY_ENVIRONMENT[environment]).toBe(secretId)
  })

  it('publishes the constants plus every key present in the secret', async () => {
    const secret = Object.fromEntries(WORKER_SECRET_KEYS.map(({ name }) => [name, `${name}-value`]))
    const resolved = byName(await resolveTriggerEnvVars('staging', async () => secret))

    for (const key of CONSTANTS) expect(resolved.has(key)).toBe(true)
    for (const { name } of WORKER_SECRET_KEYS) {
      expect(resolved.get(name)?.value).toBe(`${name}-value`)
    }
    expect(resolved.size).toBe(CONSTANTS.length + WORKER_SECRET_KEYS.length)
  })

  it('carries the secret flag through from the key table', async () => {
    const resolved = byName(
      await resolveTriggerEnvVars('staging', async () => ({
        REDIS_URL: 'redis://host',
        SANDBOX_PROVIDER: 'e2b',
      }))
    )

    expect(resolved.get('REDIS_URL')?.isSecret).toBe(true)
    expect(resolved.get('SANDBOX_PROVIDER')?.isSecret).toBe(false)
    expect(resolved.get('DB_APP_NAME')?.isSecret).toBe(false)
  })

  it('clears a key the authoritative secret no longer carries, so a revoked credential cannot survive in the worker', async () => {
    const resolved = byName(
      await resolveTriggerEnvVars('staging', async () => ({ REDIS_URL: 'redis://host' }))
    )

    expect(resolved.get('REDIS_URL')?.value).toBe('redis://host')
    expect(resolved.get('E2B_API_KEY')?.value).toBe('')
    expect(resolved.get('DAYTONA_API_KEY')?.value).toBe('')
    expect(resolved.size).toBe(CONSTANTS.length + WORKER_SECRET_KEYS.length)
  })

  it('clears a key blanked or nulled in the secret rather than leaving the old value', async () => {
    const resolved = byName(
      await resolveTriggerEnvVars('staging', async () => ({ REDIS_URL: '', E2B_API_KEY: null }))
    )

    expect(resolved.get('REDIS_URL')?.value).toBe('')
    expect(resolved.get('E2B_API_KEY')?.value).toBe('')
  })

  it('clears nothing when the secret could not be read, having no authority to clear against', async () => {
    const resolved = await resolveTriggerEnvVars('prod', async () => {
      throw new Error('AccessDeniedException')
    })

    expect(resolved.map((v) => v.name)).toEqual(CONSTANTS)
  })

  it('fails the resolve instead of publishing a partial env when sync is required', async () => {
    process.env.SIM_TRIGGER_ENV_SYNC_REQUIRED = '1'

    await expect(
      resolveTriggerEnvVars('prod', async () => {
        throw new Error('AccessDeniedException')
      })
    ).rejects.toBeInstanceOf(TriggerEnvSyncUnavailableError)

    await expect(resolveTriggerEnvVars('dev', vi.fn())).rejects.toBeInstanceOf(
      TriggerEnvSyncUnavailableError
    )
  })

  it('serializes a non-string secret entry', async () => {
    const resolved = byName(
      await resolveTriggerEnvVars('staging', async () => ({ E2B_ENABLED: true }))
    )

    expect(resolved.get('E2B_ENABLED')?.value).toBe('true')
  })

  it('publishes constants only for an unmapped environment, without reading a secret', async () => {
    const loadSecret = vi.fn()

    const resolved = await resolveTriggerEnvVars('dev', loadSecret)

    expect(loadSecret).not.toHaveBeenCalled()
    expect(resolved.map((v) => v.name)).toEqual(CONSTANTS)
  })

  it('falls back to constants instead of rejecting when the secret cannot be read', async () => {
    const resolved = await resolveTriggerEnvVars('prod', async () => {
      throw new Error('AccessDeniedException')
    })

    expect(resolved.map((v) => v.name)).toEqual(CONSTANTS)
  })

  it('publishes no TRIGGER_-prefixed key, which the sync layer would strip silently', async () => {
    const resolved = await resolveTriggerEnvVars('staging', async () => ({
      REDIS_URL: 'redis://host',
    }))

    expect(resolved.filter((v) => v.name.startsWith('TRIGGER_'))).toEqual([])
    expect(WORKER_SECRET_KEYS.filter(({ name }) => name.startsWith('TRIGGER_'))).toEqual([])
  })

  it('rejects a key the sync layer would strip, naming it', () => {
    expect(() => assertSyncableKeys(['DB_APP_NAME', 'TRIGGER_DEV_ENABLED'])).toThrow(
      /TRIGGER_DEV_ENABLED/
    )
  })

  it('accepts the keys this module actually publishes', () => {
    expect(() => assertSyncableKeys()).not.toThrow()
  })
})
