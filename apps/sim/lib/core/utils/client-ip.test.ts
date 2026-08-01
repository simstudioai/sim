/**
 * Covers the wiring between `AUTH_TRUSTED_PROXIES` and the shared resolver.
 * `@/lib/core/utils/client-ip` is mocked globally in `vitest.setup.ts` (it is
 * what every route consumes), so without the `vi.unmock` below the real module
 * — and therefore the env read that makes trusted proxies take effect — would
 * never execute anywhere in CI.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { AUTH_TRUSTED_PROXIES: undefined as string | undefined },
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
vi.unmock('@/lib/core/utils/client-ip')

/**
 * The module parses the env once at import — that is the behavior under test —
 * so each case needs a fresh module instance. This is the deliberate exception
 * to the repo's "no `vi.resetModules()` + dynamic import" performance rule
 * (`.cursor/rules/sim-testing.mdc`): module-init behavior cannot be observed any
 * other way, and the cost here is four imports of a six-line module.
 */
async function loadGetClientIp(trustedProxies: string | undefined) {
  mockEnv.AUTH_TRUSTED_PROXIES = trustedProxies
  vi.resetModules()
  return (await import('@/lib/core/utils/client-ip')).getClientIp
}

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) }
}

describe('getClientIp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keys on the proxy-appended hop, not the caller-supplied leftmost one', async () => {
    const getClientIp = await loadGetClientIp(undefined)

    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('10.0.0.1')
  })

  it('honors AUTH_TRUSTED_PROXIES, resolving past the configured hop', async () => {
    const getClientIp = await loadGetClientIp('10.0.0.0/24')

    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
  })

  it('gives one bucket per caller no matter what they prepend', async () => {
    const getClientIp = await loadGetClientIp(undefined)
    const keys = ['9.9.9.9', 'unknown', '203.0.113.250'].map((spoof) =>
      getClientIp(req({ 'x-forwarded-for': `${spoof}, 10.0.0.1` }))
    )

    expect(new Set(keys)).toEqual(new Set(['10.0.0.1']))
  })

  it('falls back to a shared bucket when no header yields an address', async () => {
    const getClientIp = await loadGetClientIp(undefined)

    expect(getClientIp(req({}))).toBe('unknown')
  })
})
