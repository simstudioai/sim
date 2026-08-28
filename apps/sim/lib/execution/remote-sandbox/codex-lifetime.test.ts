/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    CODEX_SANDBOX_LIFETIME_MS: undefined as string | undefined,
    SANDBOX_PROVIDER: undefined as string | undefined,
  },
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))

import { createTimeoutAbortController } from '@/lib/core/execution-limits'
import {
  CODEX_SANDBOX_MAX_LIFETIME_MS,
  CODEX_SANDBOX_MIN_LIFETIME_MS,
  resolveCodexRunLifetimeMs,
  resolveCodexSandboxLifetimeMs,
} from '@/lib/execution/remote-sandbox/codex-lifetime'

beforeEach(() => {
  mockEnv.CODEX_SANDBOX_LIFETIME_MS = undefined
  mockEnv.SANDBOX_PROVIDER = undefined
})

describe('resolveCodexSandboxLifetimeMs', () => {
  it('uses the E2B continuous-runtime ceiling by default', () => {
    expect(resolveCodexSandboxLifetimeMs()).toBe(
      Math.min(CODEX_SANDBOX_MAX_LIFETIME_MS, 24 * 60 * 60 * 1000)
    )
  })

  it('uses the platform execution ceiling for Daytona', () => {
    mockEnv.SANDBOX_PROVIDER = 'daytona'
    expect(resolveCodexSandboxLifetimeMs()).toBe(CODEX_SANDBOX_MAX_LIFETIME_MS)
  })

  it('raises a configured value that cannot cover clone, turn, and finalize', () => {
    mockEnv.CODEX_SANDBOX_LIFETIME_MS = String(10 * 60 * 1000)
    expect(resolveCodexSandboxLifetimeMs()).toBe(CODEX_SANDBOX_MIN_LIFETIME_MS)
  })

  it('narrows a sandbox to the remaining execution deadline', () => {
    const timeout = createTimeoutAbortController(5 * 60 * 1000)
    const lifetime = resolveCodexRunLifetimeMs(timeout.signal)
    expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000)
    expect(lifetime).toBeGreaterThan(4 * 60 * 1000)
    timeout.cleanup()
  })
})
