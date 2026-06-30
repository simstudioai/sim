/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { getCachedProviderClient } from '@/providers/client-cache'

/**
 * Builds a fresh fake "client" object on every call so identity comparisons
 * (`toBe`) tell us whether the cache returned the memoized instance or a new one
 * from the factory. We never construct a real SDK client — these tests exercise
 * the cache, not any provider SDK.
 */
function makeFactory() {
  return vi.fn(() => ({}) as object)
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

describe('getCachedProviderClient', () => {
  it('returns the SAME instance for an identical key and runs the factory once (memoized)', () => {
    const key = `anthropic::${uniqueNs()}::default`
    const factory = makeFactory()

    const first = getCachedProviderClient(key, factory)
    const second = getCachedProviderClient(key, factory)

    expect(second).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('returns a DIFFERENT instance for a different apiKey (tenant isolation)', () => {
    const ns = uniqueNs()
    const factoryA = makeFactory()
    const factoryB = makeFactory()

    const tenantA = getCachedProviderClient(`anthropic::${ns}-tenant-a::default`, factoryA)
    const tenantB = getCachedProviderClient(`anthropic::${ns}-tenant-b::default`, factoryB)

    expect(tenantB).not.toBe(tenantA)
    expect(factoryA).toHaveBeenCalledTimes(1)
    expect(factoryB).toHaveBeenCalledTimes(1)
  })

  it('namespaces by provider: the same apiKey under different provider prefixes does not collide', () => {
    const ns = uniqueNs()
    const apiKey = `${ns}-shared-key`
    const anthropicFactory = makeFactory()
    const bedrockFactory = makeFactory()

    const anthropicClient = getCachedProviderClient(`anthropic::${apiKey}`, anthropicFactory)
    const bedrockClient = getCachedProviderClient(`bedrock::${apiKey}`, bedrockFactory)

    expect(bedrockClient).not.toBe(anthropicClient)
  })

  it('treats every distinct key dimension as a distinct client', () => {
    const ns = uniqueNs()
    const base = `azure-anthropic::${ns}-key::https://a.example.com::2023-06-01::10.0.0.1::default`
    const baseFactory = makeFactory()
    const baseClient = getCachedProviderClient(base, baseFactory)

    const variants = [
      `azure-anthropic::${ns}-key::https://b.example.com::2023-06-01::10.0.0.1::default`,
      `azure-anthropic::${ns}-key::https://a.example.com::2024-10-22::10.0.0.1::default`,
      `azure-anthropic::${ns}-key::https://a.example.com::2023-06-01::10.0.0.2::default`,
      `azure-anthropic::${ns}-key::https://a.example.com::2023-06-01::no-pin::default`,
      `azure-anthropic::${ns}-key::https://a.example.com::2023-06-01::10.0.0.1::beta`,
    ]

    for (const key of variants) {
      const factory = makeFactory()
      const client = getCachedProviderClient(key, factory)
      expect(client).not.toBe(baseClient)
      expect(factory).toHaveBeenCalledTimes(1)
    }
  })

  it('evicts the least-recently-used entry once the cache cap is exceeded', () => {
    const ns = uniqueNs()
    const CAP = 1_000

    const oldestKey = `evict::${ns}::0`
    const oldestFactory = makeFactory()
    getCachedProviderClient(oldestKey, oldestFactory)
    expect(oldestFactory).toHaveBeenCalledTimes(1)

    // Fill the remaining capacity, then push one past the cap. The oldest key has
    // not been touched since insertion, so it is the LRU eviction victim.
    for (let i = 1; i <= CAP; i += 1) {
      getCachedProviderClient(`evict::${ns}::${i}`, makeFactory())
    }

    const reFactory = makeFactory()
    getCachedProviderClient(oldestKey, reFactory)
    expect(reFactory).toHaveBeenCalledTimes(1)
    expect(oldestFactory).toHaveBeenCalledTimes(1)
  })
})
