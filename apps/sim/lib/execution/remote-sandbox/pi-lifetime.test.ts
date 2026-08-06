/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    PI_SANDBOX_LIFETIME_MS: undefined as string | undefined,
    SANDBOX_PROVIDER: undefined as string | undefined,
  },
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))

import { createTimeoutAbortController } from '@/lib/core/execution-limits'
import {
  PI_SANDBOX_MAX_LIFETIME_MS,
  PI_SANDBOX_MIN_LIFETIME_MS,
  resolvePiRunLifetimeMs,
  resolvePiSandboxLifetimeMs,
} from '@/lib/execution/remote-sandbox/pi-lifetime'

const E2B_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000

function resolveWith(options: { provider?: string; lifetimeMs?: string }): {
  lifetime: number
  min: number
  platformMax: number
} {
  mockEnv.PI_SANDBOX_LIFETIME_MS = options.lifetimeMs
  mockEnv.SANDBOX_PROVIDER = options.provider
  return {
    lifetime: resolvePiSandboxLifetimeMs(),
    min: PI_SANDBOX_MIN_LIFETIME_MS,
    platformMax: PI_SANDBOX_MAX_LIFETIME_MS,
  }
}

beforeEach(() => {
  mockEnv.PI_SANDBOX_LIFETIME_MS = undefined
  mockEnv.SANDBOX_PROVIDER = undefined
})

describe('resolvePiSandboxLifetimeMs', () => {
  it('defaults to the continuous-runtime cap on E2B', () => {
    const { lifetime, platformMax } = resolveWith({})

    expect(lifetime).toBe(Math.min(platformMax, E2B_MAX_LIFETIME_MS))
  })

  it('matches provider selection by treating an empty provider as E2B', () => {
    const { lifetime, platformMax } = resolveWith({ provider: '' })

    expect(lifetime).toBe(Math.min(platformMax, E2B_MAX_LIFETIME_MS))
  })

  it('uses the full execution ceiling for Daytona', () => {
    const { lifetime, platformMax } = resolveWith({ provider: 'daytona' })

    expect(lifetime).toBe(platformMax)
  })

  it('honors a configured Daytona lifetime', () => {
    const configured = 45 * 60 * 1000
    const { lifetime } = resolveWith({
      provider: 'daytona',
      lifetimeMs: String(configured),
    })

    expect(lifetime).toBe(configured)
  })

  it('uses the conservative E2B cap for an unknown provider', () => {
    const { lifetime, platformMax } = resolveWith({ provider: 'modal' })

    expect(lifetime).toBe(Math.min(platformMax, E2B_MAX_LIFETIME_MS))
  })

  it('lets a configured value lower the lifetime', () => {
    const { lifetime, min } = resolveWith({ lifetimeMs: String(45 * 60 * 1000) })

    expect(lifetime).toBe(45 * 60 * 1000)
    expect(lifetime).toBeGreaterThan(min)
  })

  it('refuses to raise E2B above its provider cap', () => {
    const { lifetime, platformMax } = resolveWith({
      lifetimeMs: String(48 * 60 * 60 * 1000),
    })

    expect(lifetime).toBe(Math.min(platformMax, E2B_MAX_LIFETIME_MS))
  })

  it('raises a lifetime too short for a run to finish in', () => {
    const { lifetime, min } = resolveWith({ lifetimeMs: String(10 * 60 * 1000) })

    expect(lifetime).toBe(min)
  })

  it.each(['', 'soon', '0', '-1'])('falls back to the provider cap for %o', (value) => {
    const { lifetime, platformMax } = resolveWith({ lifetimeMs: value })

    expect(lifetime).toBe(Math.min(platformMax, E2B_MAX_LIFETIME_MS))
  })
})

describe('resolvePiRunLifetimeMs', () => {
  it('keeps the provider ceiling when the execution is untimed', () => {
    const untimed = createTimeoutAbortController()
    const providerCeiling = resolvePiSandboxLifetimeMs()

    expect(resolvePiRunLifetimeMs(untimed.signal)).toBe(providerCeiling)
    expect(resolvePiRunLifetimeMs()).toBe(providerCeiling)
  })

  it('narrows to the deadline of a run shorter than the ceiling', () => {
    const timeout = createTimeoutAbortController(5 * 60 * 1000)
    const lifetime = resolvePiRunLifetimeMs(timeout.signal)

    expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000)
    expect(lifetime).toBeGreaterThan(4 * 60 * 1000)
    expect(lifetime).toBeLessThan(resolvePiSandboxLifetimeMs())
    timeout.cleanup()
  })

  it('keeps the provider ceiling when the run outlives it', () => {
    const providerCeiling = resolvePiSandboxLifetimeMs()
    const timeout = createTimeoutAbortController(providerCeiling + 60_000)

    expect(resolvePiRunLifetimeMs(timeout.signal)).toBe(providerCeiling)
    timeout.cleanup()
  })

  it('keeps the provider ceiling for a signal that carries no deadline', () => {
    expect(resolvePiRunLifetimeMs(new AbortController().signal)).toBe(resolvePiSandboxLifetimeMs())
  })

  it('narrows Daytona to the remaining execution deadline', () => {
    mockEnv.SANDBOX_PROVIDER = 'daytona'
    const timeout = createTimeoutAbortController(5 * 60 * 1000)
    const lifetime = resolvePiRunLifetimeMs(timeout.signal)

    expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000)
    expect(lifetime).toBeGreaterThan(4 * 60 * 1000)
    timeout.cleanup()
  })

  it('uses the platform ceiling for an untimed Daytona run', () => {
    mockEnv.SANDBOX_PROVIDER = 'daytona'

    expect(resolvePiRunLifetimeMs()).toBe(PI_SANDBOX_MAX_LIFETIME_MS)
  })
})
