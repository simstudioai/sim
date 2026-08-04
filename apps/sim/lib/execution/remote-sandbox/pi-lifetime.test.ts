/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The resolver reads configuration at import, so each case re-imports the module
 * with its own mocked environment rather than mutating shared state.
 */
async function resolveWith(options: {
  provider?: string
  lifetimeMs?: string
}): Promise<{ lifetime: number; min: number; max: number }> {
  vi.resetModules()
  vi.doMock('@/lib/core/config/env', () => ({
    env: {
      PI_SANDBOX_LIFETIME_MS: options.lifetimeMs,
      SANDBOX_PROVIDER: options.provider,
    },
  }))

  const mod = await import('@/lib/execution/remote-sandbox/pi-lifetime')
  return {
    lifetime: mod.resolvePiSandboxLifetimeMs(),
    min: mod.PI_SANDBOX_MIN_LIFETIME_MS,
    max: mod.PI_SANDBOX_MAX_LIFETIME_MS,
  }
}

beforeEach(() => {
  vi.resetModules()
})

describe('resolvePiSandboxLifetimeMs', () => {
  it('defaults to the provider cap on E2B', async () => {
    const { lifetime, max } = await resolveWith({})

    expect(lifetime).toBe(max)
  })

  it('matches provider selection by treating an empty provider as E2B', async () => {
    const { lifetime, max } = await resolveWith({ provider: '' })

    expect(lifetime).toBe(max)
  })

  it('uses the full execution ceiling for Daytona', async () => {
    const { lifetime, max } = await resolveWith({ provider: 'daytona' })

    expect(lifetime).toBe(max)
  })

  it('honors a configured Daytona lifetime', async () => {
    const configured = 45 * 60 * 1000
    const { lifetime } = await resolveWith({
      provider: 'daytona',
      lifetimeMs: String(configured),
    })

    expect(lifetime).toBe(configured)
  })

  it('lets a configured value lower the lifetime', async () => {
    const { lifetime, min, max } = await resolveWith({ lifetimeMs: String(45 * 60 * 1000) })

    expect(lifetime).toBe(45 * 60 * 1000)
    expect(lifetime).toBeGreaterThan(min)
    expect(lifetime).toBeLessThan(max)
  })

  it('refuses to be raised above the cap', async () => {
    // E2B rejects a create above its continuous-session limit, so an over-large
    // override would otherwise fail every Pi run rather than lengthening one.
    const { lifetime, max } = await resolveWith({ lifetimeMs: String(48 * 60 * 60 * 1000) })

    expect(lifetime).toBe(max)
  })

  it('raises a lifetime too short for a run to finish in', async () => {
    // Ten minutes is consumed by the clone reserve alone, leaving the turn and
    // the push to race a sandbox that may already be reaped.
    const { lifetime, min } = await resolveWith({ lifetimeMs: String(10 * 60 * 1000) })

    expect(lifetime).toBe(min)
  })

  it.each(['', 'soon', '0', '-1'])('falls back to the cap for %o', async (value) => {
    const { lifetime, max } = await resolveWith({ lifetimeMs: value })

    expect(lifetime).toBe(max)
  })
})

describe('resolvePiRunLifetimeMs', () => {
  it('keeps the provider ceiling when the execution is untimed', async () => {
    const { createTimeoutAbortController } = await import('@/lib/core/execution-limits')
    const { resolvePiRunLifetimeMs, PI_SANDBOX_MAX_LIFETIME_MS } = await import(
      '@/lib/execution/remote-sandbox/pi-lifetime'
    )

    // No timeout means no deadline was recorded, so there is nothing to narrow
    // to — the ceiling is the only bound available.
    const untimed = createTimeoutAbortController()

    expect(resolvePiRunLifetimeMs(untimed.signal)).toBe(PI_SANDBOX_MAX_LIFETIME_MS)
    expect(resolvePiRunLifetimeMs()).toBe(PI_SANDBOX_MAX_LIFETIME_MS)
  })

  it('narrows to the deadline of a run shorter than the ceiling', async () => {
    const { createTimeoutAbortController } = await import('@/lib/core/execution-limits')
    const { resolvePiRunLifetimeMs, PI_SANDBOX_MAX_LIFETIME_MS } = await import(
      '@/lib/execution/remote-sandbox/pi-lifetime'
    )

    // A free-plan sync run gets five minutes. Handing its sandbox the sub-hour
    // ceiling is what left an orphan billing for an hour after a five-minute run.
    const timeout = createTimeoutAbortController(5 * 60 * 1000)
    const lifetime = resolvePiRunLifetimeMs(timeout.signal)

    expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000)
    expect(lifetime).toBeGreaterThan(4 * 60 * 1000)
    expect(lifetime).toBeLessThan(PI_SANDBOX_MAX_LIFETIME_MS)
    timeout.cleanup()
  })

  it('keeps the ceiling when the run outlives it', async () => {
    const { createTimeoutAbortController } = await import('@/lib/core/execution-limits')
    const { resolvePiRunLifetimeMs, PI_SANDBOX_MAX_LIFETIME_MS } = await import(
      '@/lib/execution/remote-sandbox/pi-lifetime'
    )

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

  it('keeps the ceiling for a signal that carries no deadline', async () => {
    const { resolvePiRunLifetimeMs, PI_SANDBOX_MAX_LIFETIME_MS } = await import(
      '@/lib/execution/remote-sandbox/pi-lifetime'
    )

    // A derived or foreign signal reports `undefined` remaining, which means
    // "unknown", not "expired" — narrowing to zero there would kill every run.
    expect(resolvePiRunLifetimeMs(new AbortController().signal)).toBe(PI_SANDBOX_MAX_LIFETIME_MS)
  })

  it('narrows Daytona to the remaining execution deadline', async () => {
    vi.resetModules()
    vi.doMock('@/lib/core/config/env', () => ({
      env: { SANDBOX_PROVIDER: 'daytona' },
    }))
    const { createTimeoutAbortController } = await import('@/lib/core/execution-limits')
    const { resolvePiRunLifetimeMs } = await import('@/lib/execution/remote-sandbox/pi-lifetime')

    const timeout = createTimeoutAbortController(5 * 60 * 1000)
    const lifetime = resolvePiRunLifetimeMs(timeout.signal)

    expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000)
    expect(lifetime).toBeGreaterThan(4 * 60 * 1000)
    timeout.cleanup()
  })
})
