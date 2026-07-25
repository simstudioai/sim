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
