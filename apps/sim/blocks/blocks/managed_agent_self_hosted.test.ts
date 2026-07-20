/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { envState } = vi.hoisted(() => ({
  envState: {
    NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_MEMORY_ENABLED: undefined as string | undefined,
  },
}))

vi.mock('@/lib/core/config/env', () => ({
  env: new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => (envState as Record<string, unknown>)[key as string],
  }),
}))

vi.mock('@/lib/managed-agents/subblock-options', () => ({
  fetchManagedAgentAgentOptions: vi.fn(),
  fetchManagedAgentConnectionOptions: vi.fn(),
  fetchManagedAgentMemoryStoreOptions: vi.fn(),
  fetchManagedAgentSelfHostedEnvironmentOptions: vi.fn(),
  fetchManagedAgentVaultOptions: vi.fn(),
}))

import { isSelfHostedMemoryEnabled } from '@/blocks/blocks/managed_agent_self_hosted'

describe('isSelfHostedMemoryEnabled', () => {
  beforeEach(() => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_MEMORY_ENABLED = undefined
  })

  it('defaults to false when the env var is unset', () => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_MEMORY_ENABLED = undefined
    expect(isSelfHostedMemoryEnabled()).toBe(false)
  })

  it('is true only for truthy string forms', () => {
    for (const on of ['1', 'true', 'True', 'YES', 'yes']) {
      envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_MEMORY_ENABLED = on
      expect(isSelfHostedMemoryEnabled()).toBe(true)
    }
  })

  it('is false for other strings', () => {
    for (const off of ['0', 'false', 'no', 'off', 'random']) {
      envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_MEMORY_ENABLED = off
      expect(isSelfHostedMemoryEnabled()).toBe(false)
    }
  })

  it('trims surrounding whitespace before comparing', () => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_MEMORY_ENABLED = '  true  '
    expect(isSelfHostedMemoryEnabled()).toBe(true)
  })
})
