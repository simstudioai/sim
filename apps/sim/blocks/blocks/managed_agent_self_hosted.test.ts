/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { envState } = vi.hoisted(() => ({
  envState: {
    NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS: undefined as string | undefined,
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

import {
  isSelfHostedMemoryEnabled,
  readSessionMetadataDefaults,
} from '@/blocks/blocks/managed_agent_self_hosted'

describe('readSessionMetadataDefaults', () => {
  beforeEach(() => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS = undefined
  })

  it('returns [] when the env var is unset', () => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS = undefined
    expect(readSessionMetadataDefaults()).toEqual([])
  })

  it('returns [] when the env var is empty / whitespace-only', () => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS = ''
    expect(readSessionMetadataDefaults()).toEqual([])
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS = '   '
    expect(readSessionMetadataDefaults()).toEqual([])
  })

  it('returns [] on invalid JSON', () => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS = '{not json'
    expect(readSessionMetadataDefaults()).toEqual([])
  })

  it('returns [] on a JSON array (must be an object of key/value pairs)', () => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS = '["a","b"]'
    expect(readSessionMetadataDefaults()).toEqual([])
  })

  it('coerces a valid JSON object into `{cells: {Key, Value}}` rows', () => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS = JSON.stringify({
      FOO: 'bar',
      BAZ: 'qux',
    })
    expect(readSessionMetadataDefaults()).toEqual([
      { cells: { Key: 'FOO', Value: 'bar' } },
      { cells: { Key: 'BAZ', Value: 'qux' } },
    ])
  })

  it('drops entries with a blank key', () => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS = JSON.stringify({
      '': 'dropped',
      '   ': 'also dropped',
      keep: 'yes',
    })
    expect(readSessionMetadataDefaults()).toEqual([{ cells: { Key: 'keep', Value: 'yes' } }])
  })

  it('coerces non-string values to their string form', () => {
    envState.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS = JSON.stringify({
      A: 1,
      B: true,
      C: null,
    })
    expect(readSessionMetadataDefaults()).toEqual([
      { cells: { Key: 'A', Value: '1' } },
      { cells: { Key: 'B', Value: 'true' } },
      { cells: { Key: 'C', Value: '' } },
    ])
  })
})

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
