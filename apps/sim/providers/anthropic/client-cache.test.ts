/**
 * @vitest-environment node
 */
import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { getCachedAnthropicClient } from '@/providers/anthropic/client-cache'

/**
 * Builds a fresh fake "client" object on every call so identity comparisons
 * (`toBe`) tell us whether the cache returned the memoized instance or a new
 * one from the factory. We never construct a real Anthropic SDK client — these
 * tests exercise the cache, not the SDK.
 */
function makeFactory() {
  return vi.fn(() => ({}) as Anthropic)
}

/**
 * Generates a unique suffix per test so distinct tests never collide on cache
 * keys. The cache util exposes no reset hook, so isolation is achieved by
 * namespacing keys rather than clearing shared state.
 */
let keyCounter = 0
function uniqueNs(): string {
  keyCounter += 1
  return `ns-${keyCounter}-${Date.now()}`
}

/** Mirrors the anthropic provider's cache-key shape (index.ts). */
function anthropicKey(apiKey: string, useNativeStructuredOutputs: boolean): string {
  return `${apiKey}::${useNativeStructuredOutputs ? 'beta' : 'default'}`
}

/** Mirrors the azure-anthropic provider's cache-key shape (index.ts). */
function azureKey(opts: {
  apiKey: string
  baseURL: string
  anthropicVersion: string
  pinnedIP: string | null
  useNativeStructuredOutputs: boolean
}): string {
  return [
    opts.apiKey,
    opts.baseURL,
    opts.anthropicVersion,
    opts.pinnedIP ?? 'no-pin',
    opts.useNativeStructuredOutputs ? 'beta' : 'default',
  ].join('::')
}

describe('getCachedAnthropicClient', () => {
  it('returns the SAME instance for an identical key and runs the factory once (memoized)', () => {
    const ns = uniqueNs()
    const key = anthropicKey(`${ns}-key`, false)
    const factory = makeFactory()

    const first = getCachedAnthropicClient(key, factory)
    const second = getCachedAnthropicClient(key, factory)

    expect(second).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('returns a DIFFERENT instance for a different apiKey (tenant isolation)', () => {
    const ns = uniqueNs()
    const factoryA = makeFactory()
    const factoryB = makeFactory()

    const tenantA = getCachedAnthropicClient(anthropicKey(`${ns}-tenant-a`, false), factoryA)
    const tenantB = getCachedAnthropicClient(anthropicKey(`${ns}-tenant-b`, false), factoryB)

    expect(tenantB).not.toBe(tenantA)
    expect(factoryA).toHaveBeenCalledTimes(1)
    expect(factoryB).toHaveBeenCalledTimes(1)
  })

  it('returns a different instance when the useNativeStructuredOutputs flag (beta header) differs', () => {
    const ns = uniqueNs()
    const apiKey = `${ns}-same-key`
    const defaultFactory = makeFactory()
    const betaFactory = makeFactory()

    const defaultClient = getCachedAnthropicClient(anthropicKey(apiKey, false), defaultFactory)
    const betaClient = getCachedAnthropicClient(anthropicKey(apiKey, true), betaFactory)

    expect(betaClient).not.toBe(defaultClient)
    expect(defaultFactory).toHaveBeenCalledTimes(1)
    expect(betaFactory).toHaveBeenCalledTimes(1)
  })

  describe('azure key dimensions', () => {
    it('memoizes when every azure dimension matches', () => {
      const ns = uniqueNs()
      const base = {
        apiKey: `${ns}-azure-key`,
        baseURL: 'https://example.openai.azure.com/anthropic',
        anthropicVersion: '2023-06-01',
        pinnedIP: '10.0.0.1',
        useNativeStructuredOutputs: false,
      }
      const factory = makeFactory()

      const first = getCachedAnthropicClient(azureKey(base), factory)
      const second = getCachedAnthropicClient(azureKey(base), factory)

      expect(second).toBe(first)
      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('produces a distinct instance for each differing azure dimension', () => {
      const ns = uniqueNs()
      const base = {
        apiKey: `${ns}-azure-key`,
        baseURL: 'https://a.openai.azure.com/anthropic',
        anthropicVersion: '2023-06-01',
        pinnedIP: '10.0.0.1',
        useNativeStructuredOutputs: false,
      }

      const baseFactory = makeFactory()
      const baseClient = getCachedAnthropicClient(azureKey(base), baseFactory)

      // Each variant flips exactly one dimension and must NOT reuse baseClient.
      const variants = [
        { ...base, baseURL: 'https://b.openai.azure.com/anthropic' },
        { ...base, anthropicVersion: '2024-10-22' },
        { ...base, pinnedIP: '10.0.0.2' },
        { ...base, pinnedIP: null },
        { ...base, useNativeStructuredOutputs: true },
      ]

      for (const variant of variants) {
        const factory = makeFactory()
        const client = getCachedAnthropicClient(azureKey(variant), factory)
        expect(client).not.toBe(baseClient)
        expect(factory).toHaveBeenCalledTimes(1)
      }
    })
  })

  it('evicts the least-recently-used entry once the cache cap is exceeded', () => {
    const ns = uniqueNs()
    const CAP = 1_000

    const oldestKey = `${ns}-evict-0`
    const oldestFactory = makeFactory()
    getCachedAnthropicClient(oldestKey, oldestFactory)
    expect(oldestFactory).toHaveBeenCalledTimes(1)

    // Fill the remaining capacity, then push one past the cap. Since the oldest
    // key has not been touched since insertion, it is the LRU victim.
    for (let i = 1; i <= CAP; i += 1) {
      getCachedAnthropicClient(`${ns}-evict-${i}`, makeFactory())
    }

    // The oldest key was evicted: requesting it again re-runs its factory.
    const reFactory = makeFactory()
    getCachedAnthropicClient(oldestKey, reFactory)
    expect(reFactory).toHaveBeenCalledTimes(1)
    expect(oldestFactory).toHaveBeenCalledTimes(1)
  })
})
