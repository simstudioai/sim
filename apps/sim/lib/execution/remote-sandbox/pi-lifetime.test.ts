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
}): Promise<{ lifetime: number | undefined; min: number; max: number }> {
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
  it('defaults to the sub-hour cap on E2B', async () => {
    const { lifetime, max } = await resolveWith({})

    expect(lifetime).toBe(max)
  })

  it('matches provider selection by treating an empty provider as E2B', async () => {
    const { lifetime, max } = await resolveWith({ provider: '' })

    expect(lifetime).toBe(max)
  })

  it('has no lifetime to report when the provider stops on inactivity', async () => {
    // Daytona has no absolute lifetime, so reporting E2B's would cut the agent
    // turn to fit a ceiling that does not apply — the regression this prevents.
    const { lifetime } = await resolveWith({ provider: 'daytona' })

    expect(lifetime).toBeUndefined()
  })

  it('ignores a configured lifetime entirely on that provider', async () => {
    const { lifetime } = await resolveWith({ provider: 'daytona', lifetimeMs: '600000' })

    expect(lifetime).toBeUndefined()
  })

  it('lets a configured value lower the lifetime', async () => {
    const { lifetime, min, max } = await resolveWith({ lifetimeMs: String(45 * 60 * 1000) })

    expect(lifetime).toBe(45 * 60 * 1000)
    expect(lifetime!).toBeGreaterThan(min)
    expect(lifetime!).toBeLessThan(max)
  })

  it('refuses to be raised above the cap', async () => {
    // A Hobby key rejects a create above one hour, so an over-large override
    // would otherwise fail every Pi run rather than lengthening one.
    const { lifetime, max } = await resolveWith({ lifetimeMs: String(6 * 60 * 60 * 1000) })

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

    // The async ceiling is 90 minutes, above what E2B will grant, so the
    // provider cap still wins.
    const timeout = createTimeoutAbortController(90 * 60 * 1000)

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

  it('has no lifetime to narrow on a provider without one', async () => {
    vi.resetModules()
    vi.doMock('@/lib/core/config/env', () => ({
      env: { SANDBOX_PROVIDER: 'daytona' },
    }))
    const { createTimeoutAbortController } = await import('@/lib/core/execution-limits')
    const { resolvePiRunLifetimeMs } = await import('@/lib/execution/remote-sandbox/pi-lifetime')

    // Daytona stops on inactivity, so imposing the run's deadline as an absolute
    // lifetime would cut a turn to fit a limit that does not apply to it.
    const timeout = createTimeoutAbortController(5 * 60 * 1000)

    expect(resolvePiRunLifetimeMs(timeout.signal)).toBeUndefined()
    timeout.cleanup()
  })
})
