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

function resolveWith(options: { provider?: string; lifetimeMs?: string }): {
  lifetime: number | undefined
  min: number
  max: number
} {
  mockEnv.PI_SANDBOX_LIFETIME_MS = options.lifetimeMs
  mockEnv.SANDBOX_PROVIDER = options.provider
  return {
    lifetime: resolvePiSandboxLifetimeMs(),
    min: PI_SANDBOX_MIN_LIFETIME_MS,
    max: PI_SANDBOX_MAX_LIFETIME_MS,
  }
}

beforeEach(() => {
  mockEnv.PI_SANDBOX_LIFETIME_MS = undefined
  mockEnv.SANDBOX_PROVIDER = undefined
})

describe('resolvePiSandboxLifetimeMs', () => {
  it('defaults to the sub-hour cap on E2B', () => {
    const { lifetime, max } = resolveWith({})

    expect(lifetime).toBe(max)
  })

  it('matches provider selection by treating an empty provider as E2B', () => {
    const { lifetime, max } = resolveWith({ provider: '' })

    expect(lifetime).toBe(max)
  })

  it('has no lifetime to report when the provider stops on inactivity', () => {
    // Daytona has no absolute lifetime, so reporting E2B's would cut the agent
    // turn to fit a ceiling that does not apply — the regression this prevents.
    const { lifetime } = resolveWith({ provider: 'daytona' })

    expect(lifetime).toBeUndefined()
  })

  it('ignores a configured lifetime entirely on that provider', () => {
    const { lifetime } = resolveWith({ provider: 'daytona', lifetimeMs: '600000' })

    expect(lifetime).toBeUndefined()
  })

  it('uses tolerant capability inspection for an unknown provider', () => {
    const { lifetime } = resolveWith({ provider: 'modal' })

    expect(lifetime).toBeUndefined()
  })

  it('lets a configured value lower the lifetime', () => {
    const { lifetime, min, max } = resolveWith({ lifetimeMs: String(45 * 60 * 1000) })

    expect(lifetime).toBe(45 * 60 * 1000)
    expect(lifetime!).toBeGreaterThan(min)
    expect(lifetime!).toBeLessThan(max)
  })

  it('refuses to be raised above the cap', () => {
    // A Hobby key rejects a create above one hour, so an over-large override
    // would otherwise fail every Pi run rather than lengthening one.
    const { lifetime, max } = resolveWith({ lifetimeMs: String(6 * 60 * 60 * 1000) })

    expect(lifetime).toBe(max)
  })

  it('raises a lifetime too short for a run to finish in', () => {
    // Ten minutes is consumed by the clone reserve alone, leaving the turn and
    // the push to race a sandbox that may already be reaped.
    const { lifetime, min } = resolveWith({ lifetimeMs: String(10 * 60 * 1000) })

    expect(lifetime).toBe(min)
  })

  it.each(['', 'soon', '0', '-1'])('falls back to the cap for %o', (value) => {
    const { lifetime, max } = resolveWith({ lifetimeMs: value })

    expect(lifetime).toBe(max)
  })
})

describe('resolvePiRunLifetimeMs', () => {
  it('keeps the provider ceiling when the execution is untimed', () => {
    // No timeout means no deadline was recorded, so there is nothing to narrow
    // to — the ceiling is the only bound available.
    const untimed = createTimeoutAbortController()

    expect(resolvePiRunLifetimeMs(untimed.signal)).toBe(PI_SANDBOX_MAX_LIFETIME_MS)
    expect(resolvePiRunLifetimeMs()).toBe(PI_SANDBOX_MAX_LIFETIME_MS)
  })

  it('narrows to the deadline of a run shorter than the ceiling', () => {
    // A free-plan sync run gets five minutes. Handing its sandbox the sub-hour
    // ceiling is what left an orphan billing for an hour after a five-minute run.
    const timeout = createTimeoutAbortController(5 * 60 * 1000)
    const lifetime = resolvePiRunLifetimeMs(timeout.signal)

    expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000)
    expect(lifetime).toBeGreaterThan(4 * 60 * 1000)
    expect(lifetime).toBeLessThan(PI_SANDBOX_MAX_LIFETIME_MS)
    timeout.cleanup()
  })

  it('keeps the ceiling when the run outlives it', () => {
    // The deadline must be strictly past the ceiling for the ceiling to win.
    // Passing exactly `PI_SANDBOX_MAX_LIFETIME_MS` made this a coin flip: the
    // remaining budget is `deadline - Date.now()`, so it decays below the ceiling
    // as soon as one millisecond of test time elapses, and `Math.min` then
    // returns the remaining budget instead (`expected 5399999 to be 5400000`).
    // An equal deadline also isn't the case the name describes — the run has to
    // outlive the ceiling, not match it.
    const timeout = createTimeoutAbortController(PI_SANDBOX_MAX_LIFETIME_MS + 60_000)

    expect(resolvePiRunLifetimeMs(timeout.signal)).toBe(PI_SANDBOX_MAX_LIFETIME_MS)
    timeout.cleanup()
  })

  it('keeps the ceiling for a signal that carries no deadline', () => {
    // A derived or foreign signal reports `undefined` remaining, which means
    // "unknown", not "expired" — narrowing to zero there would kill every run.
    expect(resolvePiRunLifetimeMs(new AbortController().signal)).toBe(PI_SANDBOX_MAX_LIFETIME_MS)
  })

  it('has no lifetime to narrow on a provider without one', () => {
    // Daytona stops on inactivity, so imposing the run's deadline as an absolute
    // lifetime would cut a turn to fit a limit that does not apply to it.
    const timeout = createTimeoutAbortController(5 * 60 * 1000)
    mockEnv.SANDBOX_PROVIDER = 'daytona'

    expect(resolvePiRunLifetimeMs(timeout.signal)).toBeUndefined()
    timeout.cleanup()
  })
})
