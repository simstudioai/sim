/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchSecretMap } = vi.hoisted(() => ({ mockFetchSecretMap: vi.fn() }))

vi.mock('@sim/runtime-secrets', () => ({ fetchSecretMap: mockFetchSecretMap }))

import {
  assertSyncableKeys,
  resolveTriggerEnvVars,
  SECRET_ID_BY_ENVIRONMENT,
  WORKER_SECRET_KEYS,
} from '@/lib/core/config/trigger-env-sync'

const CONSTANTS = ['DB_APP_NAME']

function byName(vars: { name: string; value: string; isSecret: boolean }[]) {
  return new Map(vars.map((v) => [v.name, v]))
}

describe('resolveTriggerEnvVars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('omits keys the secret does not carry, and keeps the ones it does', async () => {
    const resolved = byName(
      await resolveTriggerEnvVars('staging', async () => ({ REDIS_URL: 'redis://host' }))
    )

    expect(resolved.get('REDIS_URL')?.value).toBe('redis://host')
    expect(resolved.has('E2B_API_KEY')).toBe(false)
    expect(resolved.size).toBe(CONSTANTS.length + 1)
  })

  it('treats an empty value as unset so it cannot blank a working dashboard value', async () => {
    const resolved = byName(
      await resolveTriggerEnvVars('staging', async () => ({ REDIS_URL: '', E2B_API_KEY: null }))
    )

    expect(resolved.has('REDIS_URL')).toBe(false)
    expect(resolved.has('E2B_API_KEY')).toBe(false)
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
