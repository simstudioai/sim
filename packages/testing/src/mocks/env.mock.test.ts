import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultMockEnv,
  envMock,
  envMockFns,
  mockEnvObject,
  resetEnvMock,
  setEnv,
} from './env.mock'

describe('env mock', () => {
  afterEach(() => {
    resetEnvMock()
    vi.unstubAllEnvs()
  })

  it('exposes the default state through env and getEnv', () => {
    expect(envMock.env.NEXT_PUBLIC_APP_URL).toBe(defaultMockEnv.NEXT_PUBLIC_APP_URL)
    expect(envMock.getEnv('DATABASE_URL')).toBe(defaultMockEnv.DATABASE_URL)
  })

  it('applies setEnv overrides to live reads', () => {
    setEnv({ REDIS_URL: 'redis://localhost:6379' })
    expect(envMock.env.REDIS_URL).toBe('redis://localhost:6379')
    expect(envMock.getEnv('REDIS_URL')).toBe('redis://localhost:6379')
  })

  it('supports direct property assignment on the env object', () => {
    mockEnvObject.COPILOT_SOURCE_ENV = 'dev'
    expect(envMock.env.COPILOT_SOURCE_ENV).toBe('dev')
  })

  it('falls back to process.env for keys not pinned in state', () => {
    vi.stubEnv('SOME_UNPINNED_TEST_VAR', 'from-process-env')
    expect(envMock.env.SOME_UNPINNED_TEST_VAR).toBe('from-process-env')
    expect(envMock.getEnv('SOME_UNPINNED_TEST_VAR')).toBe('from-process-env')
  })

  it('pins explicitly-undefined overrides without process.env fallback', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://shadowed.example.com')
    setEnv({ NEXT_PUBLIC_APP_URL: undefined })
    expect(envMock.env.NEXT_PUBLIC_APP_URL).toBeUndefined()
    expect(envMock.getEnv('NEXT_PUBLIC_APP_URL')).toBeUndefined()
  })

  it('resetEnvMock restores defaults and removes overrides', () => {
    setEnv({ REDIS_URL: 'redis://localhost:6379', NEXT_PUBLIC_APP_URL: 'https://other.test' })
    envMockFns.getEnv.mockReturnValue('overridden')
    resetEnvMock()
    expect(envMock.env.REDIS_URL).toBeUndefined()
    expect(envMock.env.NEXT_PUBLIC_APP_URL).toBe(defaultMockEnv.NEXT_PUBLIC_APP_URL)
    expect(envMock.getEnv('NEXT_PUBLIC_APP_URL')).toBe(defaultMockEnv.NEXT_PUBLIC_APP_URL)
  })

  it('coercion helpers mirror the real module', () => {
    expect(envMock.isTruthy('true')).toBe(true)
    expect(envMock.isTruthy('0')).toBe(false)
    expect(envMock.isFalsy('false')).toBe(true)
    expect(envMock.isFalsy(undefined)).toBe(false)
    expect(envMock.envBoolean('yes')).toBe(true)
    expect(envMock.envBoolean('')).toBeUndefined()
    expect(envMock.envNumber('5', 1, { min: 1, integer: true })).toBe(5)
    expect(envMock.envNumber('5.5', 1, { min: 1, integer: true })).toBe(1)
  })
})
